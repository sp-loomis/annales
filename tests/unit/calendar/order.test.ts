import { describe, it, expect } from 'vitest';
import { compileCalendar, CalendarError } from '../../../src/lib/calendar/index.js';
import { GREGORIAN, LONG_RECKONING, variant } from './fixtures.js';

describe('Null legality — condition 1: all-Named ancestor chain', () => {
  it('rejects the December trap (Number ancestor above the Null-bearing param)', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[2].range.to = {
            dsl: 'return case month when December then null else 30',
          };
        })
      )
    ).toThrow(/Number|ancestor/i);
  });

  it('rejects Null when the direct ancestor is a Number param', () => {
    expect(() =>
      compileCalendar({
        version: 1,
        params: [
          { name: 'year', type: 'number', range: { from: 1, to: 100 } },
          { name: 'term', type: 'number', range: { from: 1, to: null }, unitTicks: 1 },
        ],
        epoch: { year: 1, term: 1 },
      })
    ).toThrow(/Number|ancestor/i);
  });

  it('accepts Null on the top param (no ancestors)', () => {
    expect(() =>
      compileCalendar({
        version: 1,
        params: [{ name: 'cycle', type: 'number', range: { from: null, to: null }, unitTicks: 10 }],
        epoch: { cycle: 1 },
      })
    ).not.toThrow();
  });
});

describe('Null legality — condition 2: tick-order extremality', () => {
  it('accepts the BC/AD pattern (open ends at both tick extremes)', () => {
    expect(() => compileCalendar(LONG_RECKONING)).not.toThrow();
  });

  it('rejects an open `from` under a non-first era', () => {
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[1].range.from = { dsl: 'return case era when BC then 1 when AD then null' };
          d.params[1].range.to = { dsl: 'return case era when BC then 100 when AD then 100' };
          d.params[1].step = 1;
          d.epoch = { era: 'AD', year: 1, month: 'Frostwane', day: 1 };
        })
      )
    ).toThrow(/extremal|first|order/i);
  });

  it('rejects an open `to` under a non-last era', () => {
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[1].range.from = { dsl: 'return case era when BC then 1 when AD then 1' };
          d.params[1].range.to = { dsl: 'return case era when BC then null when AD then 100' };
          d.params[1].step = 1;
        })
      )
    ).toThrow(/extremal|last|order/i);
  });

  it('extremality follows step-derived tick order, not declaration order', () => {
    // era step -1 → tick order is [AD, BC]: open `from` under AD becomes legal.
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[0].step = -1;
          d.params[1].range.from = { dsl: 'return case era when BC then 1 when AD then null' };
          d.params[1].range.to = { dsl: 'return case era when BC then 100 when AD then 100' };
          d.params[1].step = 1;
          d.epoch = { era: 'BC', year: 1, month: 'Frostwane', day: 1 };
        })
      )
    ).not.toThrow();
  });

  it('a constant null bound under a multi-valued Named ancestor is rejected', () => {
    // from: null applies in BOTH eras; AD is not tick-order-first → illegal.
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[1].range.from = null;
          d.params[1].range.to = { dsl: 'return case era when BC then 1 when AD then null' };
          d.params[1].step = 1;
        })
      )
    ).toThrow(CalendarError);
  });

  it('checks extremality recursively at every level of the chain', () => {
    const nested = (openAge: string) => ({
      version: 1,
      params: [
        { name: 'era', type: 'named', values: ['Elder', 'Younger'] },
        { name: 'age', type: 'named', values: ['Dawn', 'Dusk'] },
        {
          name: 'year',
          type: 'number',
          range: {
            from: {
              dsl: `return case age when ${openAge} then (case era when Elder then null else 1) else 1`,
            },
            to: 100,
          },
          unitTicks: 1,
        },
      ],
      epoch: { era: 'Younger', age: 'Dawn', year: 1 },
    });
    // Elder/Dawn is tick-order-first at both levels → legal.
    expect(() => compileCalendar(nested('Dawn'))).not.toThrow();
    // Elder/Dusk: era is first but age is not → illegal.
    expect(() => compileCalendar(nested('Dusk'))).toThrow(CalendarError);
  });
});

describe('Null legality — condition 3 and expression restrictions', () => {
  it('unitTicks may never be Null', () => {
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[3].unitTicks = {
            dsl: 'return case era when BC then null when AD then 1',
          };
        })
      )
    ).toThrow(CalendarError);
  });

  it('null under if is rejected', () => {
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[1].range.from = { dsl: 'return if ordinal(era) = 1 then null else 1' };
        })
      )
    ).toThrow(CalendarError);
  });

  it('null is rejected at count and step attachments', () => {
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[2].count = { dsl: 'return case era when BC then null when AD then 2' };
        })
      )
    ).toThrow(CalendarError);
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[1].step = { dsl: 'return case era when BC then null when AD then 1' };
        })
      )
    ).toThrow(CalendarError);
  });
});

describe('tick order of Named params', () => {
  it('is declaration order for step 1 and reversed for step -1', () => {
    const cal = compileCalendar(LONG_RECKONING);
    expect(cal.params[0].values).toEqual(['BC', 'AD']);
    const reversed = compileCalendar(
      variant(LONG_RECKONING, (d) => {
        d.params[0].step = -1;
        d.params[1].range.from = { dsl: 'return case era when BC then 1 when AD then null' };
        d.params[1].range.to = { dsl: 'return case era when BC then null when AD then 100' };
        d.params[1].step = { dsl: 'return case era when BC then 1 when AD then -1' };
        d.epoch = { era: 'BC', year: 1, month: 'Frostwane', day: 1 };
      })
    );
    expect(reversed.params[0].step).toEqual({ kind: 'const', value: -1 });
  });
});
