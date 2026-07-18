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
import { LONG_RECKONING } from '../unit/calendar/fixtures.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

// Default test calendar: two 30-day months → 60-tick year, year 1 day 1 = tick 0.
async function setup() {
  const w = await createWorld(app);
  const entry = await createEntry(app, w.id);
  const timeline = await createTimeline(app, w.id);
  const calendar = await createCalendar(app, timeline.id);
  return { worldId: w.id, entryId: entry.id, calendarId: calendar.id };
}

describe('POST /entries/:entryId/date-ranges', () => {
  it('converts an exact day to a one-day tick range', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 2, month: 'Frostwane', day: 1 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(201);
    expect(res.body.tickStart).toBe(60);
    expect(res.body.tickEnd).toBe(61);
    expect(res.body.rawComponents).toEqual({ year: 2, month: 'Frostwane', day: 1 });
    expect(res.body.precisionTier).toBe('exact');
  });

  it('persists label + displayStyle, defaulting displayStyle to pretty', async () => {
    const { entryId, calendarId } = await setup();
    const withLabel = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 1 },
      precisionTier: 'exact',
      label: 'Founding',
      displayStyle: 'short',
    });
    expect(withLabel.status).toBe(201);
    expect(withLabel.body.label).toBe('Founding');
    expect(withLabel.body.displayStyle).toBe('short');

    const bare = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 2 },
      precisionTier: 'exact',
    });
    expect(bare.body.label).toBeNull();
    expect(bare.body.displayStyle).toBe('pretty');

    const patched = await api(app, 'PATCH', `/date-ranges/${bare.body.id}`, {
      label: 'Renamed',
      displayStyle: 'short',
    });
    expect(patched.body.label).toBe('Renamed');
    expect(patched.body.displayStyle).toBe('short');

    const detail = await api(app, 'GET', `/entries/${entryId}`);
    const founding = detail.body.dateRanges.find((r: { label: string | null }) => r.label === 'Founding');
    expect(founding.displayStyle).toBe('short');
  });

  it('a prefix denotes the whole unit — a bare year covers the year', async () => {
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

  it('pre-epoch dates get exact negative ticks', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 0, month: 'Sunreach', day: 30 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(201);
    expect(res.body.tickStart).toBe(-1);
    expect(res.body.tickEnd).toBe(0);
  });

  it('rejects out-of-domain components', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 1, month: 'Smarch', day: 1 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('rejects a non-contiguous prefix', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: 1, day: 5 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/month/);
  });

  it('rejects values of the wrong JSON type', async () => {
    const { entryId, calendarId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { year: '2' },
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

describe('POST /entries/:entryId/date-ranges — open-ended eras', () => {
  async function eraSetup() {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const timeline = await createTimeline(app, w.id);
    const calendar = await createCalendar(app, timeline.id, {
      name: 'the long reckoning',
      definition: LONG_RECKONING,
    });
    return { entryId: entry.id, calendarId: calendar.id };
  }

  it('an open era prefix is null on its unbounded side', async () => {
    const { entryId, calendarId } = await eraSetup();
    const bc = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { era: 'BC' },
      precisionTier: 'ordinal',
    });
    expect(bc.status).toBe(201);
    expect(bc.body.tickStart).toBeNull();
    expect(bc.body.tickEnd).toBe(0);

    const ad = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { era: 'AD' },
      precisionTier: 'ordinal',
    });
    expect(ad.status).toBe(201);
    expect(ad.body.tickStart).toBe(0);
    expect(ad.body.tickEnd).toBeNull();
  });

  it('a bound year inside an open era is finite (BC counts down)', async () => {
    const { entryId, calendarId } = await eraSetup();
    const res = await api(app, 'POST', `/entries/${entryId}/date-ranges`, {
      calendarId,
      rawComponents: { era: 'BC', year: 1 },
      precisionTier: 'exact',
    });
    expect(res.status).toBe(201);
    expect(res.body.tickStart).toBe(-60);
    expect(res.body.tickEnd).toBe(0);
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
