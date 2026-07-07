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
  createCrs,
} from '../helpers.js';
import { PNG_1X1, rectFeature, excalidrawScene } from '../fixtures.js';

// The presigned-upload lifecycle is one contract shared by all four
// file-backed artifact kinds: create (pending) → upload → finalize (ready).
// Kind-specific validation/derivation lives in the per-kind test files.

interface KindCase {
  kind: 'documents' | 'images' | 'sketches' | 'geometries';
  // createBody may need world context (geometry needs a crsId)
  createBody: (ctx: { crsId: string }) => Record<string, unknown>;
  payload: () => string | Uint8Array;
  contentType: string;
}

const KINDS: KindCase[] = [
  {
    kind: 'documents',
    createBody: () => ({ role: 'body', label: 'main text' }),
    payload: () => '# The Shattered Coast\n\nSalt and ruin.',
    contentType: 'text/markdown',
  },
  {
    kind: 'images',
    createBody: () => ({ label: 'banner', contentType: 'image/png' }),
    payload: () => PNG_1X1,
    contentType: 'image/png',
  },
  {
    kind: 'sketches',
    createBody: () => ({ label: 'tavern layout' }),
    payload: () => JSON.stringify(excalidrawScene(['bar', 'hearth'])),
    contentType: 'application/json',
  },
  {
    kind: 'geometries',
    createBody: ({ crsId }) => ({ crsId, label: 'territory' }),
    payload: () => JSON.stringify(rectFeature(0, 0, 10, 10)),
    contentType: 'application/geo+json',
  },
];

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(resetDb);

async function makeEntryCtx(theApp: FastifyInstance = app) {
  const w = await createWorld(theApp);
  const entry = await createEntry(theApp, w.id);
  const crs = await createCrs(theApp, w.id);
  return { worldId: w.id, entryId: entry.id, crsId: crs.id };
}

describe.each(KINDS)('$kind lifecycle', ({ kind, createBody, payload, contentType }) => {
  it('create returns pending status and a presigned upload slot', async () => {
    const ctx = await makeEntryCtx();
    const res = await api(app, 'POST', `/entries/${ctx.entryId}/${kind}`, createBody(ctx));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.upload.method).toBe('PUT');
    expect(res.body.upload.url).toMatch(/^http/);
    expect(new Date(res.body.upload.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('404s when the entry does not exist', async () => {
    const ctx = await makeEntryCtx();
    const res = await api(
      app,
      'POST',
      '/entries/00000000-0000-0000-0000-000000000000/' + kind,
      createBody(ctx)
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('finalize before upload → 409 UPLOAD_MISSING', async () => {
    const ctx = await makeEntryCtx();
    const created = await api(app, 'POST', `/entries/${ctx.entryId}/${kind}`, createBody(ctx));
    const res = await api(app, 'POST', `/${kind}/${created.body.id}/finalize`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('UPLOAD_MISSING');
  });

  it('upload + finalize → ready, GET serves a working download URL', async () => {
    const ctx = await makeEntryCtx();
    const created = await api(app, 'POST', `/entries/${ctx.entryId}/${kind}`, createBody(ctx));
    await uploadTo(created.body.upload.url, payload(), contentType);

    const fin = await api(app, 'POST', `/${kind}/${created.body.id}/finalize`);
    expect(fin.status).toBe(200);
    expect(fin.body.status).toBe('ready');

    const got = await api(app, 'GET', `/${kind}/${created.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.status).toBe('ready');
    expect(got.body.download.url).toMatch(/^http/);

    const bytes = await downloadFrom(got.body.download.url);
    expect(bytes.equals(Buffer.from(payload()))).toBe(true);
  });

  it('GET while pending → download is null', async () => {
    const ctx = await makeEntryCtx();
    const created = await api(app, 'POST', `/entries/${ctx.entryId}/${kind}`, createBody(ctx));
    const got = await api(app, 'GET', `/${kind}/${created.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.status).toBe('pending');
    expect(got.body.download).toBeNull();
  });

  it('expired upload window → status reads failed; upload-url revives it', async () => {
    // TTL 0: the upload window is already over the moment the artifact exists.
    const expiredApp = await makeApp({ uploadTtlSeconds: 0 });
    try {
      const ctx = await makeEntryCtx(expiredApp);
      const created = await api(
        expiredApp,
        'POST',
        `/entries/${ctx.entryId}/${kind}`,
        createBody(ctx)
      );

      const got = await api(expiredApp, 'GET', `/${kind}/${created.body.id}`);
      expect(got.body.status).toBe('failed');

      // fresh window on the normal-TTL app → pending again, and usable
      const revived = await api(app, 'POST', `/${kind}/${created.body.id}/upload-url`);
      expect(revived.status).toBe(200);
      expect(revived.body.status).toBe('pending');
      expect(revived.body.upload.url).toMatch(/^http/);

      await uploadTo(revived.body.upload.url, payload(), contentType);
      const fin = await api(app, 'POST', `/${kind}/${created.body.id}/finalize`);
      expect(fin.status).toBe(200);
      expect(fin.body.status).toBe('ready');
    } finally {
      await expiredApp.close();
    }
  });

  it('DELETE removes the artifact', async () => {
    const ctx = await makeEntryCtx();
    const created = await api(app, 'POST', `/entries/${ctx.entryId}/${kind}`, createBody(ctx));
    expect((await api(app, 'DELETE', `/${kind}/${created.body.id}`)).status).toBe(204);
    expect((await api(app, 'GET', `/${kind}/${created.body.id}`)).status).toBe(404);
  });
});

describe('content replacement', () => {
  it('upload-url on a ready document + re-finalize serves the new content', async () => {
    const ctx = await makeEntryCtx();
    const created = await api(app, 'POST', `/entries/${ctx.entryId}/documents`, { role: 'body' });
    await uploadTo(created.body.upload.url, 'first draft', 'text/markdown');
    await api(app, 'POST', `/documents/${created.body.id}/finalize`);

    const slot = await api(app, 'POST', `/documents/${created.body.id}/upload-url`);
    expect(slot.status).toBe(200);
    await uploadTo(slot.body.upload.url, 'second draft', 'text/markdown');
    const fin = await api(app, 'POST', `/documents/${created.body.id}/finalize`);
    expect(fin.status).toBe(200);

    const got = await api(app, 'GET', `/documents/${created.body.id}`);
    const bytes = await downloadFrom(got.body.download.url);
    expect(bytes.toString()).toBe('second draft');
  });
});
