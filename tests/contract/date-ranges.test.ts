import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  createWorld,
  createEntry,
  createTimeline,
  createCalendar,
} from '../helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

// Arithmetic test calendar: two 30-day months → 60-day year, year 1 day 1 = tick 0.
async function setup() {
  const w = await createWorld(app);
  const entry = await createEntry(app, w.id);
  const timeline = await createTimeline(app, w.id);
  const calendar = await createCalendar(app, timeline.id);
  return { worldId: w.id, entryId: entry.id, calendarId: calendar.id };
}

describe('POST /entries/:entryId/date-ranges — arithmetic calendars', () => {
  it('converts an exact day to a one-day tick range', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 2, month: 1, day: 1 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(201);
    expect(res.body.tickStart).toBe(60);
    expect(res.body.tickEnd).toBe(61);
    expect(res.body.rawComponents).toEqual({ year: 2, month: 1, day: 1 });
    expect(res.body.precisionTier).toBe('exact');
  });

  it('widens omitted units — a bare year covers the whole year', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 2 },
      precisionTier: 'circa',
    });
    expect(res.status).toBe(201);
    expect(res.body.tickStart).toBe(60);
    expect(res.body.tickEnd).toBe(120);
  });

  it('rejects components that do not fit the calendar', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 1, month: 3, day: 1 }, // calendar has 2 months
      precisionTier: 'exact',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('404s on an unknown calendar', async () => {
    const { entryId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId: '00000000-0000-0000-0000-000000000000',
      rawComponents: { year: 1 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(404);
  });

  it('rejects a calendar from a different world with CROSS_WORLD', async () => {
    const { entryId } = await setup();
    const otherWorld = await createWorld(app, 'Elsewhere');
    const otherTimeline = await createTimeline(app, otherWorld.id);
    const foreignCalendar = await createCalendar(app, otherTimeline.id);
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId: foreignCalendar.id,
      rawComponents: { year: 1 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CROSS_WORLD');
  });
});

describe('POST /entries/:entryId/date-ranges — ordinal calendars', () => {
  async function ordinalSetup() {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const timeline = await createTimeline(app, w.id);
    const calendar = await createCalendar(app, timeline.id, {
      name: 'the ages',
      type: 'ordinal',
      definition: {
        stages: [
          { name: 'First Age', tickStart: 0, tickEnd: 10000 },
          { name: 'Age of Mist' }, // unanchored
        ],
      },
    });
    return { entryId: entry.id, calendarId: calendar.id };
  }

  it('anchored stage copies its ticks', async () => {
    const { entryId, calendarId } = await ordinalSetup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { stage: 'First Age' },
      precisionTier: 'ordinal',
    });
    expect(res.status).toBe(201);
    expect(res.body.tickStart).toBe(0);
    expect(res.body.tickEnd).toBe(10000);
  });

  it('unanchored stage gets null ticks', async () => {
    const { entryId, calendarId } = await ordinalSetup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { stage: 'Age of Mist' },
      precisionTier: 'ordinal',
    });
    expect(res.status).toBe(201);
    expect(res.body.tickStart).toBeNull();
    expect(res.body.tickEnd).toBeNull();
  });

  it('rejects an unknown stage', async () => {
    const { entryId, calendarId } = await ordinalSetup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { stage: 'Age of Nonsense' },
      precisionTier: 'ordinal',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('PATCH / DELETE /date-ranges/:id', () => {
  it('recomputes ticks when rawComponents change', async () => {
    const { entryId, calendarId } = await setup();
    const created = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 1 },
      precisionTier: 'exact',
    });
    const res = await api(app, 'PATCH', `/date-ranges/${created.body.id}`, {
      rawComponents: { year: 3 },
    });
    expect(res.status).toBe(200);
    expect(res.body.tickStart).toBe(120);
    expect(res.body.tickEnd).toBe(180);
  });

  it('deletes a range', async () => {
    const { entryId, calendarId } = await setup();
    const created = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 1 },
      precisionTier: 'exact',
    });
    expect((await api(app, 'DELETE', `/date-ranges/${created.body.id}`)).status).toBe(204);

    const detail = await api(app, 'GET', `/entries/${entryId}`);
    expect(detail.body.dateRanges).toEqual([]);
  });
});
