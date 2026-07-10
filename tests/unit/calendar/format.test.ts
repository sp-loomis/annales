import { describe, it, expect } from 'vitest';
import {
  compileCalendar,
  computeDerived,
  dateToTicks,
  formatDate,
  CalendarError,
} from '../../../src/lib/calendar/index.js';
import { GREGORIAN, LONG_RECKONING, variant } from './fixtures.js';

const greg = compileCalendar(GREGORIAN);
const reck = compileCalendar(LONG_RECKONING);

describe('default formatting', () => {
  it('pretty: space-separated, display names for Named', () => {
    expect(formatDate(reck, { era: 'BC', year: 100 }, 'pretty')).toBe('BC 100');
    expect(formatDate(reck, { era: 'AD', year: 2, month: 'Sunreach', day: 30 }, 'pretty')).toBe(
      'AD 2 Sunreach 30'
    );
  });

  it('pretty uses declared display names when present', () => {
    const cal = compileCalendar(
      variant(LONG_RECKONING, (d) => {
        d.params[2].values[0] = { value: 'Frostwane', display: "The Frost's Wane" };
      })
    );
    expect(formatDate(cal, { era: 'AD', year: 1, month: 'Frostwane' }, 'pretty')).toBe(
      "AD 1 The Frost's Wane"
    );
  });

  it('short: slash-separated, 1-based ordinals for Named', () => {
    expect(formatDate(reck, { era: 'AD', year: 2, month: 'Sunreach', day: 30 }, 'short')).toBe(
      '2/2/2/30'
    );
    expect(formatDate(reck, { era: 'BC', year: 100 }, 'short')).toBe('1/100');
  });

  it('formats prefixes at their own level', () => {
    expect(formatDate(greg, { year: 2024 }, 'pretty')).toBe('2024');
    expect(formatDate(greg, { year: 2024, month: 'March' }, 'pretty')).toBe('2024 March');
  });
});

describe('format rule overrides', () => {
  it('applies the BC/AD label transform with the off-by-one', () => {
    expect(formatDate(greg, { year: 2024, month: 'March', day: 15 }, 'pretty')).toBe(
      'March 15, 2024 AD'
    );
    // 1 BC is year 0; 44 BC is year -43.
    expect(formatDate(greg, { year: -43, month: 'March', day: 15 }, 'pretty')).toBe(
      'March 15, 44 BC'
    );
    expect(formatDate(greg, { year: 0, month: 'January', day: 1 }, 'pretty')).toBe(
      'January 1, 1 BC'
    );
  });

  it('short override with ordinal() and zero-padding', () => {
    expect(formatDate(greg, { year: -43, month: 'March', day: 15 }, 'short')).toBe('-43/03/15');
    expect(formatDate(greg, { year: 2024, month: 'December', day: 5 }, 'short')).toBe(
      '2024/12/05'
    );
  });

  it('an override at one level leaves other levels on defaults', () => {
    // GREGORIAN overrides only the day level.
    expect(formatDate(greg, { year: -43, month: 'March' }, 'pretty')).toBe('-43 March');
  });
});

describe('derived fields', () => {
  it('computes tick-derived weekdays, Euclidean for negative ticks', () => {
    expect(computeDerived(greg, { year: 1, month: 'January', day: 1 }, 0)).toEqual({
      weekday: 'Saturday',
    });
    expect(computeDerived(greg, { year: 1, month: 'January', day: 3 }, 2)).toEqual({
      weekday: 'Monday',
    });
    // tick -1 → -1 % 7 = 6 → Friday.
    expect(computeDerived(greg, { year: 0, month: 'December', day: 31 }, -1)).toEqual({
      weekday: 'Friday',
    });
  });

  it('rejects derived computation on a prefix', () => {
    expect(() => computeDerived(greg, { year: 1 }, 0)).toThrow(/full/);
  });

  it('a Named derived index outside the declared values is a runtime error', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => {
        d.derivedFields.push({
          name: 'bad',
          type: 'named',
          values: ['A', 'B'],
          expr: { dsl: 'return 99' },
        });
      })
    );
    expect(() => computeDerived(cal, { year: 1, month: 'January', day: 1 }, 0)).toThrow(
      /bad|index/
    );
  });

  it('terminal-level format rules can use tick-derived fields', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => {
        d.format.pretty.day = { dsl: 'return "{weekday}, {month} {day}"' };
      })
    );
    const date = { year: 1, month: 'January', day: 3 };
    const { tickStart } = dateToTicks(cal, date);
    expect(formatDate(cal, date, 'pretty', tickStart)).toBe('Monday, January 3');
    expect(() => formatDate(cal, date, 'pretty')).toThrow(CalendarError);
  });

  it('non-tick derived fields work at any bound level', () => {
    const cal = compileCalendar(
      variant(GREGORIAN, (d) => {
        d.derivedFields.push({
          name: 'century',
          type: 'number',
          expr: { dsl: 'return ceil(year / 100)' },
        });
        d.format.pretty.year = { dsl: 'return "C{century}"' };
      })
    );
    expect(formatDate(cal, { year: 250 }, 'pretty')).toBe('C3');
  });
});
