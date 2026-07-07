import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  uploadTo,
  createWorld,
  createEntry,
  createGlobe,
  createTimeline,
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

// Equirectangular globe (radius 180/π): x = lng, y = -lat. Authored rects
// below list their canonical bboxes in comments.
//   coast    — region, tag 'coastal', body doc "shattered", rect [0..10]
//              (canonical [0,-10,10,0]), date range ticks 60..61
//   falls    — place, sketch "waterfall cavern", date range 6000..6060
//   farAway  — place, rect [50..60] (canonical [50,-60,60,-50])
async function seed() {
  const w = await createWorld(app);
  const globe = await createGlobe(app, w.id);
  const crs = await createCrs(app, globe.id);
  const timeline = await createTimeline(app, w.id);
  const calendar = await createCalendar(app, timeline.id); // 60-day years, see helpers

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
    JSON.stringify(rectFeature(50, 50, 60, 60)),
    'application/geo+json'
  );

  return {
    worldId: w.id,
    globeId: globe.id,
    crsId: crs.id,
    timelineId: timeline.id,
    calendarId: calendar.id,
    coast,
    falls,
    farAway,
  };
}

describe('GET /worlds/:worldId/search — guards', () => {
  it('400s with no filters at all', async () => {
    const { worldId } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('400s on bbox without globeId', async () => {
    const { worldId } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search?bbox=0,-5,5,0`);
    expect(res.status).toBe(400);
  });

  it('400s on a tick window without timelineId', async () => {
    const { worldId } = await seed();
    const res = await api(app, 'GET', `/worlds/${worldId}/search?tickStart=50&tickEnd=70`);
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

describe('geo filter (bbox, canonical lng/lat, scoped by globe)', () => {
  it('stage 1: returns entries whose canonical bbox overlaps', async () => {
    const { worldId, globeId, coast, farAway } = await seed();
    const res = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?bbox=5,-9,15,-1&globeId=${globeId}`
    );
    const ids = res.body.items.map((i: any) => i.entryId);
    expect(ids).toContain(coast.id);
    expect(ids).not.toContain(farAway.id);
  });

  it('stage 2 (exact=true): drops bbox hits the real shape does not touch', async () => {
    const { worldId, globeId, crsId } = await seed();
    // triangleFeature(20) canonicalizes to vertices [0,0],[20,0],[0,-20];
    // its bbox is [0,-20,20,0] but the box's lower-right corner is empty.
    const entry = await createEntry(app, worldId, { title: 'Triangle Land' });
    await readyArtifact(
      app,
      entry.id,
      'geometries',
      { crsId },
      JSON.stringify(triangleFeature(20)),
      'application/geo+json'
    );

    // Query box sits in that empty corner (canonical).
    const loose = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?bbox=15,-19,19,-15&globeId=${globeId}`
    );
    expect(loose.body.items.map((i: any) => i.entryId)).toContain(entry.id);

    const exact = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?bbox=15,-19,19,-15&globeId=${globeId}&exact=true`
    );
    expect(exact.body.items.map((i: any) => i.entryId)).not.toContain(entry.id);
  });

  it('scopes by globe, not CRS: one box query spans every CRS under the globe', async () => {
    const w = await createWorld(app);
    const globe = await createGlobe(app, w.id);
    const crsA = await createCrs(app, globe.id, 'a');
    const crsB = await createCrs(app, globe.id, 'b');

    const eA = await createEntry(app, w.id, { title: 'A' });
    await readyArtifact(app, eA.id, 'geometries', { crsId: crsA.id }, JSON.stringify(rectFeature(0, 0, 10, 10)), 'application/geo+json');
    const eB = await createEntry(app, w.id, { title: 'B' });
    await readyArtifact(app, eB.id, 'geometries', { crsId: crsB.id }, JSON.stringify(rectFeature(5, 0, 15, 10)), 'application/geo+json');

    // canonical: A [0,-10,10,0], B [5,-10,15,0]; this box overlaps both.
    const res = await api(app, 'GET', `/worlds/${w.id}/search?bbox=6,-9,9,-1&globeId=${globe.id}`);
    const ids = res.body.items.map((i: any) => i.entryId);
    expect(ids).toContain(eA.id);
    expect(ids).toContain(eB.id);
  });
});

describe('geo exact pass — near-global query is scoped out (conservative keep)', () => {
  // A near-global query cannot be faithfully projected into the query-local
  // azimuthal frame (its far corners fall at/behind the frame singularity). The
  // exact pass must fall back to tier-1 rather than silently DROP real hits.
  it('keeps tier-1 hits when the query spans too much of the globe for turf', async () => {
    const { worldId, globeId, coast, farAway } = await seed();
    const res = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?bbox=-179,-89,179,89&globeId=${globeId}&exact=true`
    );
    const ids = res.body.items.map((i: any) => i.entryId);
    expect(ids).toContain(coast.id);
    expect(ids).toContain(farAway.id);
  });
});

describe('date filter (tick overlap, scoped by timeline)', () => {
  it('returns entries whose ranges overlap the query window', async () => {
    const { worldId, timelineId, coast, falls } = await seed();

    const early = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?tickStart=50&tickEnd=70&timelineId=${timelineId}`
    );
    expect(early.body.items.map((i: any) => i.entryId)).toEqual([coast.id]);

    const late = await api(
      app,
      'GET',
      `/worlds/${worldId}/search?tickStart=5000&tickEnd=7000&timelineId=${timelineId}`
    );
    expect(late.body.items.map((i: any) => i.entryId)).toEqual([falls.id]);
  });
});
