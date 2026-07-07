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
  readyArtifact,
} from '../helpers.js';
import { rectFeature } from '../fixtures.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

async function setup() {
  const w = await createWorld(app);
  const entry = await createEntry(app, w.id);
  const crs = await createCrs(app, w.id);
  return { worldId: w.id, entryId: entry.id, crsId: crs.id };
}

describe('geometry create — CRS checks', () => {
  it('404s on an unknown crsId', async () => {
    const { entryId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/geometries`, {
      crsId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("rejects a CRS from a different world with CROSS_WORLD", async () => {
    const { entryId } = await setup();
    const otherWorld = await createWorld(app, 'Elsewhere');
    const foreignCrs = await createCrs(app, otherWorld.id);

    const res = await api(app, 'POST', `/entries/${entryId}/geometries`, {
      crsId: foreignCrs.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CROSS_WORLD');
  });
});

describe('geometry finalize — validation and derivation', () => {
  it('rejects a payload that is not GeoJSON, keeping status pending', async () => {
    const { entryId, crsId } = await setup();
    const created = await api(app, 'POST', `/entries/${entryId}/geometries`, { crsId });
    await uploadTo(created.body.upload.url, 'not geojson at all', 'application/geo+json');

    const fin = await api(app, 'POST', `/geometries/${created.body.id}/finalize`);
    expect(fin.status).toBe(400);
    expect(fin.body.error.code).toBe('INVALID_PAYLOAD');

    const got = await api(app, 'GET', `/geometries/${created.body.id}`);
    expect(got.body.status).toBe('pending');
  });

  it('derives bbox and caches feature properties from a Feature', async () => {
    const { entryId, crsId } = await setup();
    const fin = await readyArtifact(
      app,
      entryId,
      'geometries',
      { crsId, label: 'territory' },
      JSON.stringify(rectFeature(2, 3, 12, 8, { climate: 'temperate' })),
      'application/geo+json'
    );
    expect(fin.bbox).toEqual([2, 3, 12, 8]);
    expect(fin.properties).toEqual({ climate: 'temperate' });
    expect(fin.label).toBe('territory');
  });

  it('accepts a FeatureCollection, bbox spanning all features', async () => {
    const { entryId, crsId } = await setup();
    const collection = {
      type: 'FeatureCollection',
      features: [rectFeature(0, 0, 5, 5), rectFeature(20, 10, 30, 15)],
    };
    const fin = await readyArtifact(
      app,
      entryId,
      'geometries',
      { crsId },
      JSON.stringify(collection),
      'application/geo+json'
    );
    expect(fin.bbox).toEqual([0, 0, 30, 15]);
  });
});
