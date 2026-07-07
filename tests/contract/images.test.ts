import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  makeApp,
  resetDb,
  api,
  uploadTo,
  downloadFrom,
  createWorld,
  createEntry,
  readyArtifact,
} from '../helpers.js';
import { PNG_1X1 } from '../fixtures.js';

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

describe('image create', () => {
  it('rejects an unsupported contentType', async () => {
    const { entryId } = await setup();
    const res = await api(app, 'POST', `/entries/${entryId}/images`, {
      contentType: 'image/tiff',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});

describe('image finalize', () => {
  it('rejects bytes that do not match the declared type, keeping status pending', async () => {
    const { entryId } = await setup();
    const created = await api(app, 'POST', `/entries/${entryId}/images`, {
      contentType: 'image/png',
    });
    await uploadTo(created.body.upload.url, 'plainly not a png', 'image/png');

    const fin = await api(app, 'POST', `/images/${created.body.id}/finalize`);
    expect(fin.status).toBe(400);
    expect(fin.body.error.code).toBe('INVALID_PAYLOAD');

    const got = await api(app, 'GET', `/images/${created.body.id}`);
    expect(got.body.status).toBe('pending');
  });

  it('a ready image serves both original and a webp thumbnail', async () => {
    const { entryId } = await setup();
    const fin = await readyArtifact(
      app,
      entryId,
      'images',
      { label: 'banner', contentType: 'image/png' },
      PNG_1X1,
      'image/png'
    );
    expect(fin.status).toBe('ready');

    const got = await api(app, 'GET', `/images/${fin.id}`);
    expect(got.body.download.url).toMatch(/^http/);
    expect(got.body.thumbnail.url).toMatch(/^http/);

    const original = await downloadFrom(got.body.download.url);
    expect(original.equals(PNG_1X1)).toBe(true);

    const thumb = await downloadFrom(got.body.thumbnail.url);
    // WEBP container: 'RIFF' .... 'WEBP'
    expect(thumb.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(thumb.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('thumbnail is null while pending', async () => {
    const { entryId } = await setup();
    const created = await api(app, 'POST', `/entries/${entryId}/images`, {
      contentType: 'image/png',
    });
    const got = await api(app, 'GET', `/images/${created.body.id}`);
    expect(got.body.thumbnail).toBeNull();
  });
});
