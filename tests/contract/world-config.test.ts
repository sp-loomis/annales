import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  createWorld,
  createEntry,
  createGlobe,
  createTimeline,
  createCrs,
  createCalendar,
  createRelationType,
  readyArtifact,
  DEFAULT_CALENDAR_DEFINITION,
} from '../helpers.js';
import { rectFeature } from '../fixtures.js';

// Globes and timelines are per-world groupings (unique name per world, IN_USE
// guard on delete). CRS definitions nest under a globe, calendars under a
// timeline (unique name per parent, IN_USE guard on delete).

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('/worlds/:worldId/globes', () => {
  it('creates and lists globes', async () => {
    const w = await createWorld(app);
    const globe = await createGlobe(app, w.id, 'terra', { radius: 100 });
    expect(globe.name).toBe('terra');
    expect(globe.worldId).toBe(w.id);
    expect(globe.params).toEqual({ radius: 100 });

    const list = await api(app, 'GET', `/worlds/${w.id}/globes`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((g: any) => g.id)).toEqual([globe.id]);
  });

  it('409s on a duplicate name in the same world, allows it in another', async () => {
    const w1 = await createWorld(app, 'One');
    const w2 = await createWorld(app, 'Two');
    await createGlobe(app, w1.id, 'terra');
    const dup = await api(app, 'POST', `/worlds/${w1.id}/globes`, {
      name: 'terra',
      params: { radius: 1 },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    expect((await api(app, 'POST', `/worlds/${w2.id}/globes`, { name: 'terra', params: {} })).status).toBe(201);
  });

  it('refuses to delete a globe still referenced by a CRS', async () => {
    const w = await createWorld(app);
    const globe = await createGlobe(app, w.id);
    await createCrs(app, globe.id);
    const res = await api(app, 'DELETE', `/globes/${globe.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });
});

describe('/worlds/:worldId/timelines', () => {
  it('creates and lists timelines', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id, 'ages');
    expect(tl.name).toBe('ages');
    expect(tl.worldId).toBe(w.id);

    const list = await api(app, 'GET', `/worlds/${w.id}/timelines`);
    expect(list.body.items.map((t: any) => t.id)).toEqual([tl.id]);
  });

  it('refuses to delete a timeline still referenced by a calendar', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    await createCalendar(app, tl.id);
    const res = await api(app, 'DELETE', `/timelines/${tl.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });
});

describe('/globes/:globeId/crs', () => {
  it('creates and lists CRS definitions under a globe', async () => {
    const w = await createWorld(app);
    const globe = await createGlobe(app, w.id);
    const crs = await createCrs(app, globe.id, 'azimuthal', { type: 'azimuthal-equal-area' });
    expect(crs.name).toBe('azimuthal');
    expect(crs.globeId).toBe(globe.id);
    expect(crs.params).toEqual({ type: 'azimuthal-equal-area' });

    const list = await api(app, 'GET', `/globes/${globe.id}/crs`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: any) => c.id)).toEqual([crs.id]);
  });

  it('404s creating a CRS under an unknown globe', async () => {
    const res = await api(app, 'POST', `/globes/00000000-0000-0000-0000-000000000000/crs`, {
      name: 'main',
      params: {},
    });
    expect(res.status).toBe(404);
  });

  it('409s on a duplicate name in the same globe', async () => {
    const w = await createWorld(app);
    const globe = await createGlobe(app, w.id);
    await createCrs(app, globe.id, 'main');
    const res = await api(app, 'POST', `/globes/${globe.id}/crs`, { name: 'main', params: {} });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('allows the same name in a different globe of the same world', async () => {
    const w = await createWorld(app);
    const g1 = await createGlobe(app, w.id, 'terra');
    const g2 = await createGlobe(app, w.id, 'luna');
    await createCrs(app, g1.id, 'main');
    const res = await api(app, 'POST', `/globes/${g2.id}/crs`, { name: 'main', params: {} });
    expect(res.status).toBe(201);
  });

  it('PATCH updates, DELETE removes', async () => {
    const w = await createWorld(app);
    const globe = await createGlobe(app, w.id);
    const crs = await createCrs(app, globe.id);
    const patched = await api(app, 'PATCH', `/crs/${crs.id}`, { name: 'renamed' });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('renamed');

    expect((await api(app, 'DELETE', `/crs/${crs.id}`)).status).toBe(204);
    expect((await api(app, 'GET', `/crs/${crs.id}`)).status).toBe(404);
  });

  it('refuses to delete a CRS still referenced by a geometry', async () => {
    const w = await createWorld(app);
    const globe = await createGlobe(app, w.id);
    const entry = await createEntry(app, w.id);
    const crs = await createCrs(app, globe.id);
    await readyArtifact(
      app,
      entry.id,
      'geometries',
      { crsId: crs.id },
      JSON.stringify(rectFeature(0, 0, 1, 1)),
      'application/geo+json'
    );

    const res = await api(app, 'DELETE', `/crs/${crs.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });
});

describe('/timelines/:timelineId/calendars', () => {
  it('creates a calendar under a timeline', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    const cal = await createCalendar(app, tl.id);
    expect(cal.timelineId).toBe(tl.id);
    expect(cal.definition.params).toHaveLength(3);
    expect(cal.type).toBeUndefined();
  });

  it('rejects a structurally invalid definition', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    for (const definition of [
      {},
      { version: 1, params: [], epoch: {} },
      { version: 2, params: DEFAULT_CALENDAR_DEFINITION.params, epoch: DEFAULT_CALENDAR_DEFINITION.epoch },
    ]) {
      const res = await api(app, 'POST', `/timelines/${tl.id}/calendars`, {
        name: 'bad',
        definition,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });

  it('rejects a DSL type error with a message naming the attachment', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    const definition = JSON.parse(JSON.stringify(DEFAULT_CALENDAR_DEFINITION));
    definition.params[2].range.to = { dsl: 'return month + 1' };
    const res = await api(app, 'POST', `/timelines/${tl.id}/calendars`, {
      name: 'bad-dsl',
      definition,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/day/);
  });

  it('rejects an illegal open-ended bound (Number ancestor in the chain)', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    const definition = JSON.parse(JSON.stringify(DEFAULT_CALENDAR_DEFINITION));
    // The December trap: a null day-count under a Number year silently
    // un-terminates every coarser level.
    definition.params[2].range.to = {
      dsl: 'return case month when Sunreach then null else 30',
    };
    const res = await api(app, 'POST', `/timelines/${tl.id}/calendars`, {
      name: 'trap',
      definition,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(/Named|ancestor/i);
  });

  it('409s on a duplicate name in the same timeline, allows it in another', async () => {
    const w = await createWorld(app);
    const t1 = await createTimeline(app, w.id, 'ages');
    const t2 = await createTimeline(app, w.id, 'reigns');
    await createCalendar(app, t1.id, { name: 'common' });
    const dup = await api(app, 'POST', `/timelines/${t1.id}/calendars`, {
      name: 'common',
      definition: DEFAULT_CALENDAR_DEFINITION,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    const other = await api(app, 'POST', `/timelines/${t2.id}/calendars`, {
      name: 'common',
      definition: DEFAULT_CALENDAR_DEFINITION,
    });
    expect(other.status).toBe(201);
  });

  it('refuses to delete a calendar still referenced by a date range', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    const entry = await createEntry(app, w.id);
    const cal = await createCalendar(app, tl.id);
    await api(app, 'POST', `/entries/${entry.id}/date-ranges`, {
      calendarId: cal.id,
      rawComponents: { year: 1 },
      precisionTier: 'exact',
    });

    const res = await api(app, 'DELETE', `/calendars/${cal.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });

  it('PATCHing a definition recomputes the ticks of dependent date ranges', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    const entry = await createEntry(app, w.id);
    const cal = await createCalendar(app, tl.id);
    const range = await api(app, 'POST', `/entries/${entry.id}/date-ranges`, {
      calendarId: cal.id,
      rawComponents: { year: 2 },
      precisionTier: 'exact',
    });
    expect(range.body.tickStart).toBe(60);

    // Days now run 1..15 → 30-tick years.
    const definition = JSON.parse(JSON.stringify(DEFAULT_CALENDAR_DEFINITION));
    definition.params[2].range.to = 15;
    const patched = await api(app, 'PATCH', `/calendars/${cal.id}`, { definition });
    expect(patched.status).toBe(200);

    const detail = await api(app, 'GET', `/entries/${entry.id}`);
    expect(detail.body.dateRanges[0].tickStart).toBe(30);
    expect(detail.body.dateRanges[0].tickEnd).toBe(60);
  });

  it('a definition change that orphans a date range fails the whole PATCH', async () => {
    const w = await createWorld(app);
    const tl = await createTimeline(app, w.id);
    const entry = await createEntry(app, w.id);
    const cal = await createCalendar(app, tl.id);
    const range = await api(app, 'POST', `/entries/${entry.id}/date-ranges`, {
      calendarId: cal.id,
      rawComponents: { year: 1, month: 'Sunreach', day: 1 },
      precisionTier: 'exact',
    });

    // Drop Sunreach: the stored rawComponents no longer fit.
    const definition = JSON.parse(JSON.stringify(DEFAULT_CALENDAR_DEFINITION));
    definition.params[1].values = ['Frostwane'];
    const res = await api(app, 'PATCH', `/calendars/${cal.id}`, { definition });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toContain(range.body.id);

    // The transaction rolled back: definition and ticks are unchanged.
    const detail = await api(app, 'GET', `/calendars/${cal.id}`);
    expect(detail.body.definition.params[1].values).toEqual(['Frostwane', 'Sunreach']);
  });
});

describe('/worlds/:worldId/relation-types', () => {
  it('creates a relation type with an inverse name', async () => {
    const w = await createWorld(app);
    const rt = await createRelationType(app, w.id, 'located-in', 'contains');
    expect(rt.name).toBe('located-in');
    expect(rt.inverseName).toBe('contains');
  });

  it('409s on a duplicate name in the same world', async () => {
    const w = await createWorld(app);
    await createRelationType(app, w.id, 'causes', null);
    const res = await api(app, 'POST', `/worlds/${w.id}/relation-types`, { name: 'causes' });
    expect(res.status).toBe(409);
  });

  it('refuses to delete a relation type still referenced by a relation', async () => {
    const w = await createWorld(app);
    const a = await createEntry(app, w.id, { title: 'A' });
    const b = await createEntry(app, w.id, { title: 'B' });
    const rt = await createRelationType(app, w.id);
    await api(app, 'POST', '/relations', { fromId: a.id, toId: b.id, typeId: rt.id });

    const res = await api(app, 'DELETE', `/relation-types/${rt.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });
});
