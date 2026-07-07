import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  createWorld,
  createEntry,
  createCrs,
  createCalendar,
  createRelationType,
  readyArtifact,
} from '../helpers.js';
import { rectFeature } from '../fixtures.js';

// CRS definitions, calendars, and relation types share one shape:
// per-world config, unique name per world, IN_USE guard on delete.

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('/worlds/:worldId/crs', () => {
  it('creates and lists CRS definitions', async () => {
    const w = await createWorld(app);
    const crs = await createCrs(app, w.id, 'azimuthal', { projection: 'azimuthal-equal-area' });
    expect(crs.name).toBe('azimuthal');
    expect(crs.params).toEqual({ projection: 'azimuthal-equal-area' });

    const list = await api(app, 'GET', `/worlds/${w.id}/crs`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: any) => c.id)).toEqual([crs.id]);
  });

  it('409s on a duplicate name in the same world', async () => {
    const w = await createWorld(app);
    await createCrs(app, w.id, 'main');
    const res = await api(app, 'POST', `/worlds/${w.id}/crs`, { name: 'main', params: {} });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('allows the same name in a different world', async () => {
    const w1 = await createWorld(app, 'One');
    const w2 = await createWorld(app, 'Two');
    await createCrs(app, w1.id, 'main');
    const res = await api(app, 'POST', `/worlds/${w2.id}/crs`, { name: 'main', params: {} });
    expect(res.status).toBe(201);
  });

  it('PATCH updates, DELETE removes', async () => {
    const w = await createWorld(app);
    const crs = await createCrs(app, w.id);
    const patched = await api(app, 'PATCH', `/crs/${crs.id}`, { name: 'renamed' });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('renamed');

    expect((await api(app, 'DELETE', `/crs/${crs.id}`)).status).toBe(204);
    expect((await api(app, 'GET', `/crs/${crs.id}`)).status).toBe(404);
  });

  it('refuses to delete a CRS still referenced by a geometry', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const crs = await createCrs(app, w.id);
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

describe('/worlds/:worldId/calendars', () => {
  it('creates a calendar', async () => {
    const w = await createWorld(app);
    const cal = await createCalendar(app, w.id);
    expect(cal.type).toBe('arithmetic');
    expect(cal.definition.months).toHaveLength(2);
  });

  it("rejects type 'table' (reserved) and unknown types", async () => {
    const w = await createWorld(app);
    for (const type of ['table', 'lunar']) {
      const res = await api(app, 'POST', `/worlds/${w.id}/calendars`, {
        name: `cal-${type}`,
        type,
        definition: {},
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });

  it('409s on a duplicate name in the same world', async () => {
    const w = await createWorld(app);
    await createCalendar(app, w.id, { name: 'common' });
    const res = await api(app, 'POST', `/worlds/${w.id}/calendars`, {
      name: 'common',
      type: 'arithmetic',
      definition: { months: [{ name: 'M', days: 10 }] },
    });
    expect(res.status).toBe(409);
  });

  it('refuses to delete a calendar still referenced by a date range', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const cal = await createCalendar(app, w.id);
    await api(app, 'POST', `/entries/${entry.id}/date-ranges`, {
      calendarId: cal.id,
      rawComponents: { year: 1 },
      precisionTier: 'exact',
    });

    const res = await api(app, 'DELETE', `/calendars/${cal.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
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
