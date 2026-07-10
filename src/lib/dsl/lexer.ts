import { DslError, type Pos } from './errors.js';
import { KEYWORDS, type FormatSpec, type TemplatePart, type Token, type TokenKind } from './token.js';

const isDigit = (c: string) => c >= '0' && c <= '9';
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const isIdentStart = isLetter;
const isIdentChar = (c: string) => isLetter(c) || isDigit(c) || c === '_';

class Lexer {
  private i = 0;
  private line = 1;
  private col = 1;

  constructor(private readonly src: string) {}

  lex(): Token[] {
    const tokens: Token[] = [];
    for (;;) {
      const tok = this.next();
      tokens.push(tok);
      if (tok.kind === 'eof') return tokens;
    }
  }

  private pos(): Pos {
    return { line: this.line, col: this.col };
  }

  private peek(offset = 0): string {
    return this.src[this.i + offset] ?? '';
  }

  private advance(): string {
    const c = this.src[this.i++];
    if (c === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  private skipTrivia(): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.advance();
      } else if (c === '#') {
        while (this.peek() !== '' && this.peek() !== '\n') this.advance();
      } else {
        return;
      }
    }
  }

  /** Next token, skipping whitespace and comments. */
  next(): Token {
    this.skipTrivia();
    const pos = this.pos();
    const c = this.peek();
    if (c === '') return { kind: 'eof', text: '', pos };

    if (isDigit(c)) return this.number(pos);
    if (isIdentStart(c)) return this.identifier(pos);
    if (c === '"') return this.template(pos);

    this.advance();
    const two = c + this.peek();
    const op = (kind: TokenKind, text: string): Token => ({ kind, text, pos });
    switch (c) {
      case ':':
        if (this.peek() === '=') {
          this.advance();
          return op(':=', ':=');
        }
        return op(':', ':');
      case '!':
        if (this.peek() === '=') {
          this.advance();
          return op('!=', '!=');
        }
        throw new DslError("unexpected character '!' (did you mean '!='?)", pos);
      case '<':
      case '>':
        if (this.peek() === '=') {
          this.advance();
          return op((two as TokenKind), two);
        }
        return op(c as TokenKind, c);
      case '=':
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
      case '(':
      case ')':
      case ',':
      case '}':
        return op(c as TokenKind, c);
      default:
        throw new DslError(`unexpected character '${c}'`, pos);
    }
  }

  private number(pos: Pos): Token {
    let text = '';
    while (isDigit(this.peek())) text += this.advance();
    if (this.peek() === '.') {
      if (!isDigit(this.peek(1))) {
        throw new DslError(`malformed number '${text}.' — digits must follow the decimal point`, pos);
      }
      text += this.advance();
      while (isDigit(this.peek())) text += this.advance();
    }
    return { kind: 'number', text, value: Number(text), pos };
  }

  private identifier(pos: Pos): Token {
    let text = '';
    while (isIdentChar(this.peek())) text += this.advance();
    const keyword = KEYWORDS.get(text);
    return { kind: keyword ?? 'ident', text, pos };
  }

  /** Lex a full string template: literal text runs + `{expr[:spec]}` interpolations. */
  private template(pos: Pos): Token {
    this.advance(); // opening quote
    const parts: TemplatePart[] = [];
    let text = '';
    const flushText = () => {
      if (text !== '') {
        parts.push({ text });
        text = '';
      }
    };
    for (;;) {
      const c = this.peek();
      if (c === '' || c === '\n') {
        throw new DslError('unterminated string template', pos);
      }
      if (c === '"') {
        this.advance();
        flushText();
        if (parts.length === 0) parts.push({ text: '' });
        return { kind: 'template', text: '', parts, pos };
      }
      if (c === '\\') {
        const escPos = this.pos();
        this.advance();
        const e = this.advance();
        if (e === '"') text += '"';
        else if (e === '\\') text += '\\';
        else if (e === 'n') text += '\n';
        else if (e === 't') text += '\t';
        else throw new DslError(`invalid escape sequence '\\${e ?? ''}'`, escPos);
        continue;
      }
      if (c === '}') {
        throw new DslError("unexpected '}' in string template (braces only delimit interpolations)", this.pos());
      }
      if (c === '{') {
        flushText();
        parts.push(this.interpolation());
        continue;
      }
      text += this.advance();
    }
  }

  /** Scan `{expr[:spec]}` starting at `{`. Tokens are lexed with the normal scanner. */
  private interpolation(): TemplatePart {
    const openPos = this.pos();
    this.advance(); // '{'
    const tokens: Token[] = [];
    let depth = 0;
    for (;;) {
      const tok = this.next();
      if (tok.kind === 'eof') throw new DslError('unterminated interpolation in string template', openPos);
      if (tok.kind === '(') depth++;
      if (tok.kind === ')') depth--;
      if (tok.kind === '}' && depth === 0) {
        if (tokens.length === 0) throw new DslError('empty interpolation in string template', openPos);
        return { tokens, pos: openPos };
      }
      if (tok.kind === ':' && depth === 0) {
        if (tokens.length === 0) throw new DslError('empty interpolation in string template', openPos);
        const spec = this.formatSpec();
        return { tokens, spec, pos: openPos };
      }
      tokens.push(tok);
    }
  }

  /** Raw-scan the format spec between ':' and '}'. */
  private formatSpec(): FormatSpec {
    const pos = this.pos();
    let raw = '';
    while (this.peek() !== '}' && this.peek() !== '' && this.peek() !== '\n') raw += this.advance();
    if (this.peek() !== '}') throw new DslError('unterminated format spec', pos);
    this.advance(); // '}'
    const int = /^(\d+)d$/.exec(raw);
    if (int) return { kind: 'int', width: Number(int[1]) };
    const fixed = /^0\.(\d+)f$/.exec(raw);
    if (fixed) return { kind: 'fixed', places: Number(fixed[1]) };
    throw new DslError(`invalid format spec '${raw}' (expected e.g. '02d' or '0.2f')`, pos);
  }
}

export function lex(source: string): Token[] {
  return new Lexer(source).lex();
}
