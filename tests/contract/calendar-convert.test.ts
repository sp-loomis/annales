import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, api, createWorld, createTimeline, createCalendar } from '../helpers.js';
import { GREGORIAN, LONG_RECKONING } from '../unit/calendar/fixtures.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

async function setup(definition: unknown = GREGORIAN) {
  const w = await createWorld(app);
  const tl = await createTimeline(app, w.id);
  const cal = await createCalendar(app, tl.id, { name: 'convertible', definition });
  return cal.id;
}

describe('POST /calendars/:id/convert — tick → date', () => {
  it('returns the full tuple with ticks, formats, and derived fields', async () => {
    const calId = await setup();
    const res = await api(app, 'POST', `/calendars/${calId}/convert`, { tick: 31 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: { year: 1, month: 'February', day: 1 },
      tickStart: 31,
      tickEnd: 32,
      pretty: 'February 1, 1 AD',
      short: '1/02/01',
      derived: { weekday: 'Tuesday' }, // 31 % 7 = 3, 0 = Saturday
    });
  });

  it('handles negative ticks', async () => {
    const calId = await setup();
    const res = await api(app, 'POST', `/calendars/${calId}/convert`, { tick: -1 });
    expect(res.status).toBe(200);
    expect(res.body.date).toEqual({ year: 0, month: 'December', day: 31 });
    expect(res.body.pretty).toBe('December 31, 1 BC');
    expect(res.body.derived).toEqual({ weekday: 'Friday' });
  });

  it('400s on a tick outside a bounded calendar', async () => {
    const calId = await setup();
    // GREGORIAN years are bounded at ±9999.
    const res = await api(app, 'POST', `/calendars/${calId}/convert`, { tick: 10_000_000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/outside/);
  });

  it('400s on a non-integer tick', async () => {
    const calId = await setup();
    const res = await api(app, 'POST', `/calendars/${calId}/convert`, { tick: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('POST /calendars/:id/convert — date → tick', () => {
  it('echoes a full tuple with its ticks and formats', async () => {
    const calId = await setup();
    const res = await api(app, 'POST', `/calendars/${calId}/convert`, {
      date: { year: -43, month: 'March', day: 15 },
    });
    expect(res.status).toBe(200);
    expect(res.body.date).toEqual({ year: -43, month: 'March', day: 15 });
    expect(res.body.tickEnd).toBe(res.body.tickStart + 1);
    expect(res.body.pretty).toBe('March 15, 44 BC');
    expect(res.body.short).toBe('-43/03/15');
    expect(res.body.derived).toHaveProperty('weekday');
  });

  it('a prefix gets its whole-unit interval and no derived fields', async () => {
    const calId = await setup();
    const res = await api(app, 'POST', `/calendars/${calId}/convert`, {
      date: { year: 2 },
    });
    expect(res.status).toBe(200);
    expect(res.body.tickStart).toBe(365);
    expect(res.body.tickEnd).toBe(730);
    expect(res.body.pretty).toBe('2');
    expect(res.body.derived).toBeUndefined();
  });

  it('open era prefixes carry a null side', async () => {
    const calId = await setup(LONG_RECKONING);
    const res = await api(app, 'POST', `/calendars/${calId}/convert`, {
      date: { era: 'BC' },
    });
    expect(res.status).toBe(200);
    expect(res.body.tickStart).toBeNull();
    expect(res.body.tickEnd).toBe(0);
    expect(res.body.pretty).toBe('BC');
  });

  it('400s on an invalid date', async () => {
    const calId = await setup();
    for (const date of [
      { year: 3, month: 'February', day: 29 }, // not a leap year
      { year: 1, day: 5 }, // gap in the prefix
      {},
    ]) {
      const res = await api(app, 'POST', `/calendars/${calId}/convert`, { date });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });
});

describe('POST /calendars/:id/convert — request shape', () => {
  it('400s when both or neither of tick/date are given', async () => {
    const calId = await setup();
    for (const body of [{}, { tick: 1, date: { year: 1 } }]) {
      const res = await api(app, 'POST', `/calendars/${calId}/convert`, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });

  it('404s on an unknown calendar', async () => {
    const res = await api(
      app,
      'POST',
      '/calendars/00000000-0000-0000-0000-000000000000/convert',
      { tick: 0 }
    );
    expect(res.status).toBe(404);
  });
});
