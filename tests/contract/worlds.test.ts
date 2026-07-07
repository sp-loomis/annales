import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, api, createWorld, createEntry } from '../helpers.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('GET /healthz', () => {
  it('reports ok when DB and storage are reachable', async () => {
    const res = await api(app, 'GET', '/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /worlds', () => {
  it('creates a world', async () => {
    const res = await api(app, 'POST', '/worlds', { name: 'Aldervane' });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(UUID_RE);
    expect(res.body.name).toBe('Aldervane');
  });

  it('rejects a missing name with the error envelope', async () => {
    const res = await api(app, 'POST', '/worlds', {});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(typeof res.body.error.message).toBe('string');
  });
});

describe('GET /worlds', () => {
  it('lists created worlds', async () => {
    const w = await createWorld(app, 'Aldervane');
    const res = await api(app, 'GET', '/worlds');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ id: w.id, name: 'Aldervane' }]);
    expect(res.body.nextCursor).toBeNull();
  });
});

describe('GET /worlds/:worldId', () => {
  it('returns one world', async () => {
    const w = await createWorld(app, 'Aldervane');
    const res = await api(app, 'GET', `/worlds/${w.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: w.id, name: 'Aldervane' });
  });

  it('404s on an unknown id', async () => {
    const res = await api(app, 'GET', '/worlds/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /worlds/:worldId', () => {
  it('renames a world', async () => {
    const w = await createWorld(app, 'Aldervane');
    const res = await api(app, 'PATCH', `/worlds/${w.id}`, { name: 'Aldervane Reborn' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: w.id, name: 'Aldervane Reborn' });
  });

  it('404s on an unknown id', async () => {
    const res = await api(app, 'PATCH', '/worlds/00000000-0000-0000-0000-000000000000', {
      name: 'x',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /worlds/:worldId', () => {
  it('deletes a world and cascades to its entries', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);

    const del = await api(app, 'DELETE', `/worlds/${w.id}`);
    expect(del.status).toBe(204);

    expect((await api(app, 'GET', `/worlds/${w.id}`)).status).toBe(404);
    expect((await api(app, 'GET', `/entries/${entry.id}`)).status).toBe(404);
  });

  it('404s on an unknown id', async () => {
    const res = await api(app, 'DELETE', '/worlds/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
