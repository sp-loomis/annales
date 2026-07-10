import { describe, it, expect } from 'vitest';
import { compileCalendar, CalendarError } from '../../../src/lib/calendar/index.js';
import { GREGORIAN, LONG_RECKONING, variant } from './fixtures.js';

describe('compileCalendar — structure', () => {
  it('accepts the reference fixtures', () => {
    expect(() => compileCalendar(GREGORIAN)).not.toThrow();
    expect(() => compileCalendar(LONG_RECKONING)).not.toThrow();
  });

  it('rejects non-objects and missing fields', () => {
    expect(() => compileCalendar(null)).toThrow(CalendarError);
    expect(() => compileCalendar('x')).toThrow(CalendarError);
    expect(() => compileCalendar({})).toThrow(CalendarError);
  });

  it('requires version 1', () => {
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.version = 2)))).toThrow(/version/);
    expect(() => compileCalendar(variant(GREGORIAN, (d) => delete d.version))).toThrow(/version/);
  });

  it('requires a non-empty params list', () => {
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.params = [])))).toThrow(CalendarError);
  });

  it('rejects duplicate param names', () => {
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[2].name = 'year')))
    ).toThrow(/year/);
  });

  it('param names must be identifier-shaped and not reserved', () => {
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[2].name = 'the day')))
    ).toThrow(CalendarError);
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[2].name = 'return')))
    ).toThrow(CalendarError);
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[2].name = 'tick')))
    ).toThrow(CalendarError);
  });

  it('named values must be identifier-shaped unless the {value, display} form is used', () => {
    expect(() =>
      compileCalendar(variant(LONG_RECKONING, (d) => (d.params[2].values[0] = 'First Month')))
    ).toThrow(CalendarError);
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[2].values[0] = { value: 'Frostwane', display: "The Frost's Wane" };
        })
      )
    ).not.toThrow();
  });

  it('rejects duplicate named values', () => {
    expect(() =>
      compileCalendar(variant(LONG_RECKONING, (d) => (d.params[2].values = ['A', 'A'])))
    ).toThrow(CalendarError);
  });

  it('unitTicks is required on the terminal param and only there', () => {
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => delete d.params[2].unitTicks))
    ).toThrow(/unitTicks/);
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[0].unitTicks = 1)))
    ).toThrow(/unitTicks/);
  });

  it('unitTicks constant must be a positive integer', () => {
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[2].unitTicks = 0)))
    ).toThrow(CalendarError);
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[2].unitTicks = 1.5)))
    ).toThrow(CalendarError);
  });
});

describe('compileCalendar — top-level param is the recursion base case', () => {
  it('rejects any DSL attachment on the top param', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.params[0].range.from = { dsl: 'return 1' }))
      )
    ).toThrow(/top/i);
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[0].step = { dsl: 'return 1' })))
    ).toThrow(/top/i);
  });
});

describe('compileCalendar — scope gating', () => {
  it('a rule may not reference its own param', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.params[2].range.to = { dsl: 'return day + 1' }))
      )
    ).toThrow(/day/);
  });

  it('a rule may not reference a descendant param', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[1].count = { dsl: 'return day' };
        })
      )
    ).toThrow(/day/);
  });

  it('rules reference ancestors freely', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[2].unitTicks = { dsl: 'return if year % 2 = 0 then 2 else 1' };
        })
      )
    ).not.toThrow();
  });
});

describe('compileCalendar — step', () => {
  it('constant step must be exactly 1 or -1', () => {
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.params[0].step = 2)))).toThrow(
      CalendarError
    );
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.params[0].step = 0)))).toThrow(
      CalendarError
    );
  });

  it('step defaults to 1 when omitted', () => {
    const cal = compileCalendar(GREGORIAN);
    expect(cal.params[1].step).toEqual({ kind: 'const', value: 1 });
  });

  it('a DSL step must have every branch a literal 1 or -1', () => {
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[1].step = { dsl: 'return case era when BC then -1 when AD then 1' };
        })
      )
    ).not.toThrow();
    // Evaluates to ±1 but is not literally ±1 — rejected statically.
    expect(() =>
      compileCalendar(
        variant(LONG_RECKONING, (d) => {
          d.params[1].step = { dsl: 'return ordinal(era) * 2 - 3' };
        })
      )
    ).toThrow(/step/);
  });

  it('a dynamic step keyed on a Number ancestor is legal', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[2].step = { dsl: 'return if year % 2 = 0 then 1 else -1' };
          d.params[2].range = {
            from: { dsl: 'return if year % 2 = 0 then 1 else 30' },
            to: { dsl: 'return if year % 2 = 0 then 30 else 1' },
          };
        })
      )
    ).not.toThrow();
  });
});

describe('compileCalendar — constant range consistency', () => {
  it('rejects a range whose direction contradicts step', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.params[2].range = { ...d.params[2].range, from: 30, to: 1 }))
      )
    ).toThrow(CalendarError);
  });

  it('accepts single-value and descending ranges', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[0].range = { from: 5, to: 5 };
          d.epoch.year = 5;
        })
      )
    ).not.toThrow();
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[0].range = { from: 100, to: 1 };
          d.params[0].step = -1;
          d.epoch.year = 50;
        })
      )
    ).not.toThrow();
  });

  it('bounds must be integers', () => {
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[2].range.from = 1.5)))
    ).toThrow(CalendarError);
  });
});

describe('compileCalendar — count (dynamic Named domains)', () => {
  it('accepts a count rule on a Named param', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[1].count = { dsl: 'return if year % 3 = 0 then 12 else 11' };
        })
      )
    ).not.toThrow();
  });

  it('constant count must be within 1..values.length', () => {
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[1].count = 0)))
    ).toThrow(CalendarError);
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => (d.params[1].count = 13)))
    ).toThrow(CalendarError);
  });
});

describe('compileCalendar — epoch', () => {
  it('epoch must bind every param', () => {
    expect(() => compileCalendar(variant(GREGORIAN, (d) => delete d.epoch.day))).toThrow(/epoch/);
  });

  it('epoch must not bind unknown params', () => {
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.epoch.hour = 1)))).toThrow(/epoch/);
  });

  it('epoch values must lie in their resolved domains', () => {
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.epoch.day = 32)))).toThrow(/epoch/);
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.epoch.month = 'Smarch')))).toThrow(
      /epoch/
    );
    expect(() => compileCalendar(variant(GREGORIAN, (d) => (d.epoch.day = 'first')))).toThrow(
      /epoch/
    );
    // February 30 does not exist: the day range rule must gate the epoch too.
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.epoch.month = 'February';
          d.epoch.day = 30;
        })
      )
    ).toThrow(/epoch/);
  });

  it('an epoch inside an open-ended era is legal', () => {
    // LONG_RECKONING's epoch sits in AD, whose `to` is open.
    expect(() => compileCalendar(LONG_RECKONING)).not.toThrow();
    expect(() =>
      compileCalendar(variant(LONG_RECKONING, (d) => (d.epoch = { era: 'BC', year: 100, month: 'Sunreach', day: 5 })))
    ).not.toThrow();
  });
});

describe('compileCalendar — derived fields', () => {
  it('derived names must not collide with params', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.derivedFields[0].name = 'month'))
      )
    ).toThrow(CalendarError);
  });

  it('derived exprs may reference tick and all params', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.derivedFields.push({
            name: 'dayOfCycle',
            type: 'number',
            expr: { dsl: 'return tick % 60 + day' },
          });
        })
      )
    ).not.toThrow();
  });

  it('a Named derived field must declare values', () => {
    expect(() =>
      compileCalendar(variant(GREGORIAN, (d) => delete d.derivedFields[0].values))
    ).toThrow(CalendarError);
  });

  it('records whether a derived field uses tick', () => {
    const cal = compileCalendar(GREGORIAN);
    expect(cal.derived[0].usesTick).toBe(true);
  });
});

describe('compileCalendar — format rules', () => {
  it('format keys must name params', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.format.pretty.hour = { dsl: 'return "x"' }))
      )
    ).toThrow(/hour/);
  });

  it('a format rule may not reference a descendant param', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.format.pretty.month = { dsl: 'return "{day}"' }))
      )
    ).toThrow(CalendarError);
  });

  it('a non-terminal format rule may not use a tick-derived field', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.format.pretty.month = { dsl: 'return "{weekday}"' }))
      )
    ).toThrow(/tick|weekday/);
  });

  it('a terminal-level format rule may use a tick-derived field', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.format.pretty.day = { dsl: 'return "{weekday} {day}"' }))
      )
    ).not.toThrow();
  });

  it('format rules must return String', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => (d.format.short.year = { dsl: 'return year' }))
      )
    ).toThrow(CalendarError);
  });
});

describe('compileCalendar — DSL errors carry context', () => {
  it('names the attachment point in the message', () => {
    try {
      compileCalendar(
        variant(GREGORIAN, (d) => (d.params[2].range.to = { dsl: 'return month + 1' }))
      );
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CalendarError);
      expect((err as Error).message).toMatch(/day/);
    }
  });

  it('surfaces case non-exhaustiveness', () => {
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[2].range.to = { dsl: 'return case month when February then 28 else 31' };
          d.params[1].values = ['January', 'February'];
          d.epoch.month = 'January';
        })
      )
    ).not.toThrow();
    expect(() =>
      compileCalendar(
        variant(GREGORIAN, (d) => {
          d.params[2].range.to = { dsl: 'return case month when February then 28' };
        })
      )
    ).toThrow(CalendarError);
  });
});
