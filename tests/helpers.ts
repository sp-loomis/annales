import type { FastifyInstance, InjectOptions } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://sheaf:sheaf@localhost:5433/sheaf_test';

export const TEST_S3 = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:4566',
  region: 'us-east-1',
  bucket: 'sheaf-test',
  accessKeyId: 'test',
  secretAccessKey: 'test',
};

export function makeApp(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  return buildApp({
    databaseUrl: TEST_DATABASE_URL,
    s3Endpoint: TEST_S3.endpoint,
    s3Region: TEST_S3.region,
    s3Bucket: TEST_S3.bucket,
    s3AccessKeyId: TEST_S3.accessKeyId,
    s3SecretAccessKey: TEST_S3.secretAccessKey,
    uploadTtlSeconds: 900,
    ...overrides,
  });
}

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "World", "Entry", "EntryTag", "Document", "Image", "Sketch", ' +
      '"Geometry", "CrsDefinition", "DateRange", "Calendar", "RelationType", ' +
      '"Relation", "SearchIndex" CASCADE'
  );
}

export interface ApiResponse {
  status: number;
  body: any;
}

export async function api(
  app: FastifyInstance,
  method: string,
  url: string,
  payload?: unknown
): Promise<ApiResponse> {
  const opts: InjectOptions = { method: method as InjectOptions['method'], url };
  if (payload !== undefined) opts.payload = payload as InjectOptions['payload'];
  const res = await app.inject(opts);
  let body: any = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
}

/** PUT a payload to a presigned URL (LocalStack), throwing on non-2xx. */
export async function uploadTo(
  url: string,
  body: string | Uint8Array,
  contentType = 'application/octet-stream'
): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: body as BodyInit,
    headers: { 'content-type': contentType },
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
}

/** GET a presigned download URL and return the raw bytes. */
export async function downloadFrom(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---- API-level builders — test setup goes through the contract, never the DB ----

function must(res: ApiResponse, status: number, what: string): any {
  if (res.status !== status) {
    throw new Error(`${what}: expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createWorld(app: FastifyInstance, name = 'Testland'): Promise<any> {
  return must(await api(app, 'POST', '/worlds', { name }), 201, 'createWorld');
}

export async function createEntry(
  app: FastifyInstance,
  worldId: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  return must(
    await api(app, 'POST', `/worlds/${worldId}/entries`, {
      type: 'place',
      title: 'Somewhere',
      ...over,
    }),
    201,
    'createEntry'
  );
}

export async function createCrs(
  app: FastifyInstance,
  worldId: string,
  name = 'main',
  params: Record<string, unknown> = { projection: 'equirectangular' }
): Promise<any> {
  return must(await api(app, 'POST', `/worlds/${worldId}/crs`, { name, params }), 201, 'createCrs');
}

export async function createCalendar(
  app: FastifyInstance,
  worldId: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  return must(
    await api(app, 'POST', `/worlds/${worldId}/calendars`, {
      name: 'common reckoning',
      type: 'arithmetic',
      definition: {
        months: [
          { name: 'Frostwane', days: 30 },
          { name: 'Sunreach', days: 30 },
        ],
      },
      ...over,
    }),
    201,
    'createCalendar'
  );
}

export async function createRelationType(
  app: FastifyInstance,
  worldId: string,
  name = 'located-in',
  inverseName: string | null = 'contains'
): Promise<any> {
  return must(
    await api(app, 'POST', `/worlds/${worldId}/relation-types`, { name, inverseName }),
    201,
    'createRelationType'
  );
}

/** Full create → upload → finalize round trip; returns the finalize body. */
export async function readyArtifact(
  app: FastifyInstance,
  entryId: string,
  kind: 'documents' | 'images' | 'sketches' | 'geometries',
  createBody: Record<string, unknown>,
  payload: string | Uint8Array,
  contentType = 'application/octet-stream'
): Promise<any> {
  const created = must(
    await api(app, 'POST', `/entries/${entryId}/${kind}`, createBody),
    201,
    `create ${kind}`
  );
  await uploadTo(created.upload.url, payload, contentType);
  return must(await api(app, 'POST', `/${kind}/${created.id}/finalize`), 200, `finalize ${kind}`);
}
