import { describe, it, expect } from 'vitest';
import { compileRule } from '../../../src/lib/dsl/index.js';
import type { Env, ExpectedType } from '../../../src/lib/dsl/check.js';
import type { Bindings, Value } from '../../../src/lib/dsl/eval.js';
import { DslError } from '../../../src/lib/dsl/errors.js';

const MONTHS = ['January', 'February', 'March'];

function env(over: Partial<Env> = {}): Env {
  return {
    vars: new Map([
      ['year', { kind: 'number' }],
      ['month', { kind: 'named', domain: 'month' }],
      ['flag', { kind: 'boolean' }],
    ]),
    namedDomains: new Map([['month', MONTHS]]),
    allowNull: false,
    ...over,
  };
}

function bindings(over: Partial<Record<string, Value>> = {}, active?: string[]): Bindings {
  return {
    values: new Map<string, Value>([
      ['year', 5],
      ['month', { domain: 'month', value: 'February' }],
      ['flag', true],
      ...Object.entries(over).map(([k, v]) => [k, v] as [string, Value]),
    ]),
    activeDomains: new Map([['month', active ?? MONTHS]]),
    displays: new Map([['month', new Map([['February', 'The Frozen Month']])]]),
  };
}

function evalRule(
  source: string,
  expected: ExpectedType = { kind: 'number' },
  b: Bindings = bindings(),
  e: Env = env()
): Value {
  return compileRule(source, e, expected).evaluate(b);
}

describe('eval — arithmetic', () => {
  it('is real-valued inside a body', () => {
    expect(evalRule('return 7 / 4')).toBe(1.75);
    expect(evalRule('return year / 4')).toBe(1.25);
  });

  it('%. is floored (Euclidean): sign of the divisor', () => {
    expect(evalRule('x := 0 - 2\nreturn x % 4')).toBe(2);
    expect(evalRule('x := 0 - 1\nreturn x % 7')).toBe(6);
    expect(evalRule('return 5 % (0 - 3)')).toBe(-1);
    expect(evalRule('return -3 % 7')).toBe(4);
  });

  it('supports floor/ceil/min/max', () => {
    expect(evalRule('return floor(7 / 4)')).toBe(1);
    expect(evalRule('return ceil(7 / 4)')).toBe(2);
    expect(evalRule('return min(3, 1, 2)')).toBe(1);
    expect(evalRule('return max(3, 1, 2)')).toBe(3);
    expect(evalRule('return floor(0 - 1.5)')).toBe(-2);
  });

  it('division by zero is a runtime error', () => {
    expect(() => evalRule('return 1 / 0')).toThrow(DslError);
    expect(() => evalRule('return 1 % 0')).toThrow(DslError);
  });
});

describe('eval — control flow', () => {
  it('dispatches case on the subject value', () => {
    expect(
      evalRule('return case month when February then 28 when January, March then 31')
    ).toBe(28);
  });

  it('falls through to else', () => {
    expect(evalRule('return case month when January then 31 else 30')).toBe(30);
  });

  it('evaluates if by condition', () => {
    expect(evalRule('return if year % 4 = 0 then 366 else 365')).toBe(365);
    expect(evalRule('return if year > 0 and flag then 1 else 2')).toBe(1);
  });

  it('locals evaluate once and are visible downstream', () => {
    expect(evalRule('leap := year % 4 = 1\nreturn if leap then 366 else 365')).toBe(366);
  });
});

describe('eval — ordinal', () => {
  it('is 1-indexed against the active domain', () => {
    expect(evalRule('return ordinal(month)')).toBe(2);
  });

  it('honors base=', () => {
    expect(evalRule('return ordinal(month, base=0)')).toBe(1);
  });

  it('counts against the active (dynamic) domain, not the full declaration', () => {
    const b = bindings({ month: { domain: 'month', value: 'March' } }, ['March', 'January']);
    expect(evalRule('return ordinal(month)', { kind: 'number' }, b)).toBe(1);
  });

  it('value outside the active domain is a runtime error', () => {
    const b = bindings({}, ['January']); // February not active
    expect(() => evalRule('return ordinal(month)', { kind: 'number' }, b)).toThrow(DslError);
  });
});

describe('eval — named equality', () => {
  it('compares Named values directly', () => {
    expect(evalRule('return month = February', { kind: 'boolean' })).toBe(true);
    expect(evalRule('return month != January', { kind: 'boolean' })).toBe(true);
  });
});

describe('eval — templates', () => {
  it('renders text and interpolations', () => {
    expect(evalRule('return "year {year}!"', { kind: 'string' })).toBe('year 5!');
  });

  it('renders Named values with their display name', () => {
    expect(evalRule('return "{month}"', { kind: 'string' })).toBe('The Frozen Month');
  });

  it('falls back to the value id when no display name exists', () => {
    const b = bindings({ month: { domain: 'month', value: 'March' } });
    expect(evalRule('return "{month}"', { kind: 'string' }, b)).toBe('March');
  });

  it('renders booleans as true/false', () => {
    expect(evalRule('return "{flag}"', { kind: 'string' })).toBe('true');
  });

  it('zero-pads with Nd', () => {
    expect(evalRule('return "{year:03d}"', { kind: 'string' })).toBe('005');
  });

  it('zero-pads negative numbers with the sign inside the width', () => {
    const b = bindings({ year: -5 });
    expect(evalRule('return "{year:03d}"', { kind: 'string' }, b)).toBe('-05');
  });

  it('a d-spec on a fractional value is a runtime error', () => {
    expect(() => evalRule('return "{year / 2:02d}"', { kind: 'string' })).toThrow(DslError);
  });

  it('renders fixed decimals with 0.Nf', () => {
    expect(evalRule('return "{year / 4:0.2f}"', { kind: 'string' })).toBe('1.25');
    expect(evalRule('return "{year:0.2f}"', { kind: 'string' })).toBe('5.00');
  });

  it('renders plain numbers without padding', () => {
    expect(evalRule('return "{year / 4}"', { kind: 'string' })).toBe('1.25');
  });

  it('interpolates a computed String local', () => {
    expect(
      evalRule('m := "{month} {year}"\nreturn "Date: {m}"', { kind: 'string' })
    ).toBe('Date: The Frozen Month 5');
  });

  it('a format spec on a String interpolation is a static error', () => {
    expect(() =>
      evalRule('m := "{year}"\nreturn "{m:03d}"', { kind: 'string' })
    ).toThrow(DslError);
  });
});

describe('eval — Named branches (domain hint)', () => {
  const eraEnv = (): Env =>
    env({
      vars: new Map([
        ['year', { kind: 'number' }],
        ['era', { kind: 'named', domain: 'era' }],
        ['flag', { kind: 'boolean' }],
      ]),
      namedDomains: new Map([['era', ['BC', 'AD']]]),
    });
  const eraBindings = (era: string): Bindings => ({
    values: new Map<string, Value>([
      ['year', 5],
      ['era', { domain: 'era', value: era }],
      ['flag', true],
    ]),
    activeDomains: new Map([['era', ['BC', 'AD']]]),
  });
  const expected: ExpectedType = { kind: 'namedOrNumber', domain: 'era' };

  // A bare-literal Named result evaluates to a value-only NamedValue (empty domain);
  // the calendar engine reconstructs the domain from the field's declaration, exactly
  // as a direct `return AD` does. Only the `value` id is carried by the DSL.
  it('resolves all-literal if branches against the return domain', () => {
    expect(
      evalRule('return if year >= 1 then AD else BC', expected, eraBindings('AD'), eraEnv())
    ).toEqual({ domain: '', value: 'AD' });
    expect(
      evalRule('return if year >= 100 then AD else BC', expected, eraBindings('BC'), eraEnv())
    ).toEqual({ domain: '', value: 'BC' });
  });

  it('resolves all-literal case clauses against the return domain', () => {
    expect(
      evalRule('return case era when BC then BC when AD then AD', expected, eraBindings('AD'), eraEnv())
    ).toEqual({ domain: '', value: 'AD' });
  });

  it('resolves a nested if inside a case clause', () => {
    expect(
      evalRule(
        'return case era when BC then BC when AD then (if year >= 1 then AD else BC)',
        expected,
        eraBindings('AD'),
        eraEnv()
      )
    ).toEqual({ domain: '', value: 'AD' });
  });

  it('rejects a wrong-domain literal in a branch', () => {
    expect(() =>
      evalRule('return if flag then January else BC', expected, eraBindings('AD'), eraEnv())
    ).toThrow(DslError);
  });
});

describe('eval — null', () => {
  it('returns null from a case branch at a numberOrNull attachment', () => {
    const e = env({
      vars: new Map([['era', { kind: 'named', domain: 'era' }]]),
      namedDomains: new Map([['era', ['BC', 'AD']]]),
      allowNull: true,
    });
    const b: Bindings = {
      values: new Map<string, Value>([['era', { domain: 'era', value: 'BC' }]]),
      activeDomains: new Map([['era', ['BC', 'AD']]]),
    };
    expect(
      evalRule('return case era when BC then null when AD then 1', { kind: 'numberOrNull' }, b, e)
    ).toBe(null);
  });
});
