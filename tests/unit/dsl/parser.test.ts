import { describe, it, expect } from 'vitest';
import { lex } from '../../../src/lib/dsl/lexer.js';
import { parse } from '../../../src/lib/dsl/parser.js';
import { DslError } from '../../../src/lib/dsl/errors.js';
import type { Expr, Program } from '../../../src/lib/dsl/ast.js';

function parseSrc(source: string): Program {
  return parse(lex(source));
}

/** Parse `return <expr>` and give back the expression. */
function expr(source: string): Expr {
  return parseSrc(`return ${source}`).ret;
}

/** Compact s-expression rendering for precedence assertions. */
function sexp(e: Expr): string {
  switch (e.kind) {
    case 'number':
      return String(e.value);
    case 'bool':
      return String(e.value);
    case 'null':
      return 'null';
    case 'ident':
      return e.name;
    case 'unary':
      return `(${e.op} ${sexp(e.operand)})`;
    case 'binary':
    case 'compare':
    case 'logic':
      return `(${e.op} ${sexp(e.left)} ${sexp(e.right)})`;
    case 'call':
      return `(${e.name}${e.base !== undefined ? `[base=${e.base}]` : ''} ${e.args.map(sexp).join(' ')})`;
    case 'if':
      return `(if ${sexp(e.cond)} ${sexp(e.then)} ${sexp(e.else)})`;
    case 'case':
      return `(case ${e.subject}${e.clauses
        .map((c) => ` [${c.values.map((v) => v.name).join(',')} ${sexp(c.expr)}]`)
        .join('')}${e.elseExpr ? ` (else ${sexp(e.elseExpr)})` : ''})`;
    case 'template':
      return `(tpl ${e.parts.map((p) => ('text' in p ? JSON.stringify(p.text) : sexp(p.expr))).join(' ')})`;
  }
}

describe('parser — program structure', () => {
  it('parses assignments followed by return', () => {
    const p = parseSrc('leap := year % 4 = 0\nreturn if leap then 29 else 28');
    expect(p.statements).toHaveLength(1);
    expect(p.statements[0].name).toBe('leap');
    expect(p.ret.kind).toBe('if');
  });

  it('requires a return statement', () => {
    expect(() => parseSrc('x := 1')).toThrow(DslError);
  });

  it('rejects statements after return', () => {
    expect(() => parseSrc('return 1\nx := 2')).toThrow(DslError);
    expect(() => parseSrc('return 1\nreturn 2')).toThrow(DslError);
  });

  it('rejects assignment to reserved names', () => {
    expect(() => parseSrc('ordinal := 1\nreturn ordinal')).toThrow(DslError);
    expect(() => parseSrc('true := 1\nreturn 1')).toThrow(DslError);
  });

  it('rejects bare expressions as statements', () => {
    expect(() => parseSrc('1 + 2\nreturn 3')).toThrow(DslError);
  });
});

describe('parser — precedence and associativity', () => {
  it('multiplication binds tighter than addition', () => {
    expect(sexp(expr('1 + 2 * 3'))).toBe('(+ 1 (* 2 3))');
  });

  it('arithmetic is left-associative', () => {
    expect(sexp(expr('1 - 2 - 3'))).toBe('(- (- 1 2) 3)');
    expect(sexp(expr('12 / 3 / 2'))).toBe('(/ (/ 12 3) 2)');
  });

  it('unary minus binds tighter than * and %', () => {
    expect(sexp(expr('-a * b'))).toBe('(* (- a) b)');
    expect(sexp(expr('-3 % 7'))).toBe('(% (- 3) 7)');
  });

  it('unary minus nests', () => {
    expect(sexp(expr('- -x'))).toBe('(- (- x))');
  });

  it('not binds looser than comparison, tighter than and', () => {
    expect(sexp(expr('not a = b'))).toBe('(not (= a b))');
    expect(sexp(expr('not a and b'))).toBe('(and (not a) b)');
  });

  it('and binds tighter than or', () => {
    expect(sexp(expr('a or b and c'))).toBe('(or a (and b c))');
  });

  it('comparison binds tighter than boolean ops', () => {
    expect(sexp(expr('x = 1 and y != 2'))).toBe('(and (= x 1) (!= y 2))');
  });

  it('comparisons do not chain (non-associative)', () => {
    expect(() => expr('a = b = c')).toThrow(DslError);
    expect(() => expr('a < b <= c')).toThrow(DslError);
  });

  it('parens override precedence', () => {
    expect(sexp(expr('(1 + 2) * 3'))).toBe('(* (+ 1 2) 3)');
  });
});

describe('parser — case expressions', () => {
  it('parses when clauses with multiple values and else', () => {
    const e = expr(
      'case month when February then 28 when April, June, September, November then 30 else 31'
    );
    expect(sexp(e)).toBe(
      '(case month [February 28] [April,June,September,November 30] (else 31))'
    );
  });

  it('parses case without else', () => {
    const e = expr('case era when BC then 1 when AD then 2');
    expect(sexp(e)).toBe('(case era [BC 1] [AD 2])');
  });

  it('case subject must be an identifier', () => {
    expect(() => expr('case 3 when A then 1 else 2')).toThrow(DslError);
  });

  it('requires at least one when clause', () => {
    expect(() => expr('case month else 3')).toThrow(DslError);
  });

  it('branch expressions consume greedily and stop at when/else', () => {
    const e = expr('case m when A then 1 + 2 when B then x * y else 4 - 1');
    expect(sexp(e)).toBe('(case m [A (+ 1 2)] [B (* x y)] (else (- 4 1)))');
  });

  it('nested case in a branch consumes following clauses greedily', () => {
    const e = expr('case m when A then case n when B then 1 else 2 else 3');
    expect(sexp(e)).toBe('(case m [A (case n [B 1] (else 2))] (else 3))');
  });
});

describe('parser — if expressions', () => {
  it('parses if/then/else', () => {
    expect(sexp(expr('if x > 0 then 1 else 2'))).toBe('(if (> x 0) 1 2)');
  });

  it('else is mandatory', () => {
    expect(() => expr('if x then 1')).toThrow(DslError);
  });

  it('dangling else binds to the inner if', () => {
    expect(sexp(expr('if a then if b then 1 else 2 else 3'))).toBe(
      '(if a (if b 1 2) 3)'
    );
  });

  it('case/if as a binary operand requires parens', () => {
    expect(() => expr('1 + if a then 2 else 3')).toThrow(DslError);
    expect(() => expr('1 + case m when A then 1 else 2')).toThrow(DslError);
    expect(sexp(expr('1 + (if a then 2 else 3)'))).toBe('(+ 1 (if a 2 3))');
    expect(sexp(expr('(case m when A then 1 else 2) * 2'))).toBe(
      '(* (case m [A 1] (else 2)) 2)'
    );
  });

  it('if condition may itself be an if or case expression', () => {
    expect(sexp(expr('if if a then b else c then 1 else 2'))).toBe(
      '(if (if a b c) 1 2)'
    );
  });
});

describe('parser — function calls', () => {
  it('parses known functions', () => {
    expect(sexp(expr('ordinal(month)'))).toBe('(ordinal month)');
    expect(sexp(expr('min(a, b, c)'))).toBe('(min a b c)');
    expect(sexp(expr('floor(x / 2)'))).toBe('(floor (/ x 2))');
  });

  it('parses ordinal base kwarg as a literal', () => {
    const e = expr('ordinal(month, base=0)');
    expect(sexp(e)).toBe('(ordinal[base=0] month)');
  });

  it('base kwarg must be a number literal', () => {
    expect(() => expr('ordinal(month, base=x)')).toThrow(DslError);
    expect(() => expr('ordinal(month, base=1+1)')).toThrow(DslError);
  });

  it('base kwarg must be last', () => {
    expect(() => expr('ordinal(base=0, month)')).toThrow(DslError);
  });

  it('rejects unknown function names', () => {
    expect(() => expr('frobnicate(x)')).toThrow(DslError);
  });
});

describe('parser — templates', () => {
  it('parses template parts into expressions', () => {
    const e = expr('"{month} {day:02d}, {year}"');
    expect(sexp(e)).toBe('(tpl month " " day ", " year)');
  });

  it('template interpolations may hold full expressions', () => {
    const e = expr('"{1 - year} BC"');
    expect(sexp(e)).toBe('(tpl (- 1 year) " BC")');
  });
});
