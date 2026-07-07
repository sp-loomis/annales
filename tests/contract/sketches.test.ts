import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  uploadTo,
  createWorld,
  createEntry,
  readyArtifact,
} from '../helpers.js';
import { excalidrawScene } from '../fixtures.js';

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
  return { entryId: entry.id };
}

describe('sketch finalize', () => {
  it('rejects a payload that is not an Excalidraw scene, keeping status pending', async () => {
    const { entryId } = await setup();
    const created = await api(app, 'POST', `/entries/${entryId}/sketches`, {});
    await uploadTo(
      created.body.upload.url,
      JSON.stringify({ some: 'other json' }),
      'application/json'
    );

    const fin = await api(app, 'POST', `/sketches/${created.body.id}/finalize`);
    expect(fin.status).toBe(400);
    expect(fin.body.error.code).toBe('INVALID_PAYLOAD');

    const got = await api(app, 'GET', `/sketches/${created.body.id}`);
    expect(got.body.status).toBe('pending');
  });

  it('accepts a valid scene', async () => {
    const { entryId } = await setup();
    const fin = await readyArtifact(
      app,
      entryId,
      'sketches',
      { label: 'tavern layout' },
      JSON.stringify(excalidrawScene(['bar', 'hearth'])),
      'application/json'
    );
    expect(fin.status).toBe('ready');
    expect(fin.label).toBe('tavern layout');
    // scene text is searchable — covered in search.test.ts
  });
});
