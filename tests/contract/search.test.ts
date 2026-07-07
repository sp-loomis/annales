import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  uploadTo,
  createWorld,
  createEntry,
  createCrs,
  createCalendar,
  readyArtifact,
} from '../helpers.js';
import { rectFeature, triangleFeature, excalidrawScene } from '../fixtures.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

// One world with enough variety to exercise every filter:
//   coast    — region, tag 'coastal', body document mentioning "shattered",
//              rect geometry [0..10], date range ticks 60..61
//   falls    — place, sketch with text "waterfall cavern", date range 6000..12000
//   farAway  — place, rect geometry [100..110]
async function seed() {
  const w = await createWorld(app);
  const crs = await createCrs(app, w.id);
  const calendar = await createCalendar(app, w.id); // 60-day years, see helpers

  const coast = await createEntry(app, w.id, {
    type: 'region',
    title: 'The Shattered Coast',
    tags: ['coastal'],
  });
  await readyArtifact(
    app,
    coast.id,
    'documents',
    { role: 'body' },
    'The shattered coast lies west of the old kingdom.',
    'text/markdown'
  );
  await readyArtifact(
    app,
    coast.id,
    'geometries',
    { crsId: crs.id, label: 'territory' },
    JSON.stringify(rectFeature(0, 0, 10, 10)),
    'application/geo+json'
  );
  await api(app, 'POST', `/entries/${coast.id}/date-ranges`, {
    calendarId: calendar.id,
    rawComponents: { year: 2, month: 1, day: 1 }, // ticks 60..61
    precisionTier: 'exact',
  });

  const falls = await createEntry(app, w.id, { type: 'place', title: 'The Falls' });
  await readyArtifact(
    app,
    falls.id,
    'sketches',
    { label: 'cave sketch' },
    JSON.stringify(excalidrawScene(['waterfall cavern'])),
    'application/json'
  );
  await api(app, 'POST', `/entries/${falls.id}/date-ranges`, {
    calendarId: calendar.id,
    rawComponents: { year: 101 }, // ticks 6000..6060
    precisionTier: 'circa',
  });

  const farAway = await createEntry(app, w.id, { type: 'place', title: 'Far Away' });
  await readyArtifact(
    app,
    farAway.id,
    'geometries',
    { crsId: crs.id },
    JSON.stringify(rectFeature(100, 100, 110, 110)),
    'application/geo+json'
  );

  return { worldId: w.id, crsId: crs.id, calendarId: calendar.id, coast, falls, farAway };
}

describe('GET /worlds/:worldId/search — guards', () => {
  it('400s with no filters at all', async () => {
    const { worldId } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('400s on bbox without crsId', async () => {
    const { worldId } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search?bbox=0,0,5,5`);
    expect(res.status).toBe(400);
  });
});

describe('full-text (q)', () => {
  it('finds document text with ranked, snippeted matches', async () => {
    const { worldId, coast } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search?q=shattered`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const hit = res.body.items[0];
    expect(hit.entryId).toBe(coast.id);
    expect(hit.title).toBe('The Shattered Coast');
    expect(typeof hit.rank).toBe('number');
    expect(hit.matches[0].sourceType).toBe('document');
    expect(hit.matches[0].snippet).toContain('<b>');
  });

  it('finds text inside Excalidraw scenes', async () => {
    const { worldId, falls } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search?q=waterfall`);
    expect(res.body.items.map((i: any) => i.entryId)).toEqual([falls.id]);
    expect(res.body.items[0].matches[0].sourceType).toBe('sketch');
  });

  it('finds geometry labels', async () => {
    const { worldId, coast } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search?q=territory`);
    expect(res.body.items.map((i: any) => i.entryId)).toEqual([coast.id]);
    expect(res.body.items[0].matches[0].sourceType).toBe('geometry');
  });

  it('does not surface un-finalized uploads', async () => {
    const { worldId, coast } = await seed();
    // uploaded but never finalized → invisible to search
    const created = await api(app, 'POST', `/entries/${coast.id}/documents`, { role: 'note' });
    await uploadTo(created.body.upload.url, 'zanzibar secrets', 'text/markdown');

    const res = await api(app, 'GET', `/worlds/${worldId}/search?q=zanzibar`);
    expect(res.body.items).toEqual([]);
  });
});

describe('metadata filters', () => {
  it('filters by type and tag, composing with q', async () => {
    const { worldId, coast } = await seed();

    const byType = await api(app, 'GET', `/worlds/${worldId}/search?type=region`);
    expect(byType.body.items.map((i: any) => i.entryId)).toEqual([coast.id]);

    const byTag = await api(app, 'GET', `/worlds/${worldId}/search?tag=coastal`);
    expect(byTag.body.items.map((i: any) => i.entryId)).toEqual([coast.id]);

    const composed = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?q=shattered&tag=coastal&type=region`
    );
    expect(composed.body.items).toHaveLength(1);

    const excluded = await api(app, 'GET', `/worlds/${worldId}/search?q=shattered&type=place`);
    expect(excluded.body.items).toEqual([]);
  });
});

describe('geo filter (bbox)', () => {
  it('stage 1: returns entries whose geometry bbox overlaps', async () => {
    const { worldId, crsId, coast, farAway } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search?bbox=5,5,15,15&crsId=${crsId}`);
    const ids = res.body.items.map((i: any) => i.entryId);
    expect(ids).toContain(coast.id);
    expect(ids).not.toContain(farAway.id);
  });

  it('stage 2 (exact=true): drops bbox hits the real shape does not touch', async () => {
    const { worldId, crsId } = await seed();
    // Triangle with legs on the axes — bbox [0,0,20,20], but the bbox's
    // upper-right corner is empty space.
    const entry = await createEntry(app, worldId, { title: 'Triangle Land' });
    await readyArtifact(
      app,
      entry.id,
      'geometries',
      { crsId },
      JSON.stringify(triangleFeature(20)),
      'application/geo+json'
    );

    // Query box sits in that empty corner.
    const loose = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?bbox=15,15,19,19&crsId=${crsId}`
    );
    expect(loose.body.items.map((i: any) => i.entryId)).toContain(entry.id);

    const exact = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?bbox=15,15,19,19&crsId=${crsId}&exact=true`
    );
    expect(exact.body.items.map((i: any) => i.entryId)).not.toContain(entry.id);
  });
});

describe('date filter (tick overlap)', () => {
  it('returns entries whose ranges overlap the query window', async () => {
    const { worldId, coast, falls } = await seed();

    const early = await api(app, 'GET', `/worlds/${worldId}/search?tickStart=50&tickEnd=70`);
    expect(early.body.items.map((i: any) => i.entryId)).toEqual([coast.id]);

    const late = await api(app, 'GET', `/worlds/${worldId}/search?tickStart=5000&tickEnd=7000`);
    expect(late.body.items.map((i: any) => i.entryId)).toEqual([falls.id]);
  });
});
