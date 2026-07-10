import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, api, createWorld, createEntry } from '../helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('GET /worlds/:worldId/workspace-state', () => {
  it('returns empty defaults when no row exists', async () => {
    const w = await createWorld(app);
    const res = await api(app, 'GET', `/worlds/${w.id}/workspace-state`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      worldId: w.id,
      openEntryIds: [],
      sidebarState: null,
      updatedAt: null,
    });
  });

  it('404s on an unknown world', async () => {
    const res = await api(app, 'GET', '/worlds/00000000-0000-0000-0000-000000000000/workspace-state');
    expect(res.status).toBe(404);
  });
});

describe('PUT /worlds/:worldId/workspace-state', () => {
  it('upserts ordered tabs and sidebar state', async () => {
    const w = await createWorld(app);
    const e1 = await createEntry(app, w.id, { title: 'One' });
    const e2 = await createEntry(app, w.id, { title: 'Two' });

    const put = await api(app, 'PUT', `/worlds/${w.id}/workspace-state`, {
      openEntryIds: [e2.id, e1.id],
      sidebarState: { density: 'compact', sort: 'title' },
    });
    expect(put.status).toBe(200);
    expect(put.body.openEntryIds).toEqual([e2.id, e1.id]);
    expect(put.body.sidebarState).toEqual({ density: 'compact', sort: 'title' });
    expect(typeof put.body.updatedAt).toBe('string');

    const got = await api(app, 'GET', `/worlds/${w.id}/workspace-state`);
    expect(got.body.openEntryIds).toEqual([e2.id, e1.id]);

    // partial update leaves the untouched field intact
    const put2 = await api(app, 'PUT', `/worlds/${w.id}/workspace-state`, { openEntryIds: [] });
    expect(put2.body.openEntryIds).toEqual([]);
    expect(put2.body.sidebarState).toEqual({ density: 'compact', sort: 'title' });
  });
});
