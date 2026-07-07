import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, api, createWorld, createEntry, readyArtifact } from '../helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('POST /worlds/:worldId/entries', () => {
  it('creates an entry with tags', async () => {
    const w = await createWorld(app);
    const res = await api(app, 'POST', `/worlds/${w.id}/entries`, {
      type: 'region',
      title: 'The Shattered Coast',
      tags: ['coastal', 'ruined'],
    });
    expect(res.status).toBe(201);
    expect(res.body.worldId).toBe(w.id);
    expect(res.body.type).toBe('region');
    expect(res.body.title).toBe('The Shattered Coast');
    expect([...res.body.tags].sort()).toEqual(['coastal', 'ruined']);
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('rejects a missing title', async () => {
    const w = await createWorld(app);
    const res = await api(app, 'POST', `/worlds/${w.id}/entries`, { type: 'region' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('404s on an unknown world', async () => {
    const res = await api(app, 'POST', '/worlds/00000000-0000-0000-0000-000000000000/entries', {
      type: 'region',
      title: 'x',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /worlds/:worldId/entries', () => {
  it('filters by type and tag', async () => {
    const w = await createWorld(app);
    const region = await createEntry(app, w.id, { type: 'region', title: 'Coast', tags: ['wet'] });
    await createEntry(app, w.id, { type: 'character', title: 'Mara' });

    const byType = await api(app, 'GET', `/worlds/${w.id}/entries?type=region`);
    expect(byType.status).toBe(200);
    expect(byType.body.items.map((e: any) => e.id)).toEqual([region.id]);

    const byTag = await api(app, 'GET', `/worlds/${w.id}/entries?tag=wet`);
    expect(byTag.body.items.map((e: any) => e.id)).toEqual([region.id]);
  });

  it('paginates with limit + cursor', async () => {
    const w = await createWorld(app);
    for (const title of ['One', 'Two', 'Three']) {
      await createEntry(app, w.id, { title });
    }

    const page1 = await api(app, 'GET', `/worlds/${w.id}/entries?limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await api(
      app,
      'GET',
      `/worlds/${w.id}/entries?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`
    );
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    const ids = [...page1.body.items, ...page2.body.items].map((e: any) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('GET /entries/:entryId', () => {
  it('returns the full detail shape with artifact metadata', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id, { tags: ['a'] });
    const doc = await readyArtifact(
      app,
      entry.id,
      'documents',
      { role: 'body' },
      '# Hello',
      'text/markdown'
    );

    const res = await api(app, 'GET', `/entries/${entry.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(entry.id);
    expect(res.body.tags).toEqual(['a']);
    expect(res.body.documents).toEqual([
      { id: doc.id, role: 'body', label: null, status: 'ready' },
    ]);
    expect(res.body.images).toEqual([]);
    expect(res.body.sketches).toEqual([]);
    expect(res.body.geometries).toEqual([]);
    expect(res.body.dateRanges).toEqual([]);
  });

  it('404s on an unknown id', async () => {
    const res = await api(app, 'GET', '/entries/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /entries/:entryId', () => {
  it('updates title and type', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const res = await api(app, 'PATCH', `/entries/${entry.id}`, {
      title: 'Renamed',
      type: 'city',
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Renamed');
    expect(res.body.type).toBe('city');
  });
});

describe('PUT /entries/:entryId/tags', () => {
  it('replaces the tag set and dedupes', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id, { tags: ['old'] });
    const res = await api(app, 'PUT', `/entries/${entry.id}/tags`, {
      tags: ['new', 'new', 'other'],
    });
    expect(res.status).toBe(200);
    expect([...res.body.tags].sort()).toEqual(['new', 'other']);

    const detail = await api(app, 'GET', `/entries/${entry.id}`);
    expect([...detail.body.tags].sort()).toEqual(['new', 'other']);
  });
});

describe('DELETE /entries/:entryId', () => {
  it('deletes the entry and cascades to its artifacts', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const doc = await readyArtifact(app, entry.id, 'documents', { role: 'body' }, 'text');

    expect((await api(app, 'DELETE', `/entries/${entry.id}`)).status).toBe(204);
    expect((await api(app, 'GET', `/entries/${entry.id}`)).status).toBe(404);
    expect((await api(app, 'GET', `/documents/${doc.id}`)).status).toBe(404);
  });
});
