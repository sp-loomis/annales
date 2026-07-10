import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, api, createWorld, createEntry, createEntryType } from '../helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('default entry types', () => {
  it('seeds Character/Location/Faction/Event/Object on world create', async () => {
    const w = await createWorld(app);
    const res = await api(app, 'GET', `/worlds/${w.id}/entry-types`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((t: any) => t.slug).sort()).toEqual([
      'character',
      'event',
      'faction',
      'location',
      'object',
    ]);
    const character = res.body.items.find((t: any) => t.slug === 'character');
    expect(character).toMatchObject({ name: 'Character', iconName: null, iconWeight: null });
    expect(character.worldId).toBe(w.id);
  });
});

describe('POST /worlds/:worldId/entry-types', () => {
  it('creates a custom type with icon fields', async () => {
    const w = await createWorld(app);
    const res = await api(app, 'POST', `/worlds/${w.id}/entry-types`, {
      name: 'Creature',
      slug: 'creature',
      iconName: 'PawPrint',
      iconWeight: 'duotone',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      worldId: w.id,
      name: 'Creature',
      slug: 'creature',
      iconName: 'PawPrint',
      iconWeight: 'duotone',
    });
  });

  it('409s on a duplicate slug within the world', async () => {
    const w = await createWorld(app);
    const res = await api(app, 'POST', `/worlds/${w.id}/entry-types`, {
      name: 'Place',
      slug: 'location', // already seeded
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('404s on an unknown world', async () => {
    const res = await api(app, 'POST', '/worlds/00000000-0000-0000-0000-000000000000/entry-types', {
      name: 'X',
      slug: 'x',
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /entry-types/:id', () => {
  it('updates name and icons', async () => {
    const w = await createWorld(app);
    const type = await createEntryType(app, w.id);
    const res = await api(app, 'PATCH', `/entry-types/${type.id}`, {
      name: 'Beast',
      iconName: 'Cat',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Beast', slug: 'creature', iconName: 'Cat' });
  });
});

describe('DELETE /entry-types/:id', () => {
  it('deletes an unused type', async () => {
    const w = await createWorld(app);
    const type = await createEntryType(app, w.id);
    expect((await api(app, 'DELETE', `/entry-types/${type.id}`)).status).toBe(204);
    expect((await api(app, 'GET', `/entry-types/${type.id}`)).status).toBe(404);
  });

  it('409 IN_USE when an entry references it', async () => {
    const w = await createWorld(app);
    const type = await createEntryType(app, w.id, { name: 'Beast', slug: 'beast' });
    await createEntry(app, w.id, { type: 'beast' });
    const res = await api(app, 'DELETE', `/entry-types/${type.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IN_USE');
  });
});
