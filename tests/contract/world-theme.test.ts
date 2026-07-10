import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, resetDb, api, createWorld } from '../helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

describe('GET /worlds/:worldId/theme', () => {
  it('returns column defaults when no row exists (never 404)', async () => {
    const w = await createWorld(app);
    const res = await api(app, 'GET', `/worlds/${w.id}/theme`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      worldId: w.id,
      fontFamily: null,
      accentColor: null,
      surfaceColor: null,
      darkMode: true,
      defaultIconWeight: 'duotone',
    });
  });

  it('404s on an unknown world', async () => {
    const res = await api(app, 'GET', '/worlds/00000000-0000-0000-0000-000000000000/theme');
    expect(res.status).toBe(404);
  });
});

describe('PUT /worlds/:worldId/theme', () => {
  it('upserts and round-trips', async () => {
    const w = await createWorld(app);
    const put = await api(app, 'PUT', `/worlds/${w.id}/theme`, {
      fontFamily: 'lora',
      accentColor: '#7C6A4E',
      darkMode: false,
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      worldId: w.id,
      fontFamily: 'lora',
      accentColor: '#7C6A4E',
      darkMode: false,
      defaultIconWeight: 'duotone',
    });

    const got = await api(app, 'GET', `/worlds/${w.id}/theme`);
    expect(got.body.fontFamily).toBe('lora');
    expect(got.body.darkMode).toBe(false);

    // second PUT updates the same row
    const put2 = await api(app, 'PUT', `/worlds/${w.id}/theme`, { fontFamily: null });
    expect(put2.body.fontFamily).toBeNull();
    expect(put2.body.accentColor).toBe('#7C6A4E');
  });
});
