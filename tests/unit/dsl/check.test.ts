import { describe, it, expect } from 'vitest';
import { lex } from '../../../src/lib/dsl/lexer.js';
import { parse } from '../../../src/lib/dsl/parser.js';
import { check, type Env, type ExpectedType } from '../../../src/lib/dsl/check.js';
import { DslError } from '../../../src/lib/dsl/errors.js';

const MONTHS = ['January', 'February', 'March'];
const ERAS = ['BC', 'AD'];

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    vars: new Map([
      ['year', { kind: 'number' }],
      ['month', { kind: 'named', domain: 'month' }],
      ['era', { kind: 'named', domain: 'era' }],
      ['flag', { kind: 'boolean' }],
    ]),
    namedDomains: new Map([
      ['month', MONTHS],
      ['era', ERAS],
    ]),
    allowNull: false,
    ...over,
  };
}

function run(source: string, expected: ExpectedType = { kind: 'number' }, env = makeEnv()) {
  return check(parse(lex(source)), env, expected);
}

describe('check — identifier resolution and SSA', () => {
  it('accepts bound params and locals', () => {
    expect(() => run('x := year + 1\nreturn x * 2')).not.toThrow();
  });

  it('rejects unresolved identifiers', () => {
    expect(() => run('return bogus + 1')).toThrow(/unresolved|unknown/i);
  });

  it('rejects double assignment (SSA)', () => {
    expect(() => run('x := 1\nx := 2\nreturn x')).toThrow(DslError);
  });

  it('rejects shadowing a bound param', () => {
    expect(() => run('year := 1\nreturn year')).toThrow(DslError);
  });

  it('local type is fixed at first assignment', () => {
    expect(() => run('x := 1\nreturn x and flag')).toThrow(DslError);
  });
});

describe('check — operator typing', () => {
  it('arithmetic requires numbers', () => {
    expect(() => run('return month + 1')).toThrow(DslError);
    expect(() => run('return flag * 2')).toThrow(DslError);
    expect(() => run('return -month')).toThrow(DslError);
  });

  it('bare Named is never numeric', () => {
    expect(() => run('return month % 4')).toThrow(DslError);
  });

  it('and/or/not require booleans', () => {
    expect(() => run('return year and 1', { kind: 'boolean' })).toThrow(DslError);
    expect(() => run('return not year', { kind: 'boolean' })).toThrow(DslError);
    expect(() => run('return flag and not flag', { kind: 'boolean' })).not.toThrow();
  });

  it('ordering comparisons are Number-only', () => {
    expect(() => run('return month < February', { kind: 'boolean' })).toThrow(DslError);
    expect(() => run('return year < 100', { kind: 'boolean' })).not.toThrow();
  });

  it('equality on same-domain Named is legal', () => {
    expect(() => run('return month = February', { kind: 'boolean' })).not.toThrow();
    expect(() => run('return month != March', { kind: 'boolean' })).not.toThrow();
  });

  it('cross-domain Named equality is a static error', () => {
    expect(() => run('return month = era', { kind: 'boolean' })).toThrow(/domain/i);
    expect(() => run('return month = BC', { kind: 'boolean' })).toThrow(DslError);
  });

  it('Named = Number is a static error', () => {
    expect(() => run('return month = 2', { kind: 'boolean' })).toThrow(DslError);
  });

  it('unknown Named literal against a domain is an error', () => {
    expect(() => run('return month = Frobruary', { kind: 'boolean' })).toThrow(DslError);
  });
});

describe('check — functions', () => {
  it('ordinal on Named is legal, result is a Number', () => {
    expect(() => run('return ordinal(month) + 1')).not.toThrow();
    expect(() => run('return ordinal(month, base=0)')).not.toThrow();
  });

  it('ordinal on Number is a static error', () => {
    expect(() => run('return ordinal(year)')).toThrow(DslError);
  });

  it('ordinal base must be an integer literal', () => {
    expect(() => run('return ordinal(month, base=1.5)')).toThrow(DslError);
  });

  it('ceil/floor take one number', () => {
    expect(() => run('return floor(year / 4)')).not.toThrow();
    expect(() => run('return ceil(month)')).toThrow(DslError);
    expect(() => run('return floor(1, 2)')).toThrow(DslError);
  });

  it('min/max take two or more numbers', () => {
    expect(() => run('return min(year, 10, 3)')).not.toThrow();
    expect(() => run('return max(year)')).toThrow(DslError);
    expect(() => run('return min(month, 1)')).toThrow(DslError);
  });
});

describe('check — case expressions', () => {
  it('subject must be Named-typed', () => {
    expect(() => run('return case year when February then 1 else 2')).toThrow(DslError);
  });

  it('when literals must be in the subject domain', () => {
    expect(() => run('return case month when Smarch then 1 else 2')).toThrow(/Smarch/);
  });

  it('exhaustive case without else is legal', () => {
    expect(() =>
      run('return case month when January, February then 1 when March then 2')
    ).not.toThrow();
  });

  it('non-exhaustive case without else lists missing values', () => {
    expect(() => run('return case month when January then 1')).toThrow(/February.*March|March.*February/s);
  });

  it('full coverage plus else yields an unreachable-else warning', () => {
    const { warnings } = run(
      'return case month when January, February then 1 when March then 2 else 3'
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unreachable/i);
  });

  it('branch types must be uniform', () => {
    expect(() => run('return case month when February then 1 else flag')).toThrow(DslError);
  });
});

describe('check — if expressions', () => {
  it('condition must be Boolean', () => {
    expect(() => run('return if year then 1 else 2')).toThrow(DslError);
  });

  it('branch types must match', () => {
    expect(() => run('return if flag then 1 else flag')).toThrow(DslError);
  });
});

describe('check — return typing per attachment point', () => {
  it('range functions expect Number', () => {
    expect(() => run('return if flag then true else false')).toThrow(DslError);
  });

  it('format rules expect String', () => {
    expect(() => run('return "{month} {year}"', { kind: 'string' })).not.toThrow();
    expect(() => run('return year', { kind: 'string' })).toThrow(DslError);
  });

  it('named-typed derived fields accept a Number index or an own-domain literal', () => {
    const exp: ExpectedType = { kind: 'namedOrNumber', domain: 'era' };
    expect(() => run('return year % 2', exp)).not.toThrow();
    expect(() => run('return BC', exp)).not.toThrow();
    expect(() => run('return January', exp)).toThrow(DslError);
  });
});

describe('check — Null carve-out', () => {
  const nullEnv = () => makeEnv({ allowNull: true });

  it('bare return null is legal at numberOrNull attachments', () => {
    expect(() => run('return null', { kind: 'numberOrNull' }, nullEnv())).not.toThrow();
  });

  it('null under case-on-Named is legal at numberOrNull attachments', () => {
    expect(() =>
      run('return case era when BC then null when AD then 1', { kind: 'numberOrNull' }, nullEnv())
    ).not.toThrow();
  });

  it('null is rejected when the attachment does not allow it', () => {
    expect(() => run('return null', { kind: 'number' })).toThrow(DslError);
    expect(() =>
      run('return case era when BC then null when AD then 1', { kind: 'number' })
    ).toThrow(DslError);
  });

  it('null under if is rejected even at numberOrNull attachments', () => {
    expect(() =>
      run('return if year < 0 then null else 1', { kind: 'numberOrNull' }, nullEnv())
    ).toThrow(/if|Number comparison/i);
  });

  it('null in arithmetic is rejected', () => {
    expect(() => run('return null + 1', { kind: 'numberOrNull' }, nullEnv())).toThrow(DslError);
  });
});

describe('check — string templates', () => {
  it('format specs apply to Numbers only', () => {
    expect(() => run('return "{month:02d}"', { kind: 'string' })).toThrow(DslError);
    expect(() => run('return "{year:02d}"', { kind: 'string' })).not.toThrow();
  });

  it('interpolating a String is rejected (no nested templates)', () => {
    expect(() => run('s := "abc"\nreturn "{s}"', { kind: 'string' })).toThrow(DslError);
  });

  it('Named and Boolean interpolate without a spec', () => {
    expect(() => run('return "{month} {flag}"', { kind: 'string' })).not.toThrow();
  });
});

describe('check — dependency scan', () => {
  it('records mod-pattern references', () => {
    const { deps } = run('return if year % 4 = 0 then 366 else 365');
    expect(deps.perVar.get('year')).toEqual({ bare: false, moduli: new Set([4]) });
  });

  it('collects multiple moduli', () => {
    const { deps } = run(
      'return if year % 4 = 0 and not (year % 100 = 0) then 366 else 365'
    );
    expect(deps.perVar.get('year')).toEqual({ bare: false, moduli: new Set([4, 100]) });
  });

  it('bare use anywhere marks the param bare', () => {
    const { deps } = run('return year % 4 + year');
    expect(deps.perVar.get('year')!.bare).toBe(true);
  });

  it('non-literal modulus is a bare use', () => {
    const { deps } = run('n := 4\nreturn year % n');
    expect(deps.perVar.get('year')!.bare).toBe(true);
  });

  it('mod of a compound expression is a bare use', () => {
    const { deps } = run('return (year + 1) % 4');
    expect(deps.perVar.get('year')!.bare).toBe(true);
  });

  it('Named references are recorded', () => {
    const { deps } = run('return case month when February then 28 else 30');
    expect(deps.perVar.has('month')).toBe(true);
  });

  it('unreferenced params are absent', () => {
    const { deps } = run('return 42');
    expect(deps.perVar.size).toBe(0);
  });

  it('references inside locals count', () => {
    const { deps } = run('leap := year % 4 = 0\nreturn if leap then 366 else 365');
    expect(deps.perVar.get('year')).toEqual({ bare: false, moduli: new Set([4]) });
  });
});
