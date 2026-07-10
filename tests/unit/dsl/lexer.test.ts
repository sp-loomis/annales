import { describe, it, expect } from 'vitest';
import { lex } from '../../../src/lib/dsl/lexer.js';
import { DslError } from '../../../src/lib/dsl/errors.js';
import type { Token, TemplatePart } from '../../../src/lib/dsl/token.js';

function kinds(source: string): string[] {
  return lex(source).map((t) => t.kind);
}

describe('lexer — tokens', () => {
  it('lexes identifiers, numbers, and operators', () => {
    expect(kinds('year_2 + 3 * (x - 4) / 5 % 6')).toEqual([
      'ident', '+', 'number', '*', '(', 'ident', '-', 'number', ')', '/', 'number', '%', 'number', 'eof',
    ]);
  });

  it('lexes keywords as distinct kinds', () => {
    expect(kinds('case when then else if and or not true false null return')).toEqual([
      'case', 'when', 'then', 'else', 'if', 'and', 'or', 'not', 'true', 'false', 'null', 'return', 'eof',
    ]);
  });

  it('keywords are case-sensitive: capitalized forms are identifiers', () => {
    expect(kinds('Case True Null')).toEqual(['ident', 'ident', 'ident', 'eof']);
  });

  it('lexes comparison and assignment operators', () => {
    expect(kinds('a := b = c != d < e <= f > g >= h')).toEqual([
      'ident', ':=', 'ident', '=', 'ident', '!=', 'ident', '<', 'ident', '<=', 'ident', '>', 'ident', '>=', 'ident', 'eof',
    ]);
  });

  it('lexes integer and decimal numbers with values', () => {
    const toks = lex('42 3.25 0.5');
    expect(toks.map((t) => t.value)).toEqual([42, 3.25, 0.5, undefined]);
  });

  it('rejects a trailing decimal point', () => {
    expect(() => lex('3.')).toThrow(DslError);
  });

  it('skips comments to end of line', () => {
    expect(kinds('a # this is a comment\nb')).toEqual(['ident', 'ident', 'eof']);
  });

  it('tracks line and column positions', () => {
    const toks = lex('a\n  bcd');
    expect(toks[0].pos).toEqual({ line: 1, col: 1 });
    expect(toks[1].pos).toEqual({ line: 2, col: 3 });
  });

  it('rejects unknown characters with position info', () => {
    try {
      lex('a @ b');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DslError);
      expect((err as DslError).pos).toEqual({ line: 1, col: 3 });
    }
  });

  it('rejects a bare ! (only != exists)', () => {
    expect(() => lex('a ! b')).toThrow(DslError);
  });
});

describe('lexer — string templates', () => {
  function parts(source: string): TemplatePart[] {
    const toks = lex(source);
    expect(toks[0].kind).toBe('template');
    return toks[0].parts!;
  }

  it('lexes a plain string as a single text part', () => {
    expect(parts('"hello world"')).toEqual([{ text: 'hello world' }]);
  });

  it('handles escape sequences', () => {
    expect(parts('"a\\"b\\\\c\\nd\\te"')).toEqual([{ text: 'a"b\\c\nd\te' }]);
  });

  it('rejects invalid escapes', () => {
    expect(() => lex('"bad \\x escape"')).toThrow(DslError);
  });

  it('lexes interpolations into sub-token streams', () => {
    const p = parts('"{month} {day}, {year}"');
    expect(p).toHaveLength(5);
    const interp = p[0] as { tokens: Token[] };
    expect(interp.tokens.map((t) => t.kind)).toEqual(['ident']);
    expect(p[1]).toEqual({ text: ' ' });
    expect(p[3]).toEqual({ text: ', ' });
  });

  it('lexes format specs: zero-padded int', () => {
    const p = parts('"{day:02d}"');
    const interp = p[0] as { tokens: Token[]; spec: unknown };
    expect(interp.spec).toEqual({ kind: 'int', width: 2 });
  });

  it('lexes format specs: fixed decimal', () => {
    const p = parts('"{x:0.2f}"');
    const interp = p[0] as { tokens: Token[]; spec: unknown };
    expect(interp.spec).toEqual({ kind: 'fixed', places: 2 });
  });

  it('rejects malformed format specs', () => {
    expect(() => lex('"{x:2q}"')).toThrow(DslError);
    expect(() => lex('"{x:d}"')).toThrow(DslError);
  });

  it('interpolation expressions may contain full expressions with parens and colons only as spec separator', () => {
    const p = parts('"{ordinal(month, base=0) + 1:03d}"');
    const interp = p[0] as { tokens: Token[]; spec: unknown };
    expect(interp.spec).toEqual({ kind: 'int', width: 3 });
    expect(interp.tokens.map((t) => t.kind)).toEqual([
      'ident', '(', 'ident', ',', 'ident', '=', 'number', ')', '+', 'number',
    ]);
  });

  it('rejects unterminated strings', () => {
    expect(() => lex('"never ends')).toThrow(DslError);
    expect(() => lex('"{x} and then')).toThrow(DslError);
  });

  it('rejects a raw newline inside a string', () => {
    expect(() => lex('"line one\nline two"')).toThrow(DslError);
  });

  it('rejects a bare closing brace in string text', () => {
    expect(() => lex('"oops } here"')).toThrow(DslError);
  });

  it('rejects an empty interpolation', () => {
    expect(() => lex('"{}"')).toThrow(DslError);
  });
});
