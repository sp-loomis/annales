import { describe, it, expect } from 'vitest';
import {
  compileCalendar,
  dateToTicks,
  tickToDate,
  CalendarError,
} from '../../../src/lib/calendar/index.js';
import { GREGORIAN, LONG_RECKONING, variant } from './fixtures.js';

const greg = compileCalendar(GREGORIAN);
const reck = compileCalendar(LONG_RECKONING);

describe('dateToTicks — Gregorian', () => {
  it('epoch full tuple is [0, 1)', () => {
    expect(dateToTicks(greg, { year: 1, month: 'January', day: 1 })).toEqual({
      tickStart: 0,
      tickEnd: 1,
    });
  });

  it('walks days, months, and years forward', () => {
    expect(dateToTicks(greg, { year: 1, month: 'January', day: 2 })).toEqual({
      tickStart: 1,
      tickEnd: 2,
    });
    expect(dateToTicks(greg, { year: 1, month: 'February', day: 1 })).toEqual({
      tickStart: 31,
      tickEnd: 32,
    });
    // Year 1..3 are 365 days; year 4 is leap.
    expect(dateToTicks(greg, { year: 2, month: 'January', day: 1 })).toEqual({
      tickStart: 365,
      tickEnd: 366,
    });
    expect(dateToTicks(greg, { year: 5, month: 'January', day: 1 })).toEqual({
      tickStart: 365 * 4 + 1,
      tickEnd: 365 * 4 + 2,
    });
  });

  it('prefixes denote whole-unit intervals', () => {
    expect(dateToTicks(greg, { year: 2 })).toEqual({ tickStart: 365, tickEnd: 730 });
    expect(dateToTicks(greg, { year: 1, month: 'February' })).toEqual({
      tickStart: 31,
      tickEnd: 59,
    });
    expect(dateToTicks(greg, { year: 4, month: 'February' })).toEqual({
      tickStart: 365 * 3 + 31,
      tickEnd: 365 * 3 + 60, // 29 leap days
    });
  });

  it('pre-epoch dates produce exact negative ticks', () => {
    // Year 0 precedes year 1 and is leap (0 % 4 = 0): 366 days.
    expect(dateToTicks(greg, { year: 0 })).toEqual({ tickStart: -366, tickEnd: 0 });
    expect(dateToTicks(greg, { year: 0, month: 'December', day: 31 })).toEqual({
      tickStart: -1,
      tickEnd: 0,
    });
    expect(dateToTicks(greg, { year: -1 })).toEqual({ tickStart: -731, tickEnd: -366 });
  });

  it('leap-gated dates exist only in leap years', () => {
    expect(dateToTicks(greg, { year: 4, month: 'February', day: 29 })).toEqual({
      tickStart: 365 * 3 + 59,
      tickEnd: 365 * 3 + 60,
    });
    expect(() => dateToTicks(greg, { year: 3, month: 'February', day: 29 })).toThrow(
      CalendarError
    );
  });

  it('rejects out-of-domain and malformed components', () => {
    expect(() => dateToTicks(greg, { year: 1, month: 'January', day: 32 })).toThrow(/day/);
    expect(() => dateToTicks(greg, { year: 1, month: 'Smarch', day: 1 })).toThrow(/month/);
    expect(() => dateToTicks(greg, { year: 10000 })).toThrow(/year/);
    expect(() => dateToTicks(greg, {})).toThrow(CalendarError);
    expect(() => dateToTicks(greg, { year: 1, day: 1 })).toThrow(/month/);
    expect(() => dateToTicks(greg, { month: 'January' })).toThrow(CalendarError);
    expect(() => dateToTicks(greg, { year: '1' })).toThrow(CalendarError);
    expect(() => dateToTicks(greg, { year: 1, hour: 3 })).toThrow(/hour/);
  });
});

describe('dateToTicks — open eras (LONG_RECKONING)', () => {
  it('open prefixes have a null side', () => {
    expect(dateToTicks(reck, { era: 'BC' })).toEqual({ tickStart: null, tickEnd: 0 });
    expect(dateToTicks(reck, { era: 'AD' })).toEqual({ tickStart: 0, tickEnd: null });
  });

  it('bound years inside an open era are finite', () => {
    // 2 months × 30 days = 60-tick years; BC years count down toward tick 0.
    expect(dateToTicks(reck, { era: 'BC', year: 1 })).toEqual({ tickStart: -60, tickEnd: 0 });
    expect(dateToTicks(reck, { era: 'BC', year: 2 })).toEqual({ tickStart: -120, tickEnd: -60 });
    expect(dateToTicks(reck, { era: 'AD', year: 2 })).toEqual({ tickStart: 60, tickEnd: 120 });
  });

  it('BC/AD adjacency is exact at the epoch boundary', () => {
    expect(dateToTicks(reck, { era: 'BC', year: 1, month: 'Sunreach', day: 30 })).toEqual({
      tickStart: -1,
      tickEnd: 0,
    });
    expect(dateToTicks(reck, { era: 'AD', year: 1, month: 'Frostwane', day: 1 })).toEqual({
      tickStart: 0,
      tickEnd: 1,
    });
  });
});

describe('tickToDate', () => {
  it('inverts the epoch and nearby ticks', () => {
    expect(tickToDate(greg, 0)).toEqual({ year: 1, month: 'January', day: 1 });
    expect(tickToDate(greg, 1)).toEqual({ year: 1, month: 'January', day: 2 });
    expect(tickToDate(greg, 31)).toEqual({ year: 1, month: 'February', day: 1 });
    expect(tickToDate(greg, 365)).toEqual({ year: 2, month: 'January', day: 1 });
  });

  it('handles negative ticks with Euclidean arithmetic', () => {
    expect(tickToDate(greg, -1)).toEqual({ year: 0, month: 'December', day: 31 });
    expect(tickToDate(greg, -366)).toEqual({ year: 0, month: 'January', day: 1 });
    expect(tickToDate(greg, -367)).toEqual({ year: -1, month: 'December', day: 31 });
  });

  it('jumps far from the epoch with Tier-1 arithmetic', () => {
    // 400 Julian years = 100 cycles of 1461 days.
    expect(tickToDate(greg, 1461 * 100)).toEqual({ year: 401, month: 'January', day: 1 });
    expect(tickToDate(greg, -1461 * 100)).toEqual({ year: -399, month: 'January', day: 1 });
  });

  it('descends into open eras', () => {
    expect(tickToDate(reck, -1)).toEqual({ era: 'BC', year: 1, month: 'Sunreach', day: 30 });
    expect(tickToDate(reck, -61)).toEqual({ era: 'BC', year: 2, month: 'Sunreach', day: 30 });
    expect(tickToDate(reck, 0)).toEqual({ era: 'AD', year: 1, month: 'Frostwane', day: 1 });
    expect(tickToDate(reck, 6000000)).toEqual({
      era: 'AD',
      year: 100001,
      month: 'Frostwane',
      day: 1,
    });
  });

  it('rejects ticks outside a bounded calendar', () => {
    const bounded = compileCalendar(
      variant(LONG_RECKONING, (d) => {
        d.params[1].range.from = { dsl: 'return case era when BC then 10 when AD then 1' };
        d.params[1].range.to = { dsl: 'return case era when BC then 1 when AD then 10' };
      })
    );
    expect(tickToDate(bounded, -600)).toEqual({
      era: 'BC',
      year: 10,
      month: 'Frostwane',
      day: 1,
    });
    expect(() => tickToDate(bounded, -601)).toThrow(/outside/);
    expect(() => tickToDate(bounded, 600)).toThrow(/outside/);
    expect(tickToDate(bounded, 599)).toEqual({
      era: 'AD',
      year: 10,
      month: 'Sunreach',
      day: 30,
    });
  });

  it('rejects non-integer and unsafe ticks', () => {
    expect(() => tickToDate(greg, 1.5)).toThrow(CalendarError);
    expect(() => tickToDate(greg, 2 ** 53)).toThrow(CalendarError);
  });
});

describe('round trips', () => {
  it('date → tick → date over sampled Gregorian dates (incl. pre-epoch)', () => {
    const months = GREGORIAN.params[1].values as string[];
    for (let i = 0; i < 300; i++) {
      // Deterministic scatter across ±800 years.
      const year = ((i * 379) % 1600) - 800;
      const month = months[(i * 7) % 12];
      const day = 1 + ((i * 13) % 28);
      const date = { year, month, day };
      const { tickStart, tickEnd } = dateToTicks(greg, date);
      expect(tickEnd).toBe(tickStart! + 1);
      expect(tickToDate(greg, tickStart!)).toEqual(date);
    }
  });

  it('tick → date → tick over a contiguous window straddling the epoch', () => {
    for (let tick = -400; tick <= 400; tick += 7) {
      const date = tickToDate(reck, tick);
      const { tickStart, tickEnd } = dateToTicks(reck, date);
      expect(tickStart! <= tick && tick < tickEnd!).toBe(true);
      expect(tickEnd).toBe(tickStart! + 1);
    }
  });
});

describe('dynamic domains and steps', () => {
  it('a count rule adds an intercalary month every third year', () => {
    const metonic = compileCalendar({
      version: 1,
      params: [
        { name: 'year', type: 'number', range: { from: null, to: null } },
        {
          name: 'month',
          type: 'named',
          values: ['Alpha', 'Beta', 'Leap'],
          count: { dsl: 'return if year % 3 = 0 then 3 else 2' },
        },
        { name: 'day', type: 'number', range: { from: 1, to: 10 }, unitTicks: 1 },
      ],
      epoch: { year: 1, month: 'Alpha', day: 1 },
    });
    // Years 1, 2 → 20 ticks; year 3 → 30 ticks.
    expect(dateToTicks(metonic, { year: 1 })).toEqual({ tickStart: 0, tickEnd: 20 });
    expect(dateToTicks(metonic, { year: 3 })).toEqual({ tickStart: 40, tickEnd: 70 });
    expect(dateToTicks(metonic, { year: 3, month: 'Leap' })).toEqual({
      tickStart: 60,
      tickEnd: 70,
    });
    expect(() => dateToTicks(metonic, { year: 2, month: 'Leap' })).toThrow(CalendarError);
    expect(tickToDate(metonic, 69)).toEqual({ year: 3, month: 'Leap', day: 10 });
    expect(tickToDate(metonic, 70)).toEqual({ year: 4, month: 'Alpha', day: 1 });
  });

  it('an alternating step relabels units without moving them', () => {
    const boustro = compileCalendar({
      version: 1,
      params: [
        { name: 'year', type: 'number', range: { from: null, to: null } },
        {
          name: 'day',
          type: 'number',
          range: {
            from: { dsl: 'return if year % 2 = 0 then 1 else 5' },
            to: { dsl: 'return if year % 2 = 0 then 5 else 1' },
          },
          step: { dsl: 'return if year % 2 = 0 then 1 else -1' },
          unitTicks: 1,
        },
      ],
      epoch: { year: 2, day: 1 },
    });
    // Even years label days 1..5 in tick order; odd years label 5..1.
    expect(dateToTicks(boustro, { year: 2, day: 2 })).toEqual({ tickStart: 1, tickEnd: 2 });
    expect(dateToTicks(boustro, { year: 3, day: 5 })).toEqual({ tickStart: 5, tickEnd: 6 });
    expect(dateToTicks(boustro, { year: 3, day: 1 })).toEqual({ tickStart: 9, tickEnd: 10 });
    expect(tickToDate(boustro, 5)).toEqual({ year: 3, day: 5 });
    expect(tickToDate(boustro, 9)).toEqual({ year: 3, day: 1 });
  });
});

describe('runtime width errors', () => {
  it('a zero or negative unitTicks is rejected at conversion time', () => {
    const hostile = compileCalendar(
      variant(LONG_RECKONING, (d) => {
        d.params[3].unitTicks = { dsl: 'return case era when BC then 1 when AD then 0' };
      })
    );
    expect(() => dateToTicks(hostile, { era: 'AD', year: 1, month: 'Frostwane', day: 1 })).toThrow(
      /positive/
    );
  });

  it('overflowing tick arithmetic is a CalendarError, not silent drift', () => {
    const wide = compileCalendar({
      version: 1,
      params: [
        { name: 'aeon', type: 'number', range: { from: null, to: null } },
        { name: 'beat', type: 'number', range: { from: 1, to: 1_000_000 }, unitTicks: 4_000_000_000 },
      ],
      epoch: { aeon: 1, beat: 1 },
    });
    expect(() => dateToTicks(wide, { aeon: 5000 })).toThrow(/range|2\^53/);
  });
});
