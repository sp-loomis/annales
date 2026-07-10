import { DslError, type Pos } from './errors.js';
import { FUNCTION_NAMES, RESERVED, type Token, type TokenKind } from './token.js';
import type { Assign, CompareOp, Expr, Program } from './ast.js';

// Binding powers per DSL spec §3 (low → high; higher binds tighter).
const OR_BP = 1;
const AND_BP = 2;
const NOT_BP = 3;
const COMPARE_BP = 4;
const ADD_BP = 5;
const MUL_BP = 6;
const NEG_BP = 7;

const COMPARE_OPS: ReadonlySet<TokenKind> = new Set(['=', '!=', '<', '>', '<=', '>=']);

class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }

  private advance(): Token {
    const tok = this.tokens[this.i];
    if (tok.kind !== 'eof') this.i++;
    return tok;
  }

  private expect(kind: TokenKind, context: string): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new DslError(`expected '${kind}' ${context}, found '${tok.text || tok.kind}'`, tok.pos);
    }
    return this.advance();
  }

  parseProgram(): Program {
    const statements: Assign[] = [];
    for (;;) {
      const tok = this.peek();
      if (tok.kind === 'return') {
        const retPos = this.advance().pos;
        const ret = this.parseExpr();
        const after = this.peek();
        if (after.kind !== 'eof') {
          throw new DslError(
            `unexpected '${after.text || after.kind}' after return — return must be the final statement`,
            after.pos
          );
        }
        return { statements, ret, retPos };
      }
      if (tok.kind === 'ident' && this.peek(1).kind === ':=') {
        if (RESERVED.has(tok.text)) {
          throw new DslError(`'${tok.text}' is a reserved word and cannot be assigned`, tok.pos);
        }
        const name = this.advance();
        this.advance(); // ':='
        statements.push({ name: name.text, expr: this.parseExpr(), pos: name.pos });
        continue;
      }
      if (RESERVED.has(tok.text) && this.peek(1).kind === ':=') {
        throw new DslError(`'${tok.text}' is a reserved word and cannot be assigned`, tok.pos);
      }
      throw new DslError(
        `expected an assignment (name := expr) or 'return', found '${tok.text || tok.kind}'`,
        tok.pos
      );
    }
  }

  /** Full expression entry point: case_expr | if_expr | binary_expr (spec §2). */
  parseExpr(): Expr {
    const tok = this.peek();
    if (tok.kind === 'case') return this.parseCase();
    if (tok.kind === 'if') return this.parseIf();
    return this.parseBinary(0);
  }

  /** Called at end of a sub-stream (template interpolation) to reject trailing tokens. */
  expectEof(context: string): void {
    const tok = this.peek();
    if (tok.kind !== 'eof') {
      throw new DslError(`unexpected '${tok.text || tok.kind}' ${context}`, tok.pos);
    }
  }

  private parseBinary(minBp: number): Expr {
    let left = this.parsePrefix();
    for (;;) {
      const tok = this.peek();
      const kind = tok.kind;
      let bp: number;
      if (kind === 'or') bp = OR_BP;
      else if (kind === 'and') bp = AND_BP;
      else if (COMPARE_OPS.has(kind)) bp = COMPARE_BP;
      else if (kind === '+' || kind === '-') bp = ADD_BP;
      else if (kind === '*' || kind === '/' || kind === '%') bp = MUL_BP;
      else break;
      if (bp <= minBp) break;
      this.advance();
      if (COMPARE_OPS.has(kind)) {
        const right = this.parseBinary(COMPARE_BP);
        const next = this.peek();
        if (COMPARE_OPS.has(next.kind)) {
          throw new DslError(
            'comparison operators are non-associative and cannot be chained',
            next.pos
          );
        }
        left = { kind: 'compare', op: kind as CompareOp, left, right, pos: tok.pos };
      } else if (kind === 'and' || kind === 'or') {
        left = { kind: 'logic', op: kind, left, right: this.parseBinary(bp), pos: tok.pos };
      } else {
        left = {
          kind: 'binary',
          op: kind as '+' | '-' | '*' | '/' | '%',
          left,
          right: this.parseBinary(bp),
          pos: tok.pos,
        };
      }
    }
    return left;
  }

  private parsePrefix(): Expr {
    const tok = this.peek();
    if (tok.kind === 'not') {
      this.advance();
      return { kind: 'unary', op: 'not', operand: this.parseBinary(NOT_BP), pos: tok.pos };
    }
    if (tok.kind === '-') {
      this.advance();
      return { kind: 'unary', op: '-', operand: this.parseBinary(NEG_BP), pos: tok.pos };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    switch (tok.kind) {
      case 'number':
        this.advance();
        return { kind: 'number', value: tok.value!, pos: tok.pos };
      case 'true':
      case 'false':
        this.advance();
        return { kind: 'bool', value: tok.kind === 'true', pos: tok.pos };
      case 'null':
        this.advance();
        return { kind: 'null', pos: tok.pos };
      case 'template':
        this.advance();
        return this.parseTemplate(tok);
      case 'ident':
        this.advance();
        if (this.peek().kind === '(') return this.parseCall(tok);
        return { kind: 'ident', name: tok.text, pos: tok.pos };
      case '(': {
        this.advance();
        const inner = this.parseExpr();
        this.expect(')', 'to close parenthesized expression');
        return inner;
      }
      case 'case':
      case 'if':
        throw new DslError(
          `'${tok.kind}' expressions must be parenthesized when used as an operand`,
          tok.pos
        );
      default:
        throw new DslError(`expected an expression, found '${tok.text || tok.kind}'`, tok.pos);
    }
  }

  private parseCall(name: Token): Expr {
    if (!FUNCTION_NAMES.has(name.text)) {
      throw new DslError(`unknown function '${name.text}'`, name.pos);
    }
    this.expect('(', `after function name '${name.text}'`);
    const args: Expr[] = [];
    let base: number | undefined;
    if (this.peek().kind !== ')') {
      for (;;) {
        if (base !== undefined) {
          throw new DslError("'base=' must be the last argument", this.peek().pos);
        }
        if (this.peek().kind === 'ident' && this.peek().text === 'base' && this.peek(1).kind === '=') {
          this.advance(); // base
          this.advance(); // =
          const lit = this.peek();
          if (lit.kind !== 'number') {
            throw new DslError("'base=' takes a number literal only", lit.pos);
          }
          this.advance();
          if (this.peek().kind !== ')') {
            // catches both `base=1+1` and `base=0, more`
            throw new DslError(
              "'base=' takes a number literal only and must be the last argument",
              this.peek().pos
            );
          }
          base = lit.value!;
        } else {
          args.push(this.parseExpr());
        }
        if (this.peek().kind === ',') {
          this.advance();
          continue;
        }
        break;
      }
    }
    this.expect(')', `to close call to '${name.text}'`);
    return { kind: 'call', name: name.text, args, base, pos: name.pos };
  }

  private parseCase(): Expr {
    const caseTok = this.expect('case', '');
    const subject = this.peek();
    if (subject.kind !== 'ident') {
      throw new DslError("'case' subject must be a parameter name", subject.pos);
    }
    this.advance();
    const clauses: { values: { name: string; pos: Pos }[]; expr: Expr }[] = [];
    while (this.peek().kind === 'when') {
      this.advance();
      const values: { name: string; pos: Pos }[] = [];
      for (;;) {
        const v = this.expect('ident', "in 'when' value list");
        values.push({ name: v.text, pos: v.pos });
        if (this.peek().kind === ',') {
          this.advance();
          continue;
        }
        break;
      }
      this.expect('then', "after 'when' values");
      clauses.push({ values, expr: this.parseExpr() });
    }
    if (clauses.length === 0) {
      throw new DslError("'case' requires at least one 'when' clause", caseTok.pos);
    }
    let elseExpr: Expr | undefined;
    if (this.peek().kind === 'else') {
      this.advance();
      elseExpr = this.parseExpr();
    }
    return {
      kind: 'case',
      subject: subject.text,
      subjectPos: subject.pos,
      clauses,
      elseExpr,
      pos: caseTok.pos,
    };
  }

  private parseIf(): Expr {
    const ifTok = this.expect('if', '');
    const cond = this.parseExpr();
    this.expect('then', "after 'if' condition");
    const then = this.parseExpr();
    this.expect('else', "— 'if' requires an 'else' branch");
    const elseBranch = this.parseExpr();
    return { kind: 'if', cond, then, else: elseBranch, pos: ifTok.pos };
  }

  private parseTemplate(tok: Token): Expr {
    const parts: Extract<Expr, { kind: 'template' }>['parts'] = [];
    for (const part of tok.parts!) {
      if ('text' in part) {
        parts.push({ text: part.text });
      } else {
        const sub = new Parser([...part.tokens, { kind: 'eof', text: '', pos: part.pos }]);
        const expr = sub.parseExpr();
        sub.expectEof('in template interpolation');
        parts.push({ expr, spec: part.spec });
      }
    }
    return { kind: 'template', parts, pos: tok.pos };
  }
}

export function parse(tokens: Token[]): Program {
  const parser = new Parser(tokens);
  return parser.parseProgram();
}

/** Parse a single expression from a token stream (no statements/return). */
export function parseExpression(tokens: Token[]): Expr {
  const parser = new Parser(tokens);
  const expr = parser.parseExpr();
  parser.expectEof('after expression');
  return expr;
}
