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
  const globe = await createGlobe(app, w.id);
  const crs = await createCrs(app, globe.id);
  return { worldId: w.id, entryId: entry.id, globeId: globe.id, crsId: crs.id };
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

  it('rejects a CRS whose globe is in a different world with CROSS_WORLD', async () => {
    const { entryId } = await setup();
    const otherWorld = await createWorld(app, 'Elsewhere');
    const otherGlobe = await createGlobe(app, otherWorld.id);
    const foreignCrs = await createCrs(app, otherGlobe.id);

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

  // Equirectangular with radius 180/π: x = lng, y = -lat. So an authored
  // rect [2,3,12,8] canonicalizes to lng [2,12], lat [-8,-3].
  it('derives a canonical lng/lat bbox and caches feature properties', async () => {
    const { entryId, crsId } = await setup();
    const fin = await readyArtifact(
      app,
      entryId,
      'geometries',
      { crsId, label: 'territory' },
      JSON.stringify(rectFeature(2, 3, 12, 8, { climate: 'temperate' })),
      'application/geo+json'
    );
    expect(fin.bboxes).toHaveLength(1);
    expect(fin.bboxes[0]).toEqual([2, -8, 12, -3]);
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
    expect(fin.bboxes).toHaveLength(1);
    expect(fin.bboxes[0]).toEqual([0, -15, 30, 0]);
  });
});

describe('geometry finalize — antimeridian and poles', () => {
  // rotate [180,0,0] centres the projection on the antimeridian: a small rect
  // around the projected origin canonicalizes to longitudes straddling ±180.
  it('splits an antimeridian-crossing extent into two canonical boxes', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const globe = await createGlobe(app, w.id);
    const crs = await createCrs(app, globe.id, 'shifted', {
      type: 'equirectangular',
      rotate: [180, 0, 0],
    });
    const fin = await readyArtifact(
      app,
      entry.id,
      'geometries',
      { crsId: crs.id },
      JSON.stringify(rectFeature(-5, -5, 5, 5)),
      'application/geo+json'
    );
    expect(fin.bboxes).toHaveLength(2);
    // one box hugs +180, the other -180
    const maxLngs = fin.bboxes.map((b: number[]) => b[2]).sort((a: number, b: number) => a - b);
    expect(maxLngs[maxLngs.length - 1]).toBeCloseTo(180, 5);
    const minLngs = fin.bboxes.map((b: number[]) => b[0]).sort((a: number, b: number) => a - b);
    expect(minLngs[0]).toBeCloseTo(-180, 5);
  });

  // Azimuthal projection centred on the north pole: a square around the
  // projected origin encircles the pole → full-longitude box reaching lat 90.
  it('widens a pole-enclosing extent to a full-longitude box', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const globe = await createGlobe(app, w.id);
    const crs = await createCrs(app, globe.id, 'polar', {
      type: 'azimuthal-equal-area',
      rotate: [0, -90, 0],
    });
    const fin = await readyArtifact(
      app,
      entry.id,
      'geometries',
      { crsId: crs.id },
      JSON.stringify(rectFeature(-10, -10, 10, 10)),
      'application/geo+json'
    );
    expect(fin.bboxes).toHaveLength(1);
    const [minLng, , maxLng, maxLat] = fin.bboxes[0];
    expect(minLng).toBeCloseTo(-180, 5);
    expect(maxLng).toBeCloseTo(180, 5);
    expect(maxLat).toBeCloseTo(90, 5);
  });

  // The enclosed pole is determined by projecting the poles into the CRS plane,
  // NOT by a latitude-sign guess. This large north-polar cap (azimuthal-
  // equidistant, radius 180/π ⇒ planar radius = angular degrees) crosses the
  // equator: edge midpoints at lat +10, corners at lat ≈ −23, so the boundary's
  // mean latitude is NEGATIVE. A sign heuristic would pick the south pole and
  // cap the box at lat +10 (missing the pole); the exact test picks north → 90.
  it('picks the enclosed pole by geometry, not boundary latitude sign', async () => {
    const w = await createWorld(app);
    const entry = await createEntry(app, w.id);
    const globe = await createGlobe(app, w.id);
    const crs = await createCrs(app, globe.id, 'polar-wide', {
      type: 'azimuthal-equidistant',
      rotate: [0, -90, 0], // north pole at the projected origin
    });
    const fin = await readyArtifact(
      app,
      entry.id,
      'geometries',
      { crsId: crs.id },
      JSON.stringify(rectFeature(-80, -80, 80, 80)),
      'application/geo+json'
    );
    expect(fin.bboxes).toHaveLength(1);
    const [minLng, minLat, maxLng, maxLat] = fin.bboxes[0];
    expect(minLng).toBeCloseTo(-180, 5);
    expect(maxLng).toBeCloseTo(180, 5);
    expect(maxLat).toBeCloseTo(90, 5); // north pole enclosed — not capped at +10
    expect(minLat).toBeLessThan(0);
  });
});
