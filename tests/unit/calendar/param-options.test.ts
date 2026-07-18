import { describe, it, expect } from 'vitest';
import { compileCalendar, paramOptions, CalendarError } from '../../../src/lib/calendar/index.js';
import { GREGORIAN } from './fixtures.js';

const greg = compileCalendar(GREGORIAN);

describe('paramOptions — cascading domains', () => {
  it('empty prefix yields the top-level param', () => {
    const opt = paramOptions(greg, {});
    expect(opt.param).toBe('year');
    expect(opt.kind).toBe('number');
  });

  it('after year, offers the month names', () => {
    const opt = paramOptions(greg, { year: 1 });
    expect(opt).toMatchObject({ param: 'month', kind: 'named' });
    if (opt.kind === 'named') {
      expect(opt.values).toContain('January');
      expect(opt.values).toHaveLength(12);
    }
  });

  it('resolves day count dynamically (leap February = 29)', () => {
    const common = paramOptions(greg, { year: 1, month: 'February' });
    expect(common).toMatchObject({ param: 'day', kind: 'number', from: 1, to: 28 });
    const leap = paramOptions(greg, { year: 4, month: 'February' });
    expect(leap).toMatchObject({ param: 'day', kind: 'number', from: 1, to: 29 });
  });

  it('a full tuple has no next param', () => {
    expect(paramOptions(greg, { year: 1, month: 'January', day: 1 })).toEqual({ param: null });
  });

  it('rejects a value outside its domain', () => {
    expect(() => paramOptions(greg, { year: 1, month: 'Smarch' })).toThrow(CalendarError);
  });
});
