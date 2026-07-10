import { describe, it, expect } from 'vitest';
import { compileCalendar, classifyLevel, widthOfUnit } from '../../../src/lib/calendar/index.js';
import { GREGORIAN, variant } from './fixtures.js';
import { bindParam, emptyScope, resolveParamDomain } from '../../../src/lib/calendar/order.js';
import type { CompiledCalendar } from '../../../src/lib/calendar/index.js';

const FULL_GREGORIAN_LEAP =
  'leap := (year % 4 = 0 and not year % 100 = 0) or year % 400 = 0\n' +
  'return case month when February then (if leap then 29 else 28) ' +
  'when April, June, September, November then 30 else 31';

function levelOf(cal: CompiledCalendar, name: string): number {
  return cal.params.findIndex((p) => p.name === name);
}

/** Width in ticks of the year unit labelled `y`. */
function yearWidth(cal: CompiledCalendar, y: number): number {
  const year = cal.params[0];
  const dom = resolveParamDomain(year, emptyScope(cal));
  return widthOfUnit(cal, 0, bindParam(emptyScope(cal), year, y, dom))!;
}

describe('classifyLevel', () => {
  it('Tier 1 for the Julian %4 rule with period 4', () => {
    const cal = compileCalendar(GREGORIAN);
    expect(classifyLevel(cal.params, levelOf(cal, 'year'))).toEqual({ t: 1, period: 4 });
  });

  it('Tier 0 when no descendant references the level', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => {
        d.params[2].range.to = {
          dsl: 'return case month when February then 28 when April, June, September, November then 30 else 31',
        };
      })
    );
    expect(classifyLevel(cal.params, levelOf(cal, 'year'))).toEqual({ t: 0 });
    // The terminal level has no descendants at all.
    expect(classifyLevel(cal.params, levelOf(cal, 'day'))).toEqual({ t: 0 });
  });

  it('Tier 1 with lcm of multiple moduli (full Gregorian → 400)', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => (d.params[2].range.to = { dsl: FULL_GREGORIAN_LEAP }))
    );
    expect(classifyLevel(cal.params, levelOf(cal, 'year'))).toEqual({ t: 1, period: 400 });
  });

  it('Tier 2 on any bare use', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => {
        d.params[2].range.to = { dsl: 'return if year % 4 = 0 and year < 1582 then 29 else 28' };
      })
    );
    expect(classifyLevel(cal.params, levelOf(cal, 'year'))).toEqual({ t: 2 });
  });

  it('Tier 2 when the lcm exceeds the cycle-table cap', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => {
        d.params[2].range.to = { dsl: 'return if year % 20011 = 0 then 29 else 28' };
      })
    );
    expect(classifyLevel(cal.params, levelOf(cal, 'year'))).toEqual({ t: 2 });
  });

  it('step rules do not affect width periodicity', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => {
        d.params[2].step = { dsl: 'return if year % 7 = 0 then 1 else -1' };
        d.params[2].range.from = { dsl: 'return if year % 7 = 0 then 1 else 30' };
        d.params[2].range.to = { dsl: 'return if year % 7 = 0 then 30 else 1' };
      })
    );
    // step's %7 is display-only; range.from's %7 does count.
    expect(classifyLevel(cal.params, levelOf(cal, 'year'))).toEqual({ t: 1, period: 7 });
  });
});

describe('cycle widths', () => {
  it('Julian year widths over one period: 366 only when year % 4 = 0', () => {
    const cal = compileCalendar(GREGORIAN);
    expect([1, 2, 3, 4].map((y) => yearWidth(cal, y))).toEqual([365, 365, 365, 366]);
    // Euclidean %: pre-epoch years follow the same cycle.
    expect(yearWidth(cal, -4)).toBe(366);
    expect(yearWidth(cal, -1)).toBe(365);
  });

  it('full Gregorian 400-year cycle sums to 146097 days', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => (d.params[2].range.to = { dsl: FULL_GREGORIAN_LEAP }))
    );
    let total = 0;
    for (let y = 1; y <= 400; y++) total += yearWidth(cal, y);
    expect(total).toBe(146097);
  });
});
