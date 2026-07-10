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
    'TRUNCATE TABLE "World", "Entry", "EntryType", "EntryTag", "Section", "Image", "Sketch", ' +
      '"Geometry", "GeometryBox", "Globe", "CrsDefinition", "DateRange", ' +
      '"Timeline", "Calendar", "RelationType", "Relation", "SearchIndex", ' +
      '"WorldTheme", "WorkspaceState" CASCADE'
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

// 'location' is one of the default entry types seeded on world create, so
// createEntry works without first registering a type. Pass over.type with any
// other seeded slug (character/faction/event/object) or a slug you created.
export async function createEntry(
  app: FastifyInstance,
  worldId: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  return must(
    await api(app, 'POST', `/worlds/${worldId}/entries`, {
      type: 'location',
      title: 'Somewhere',
      ...over,
    }),
    201,
    'createEntry'
  );
}

export async function createEntryType(
  app: FastifyInstance,
  worldId: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  return must(
    await api(app, 'POST', `/worlds/${worldId}/entry-types`, {
      name: 'Creature',
      slug: 'creature',
      ...over,
    }),
    201,
    'createEntryType'
  );
}

export async function createSection(
  app: FastifyInstance,
  entryId: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  return must(
    await api(app, 'POST', `/entries/${entryId}/sections`, { ...over }),
    201,
    'createSection'
  );
}

/** Minimal ProseMirror document wrapping a single paragraph of text. */
export function proseDoc(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

/** Create a section and PATCH content in — the section's text enters the index. */
export async function readySection(
  app: FastifyInstance,
  entryId: string,
  text: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  const s = await createSection(app, entryId, over);
  return must(
    await api(app, 'PATCH', `/sections/${s.id}`, { contentJson: proseDoc(text) }),
    200,
    'readySection'
  );
}

// radius 180/π makes an equirectangular projection map projected units to
// degrees: x = lng, y = -lat. Fixtures rely on this exact convention.
export const DEG_RADIUS = 180 / Math.PI;

export async function createGlobe(
  app: FastifyInstance,
  worldId: string,
  name = 'terra',
  params: Record<string, unknown> = { radius: DEG_RADIUS }
): Promise<any> {
  return must(
    await api(app, 'POST', `/worlds/${worldId}/globes`, { name, params }),
    201,
    'createGlobe'
  );
}

export async function createTimeline(
  app: FastifyInstance,
  worldId: string,
  name = 'ages'
): Promise<any> {
  return must(await api(app, 'POST', `/worlds/${worldId}/timelines`, { name }), 201, 'createTimeline');
}

export async function createCrs(
  app: FastifyInstance,
  globeId: string,
  name = 'main',
  params: Record<string, unknown> = { type: 'equirectangular' }
): Promise<any> {
  return must(await api(app, 'POST', `/globes/${globeId}/crs`, { name, params }), 201, 'createCrs');
}

// Default test calendar: proleptic years of two 30-day months → 60-tick years,
// {year: 1, month: 'Frostwane', day: 1} = tick 0. Search fixtures rely on this
// exact tick geometry ({year: 2} → [60, 120), {year: 101} → [6000, 6060)).
export const DEFAULT_CALENDAR_DEFINITION = {
  version: 1,
  params: [
    { name: 'year', type: 'number', range: { from: null, to: null } },
    { name: 'month', type: 'named', values: ['Frostwane', 'Sunreach'] },
    { name: 'day', type: 'number', range: { from: 1, to: 30 }, unitTicks: 1 },
  ],
  epoch: { year: 1, month: 'Frostwane', day: 1 },
};

export async function createCalendar(
  app: FastifyInstance,
  timelineId: string,
  over: Record<string, unknown> = {}
): Promise<any> {
  return must(
    await api(app, 'POST', `/timelines/${timelineId}/calendars`, {
      name: 'common reckoning',
      definition: DEFAULT_CALENDAR_DEFINITION,
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
  kind: 'images' | 'sketches' | 'geometries',
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
