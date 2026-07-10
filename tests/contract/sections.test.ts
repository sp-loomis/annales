import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, api, createWorld, createEntry, proseDoc } from '../helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

async function ctx() {
  const w = await createWorld(app);
  const entry = await createEntry(app, w.id);
  return { worldId: w.id, entryId: entry.id };
}

describe('POST /entries/:entryId/sections', () => {
  it('creates an empty section with increasing order', async () => {
    const { entryId } = await ctx();
    const first = await api(app, 'POST', `/entries/${entryId}/sections`, { label: 'Intro' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ entryId, label: 'Intro', order: 1, contentJson: null });

    const second = await api(app, 'POST', `/entries/${entryId}/sections`, {});
    expect(second.body.order).toBe(2);
    expect(second.body.label).toBeNull();
  });

  it('404s on an unknown entry', async () => {
    const res = await api(app, 'POST', '/entries/00000000-0000-0000-0000-000000000000/sections', {});
    expect(res.status).toBe(404);
  });
});

describe('PATCH /sections/:id', () => {
  it('replaces content and indexes the extracted text', async () => {
    const { worldId, entryId } = await ctx();
    const created = await api(app, 'POST', `/entries/${entryId}/sections`, {});
    const res = await api(app, 'PATCH', `/sections/${created.body.id}`, {
      contentJson: proseDoc('the obsidian tower loomed over the marsh'),
    });
    expect(res.status).toBe(200);
    expect(res.body.contentJson).toEqual(proseDoc('the obsidian tower loomed over the marsh'));

    const search = await api(app, 'GET', `/worlds/${worldId}/search?q=obsidian`);
    expect(search.body.items.map((i: any) => i.entryId)).toEqual([entryId]);
    expect(search.body.items[0].matches[0].sourceType).toBe('section');
  });

  it('updates label and order without touching content', async () => {
    const { entryId } = await ctx();
    const created = await api(app, 'POST', `/entries/${entryId}/sections`, { label: 'A' });
    const res = await api(app, 'PATCH', `/sections/${created.body.id}`, { label: 'B', order: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: 'B', order: 5, contentJson: null });
  });
});

describe('DELETE /sections/:id', () => {
  it('removes the section and drops it from the index', async () => {
    const { worldId, entryId } = await ctx();
    const created = await api(app, 'POST', `/entries/${entryId}/sections`, {});
    await api(app, 'PATCH', `/sections/${created.body.id}`, { contentJson: proseDoc('ephemeral') });

    expect((await api(app, 'DELETE', `/sections/${created.body.id}`)).status).toBe(204);
    expect((await api(app, 'GET', `/sections/${created.body.id}`)).status).toBe(404);

    const search = await api(app, 'GET', `/worlds/${worldId}/search?q=ephemeral`);
    expect(search.body.items).toEqual([]);
  });
});
