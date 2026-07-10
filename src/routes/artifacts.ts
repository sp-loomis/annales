import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { crossWorld, invalidPayload, notFound, uploadMissing } from '../lib/errors.js';
import {
  type ArtifactKind,
  deriveStatus,
  filePathFor,
  getBboxes,
  setBboxes,
  thumbKeyFor,
} from '../lib/artifact-util.js';
import {
  IMAGE_CONTENT_TYPES,
  PayloadError,
  checkImageBytes,
  parseExcalidraw,
  parseGeoJson,
} from '../lib/payloads.js';
import { canonicalize } from '../lib/geo.js';
import { dropArtifactIndex, reindexArtifact, type SourceType } from '../lib/search-index.js';

// All four file-backed artifact kinds share one lifecycle:
//   POST /entries/:entryId/<kind>       create metadata, presigned PUT slot
//   POST /<kind>/:id/upload-url         fresh slot (revive failed / replace content)
//   POST /<kind>/:id/finalize           validate payload, derive cached fields
//   GET  /<kind>/:id                    metadata + presigned GET
//   DELETE /<kind>/:id
// Kind-specific bits (create body, validation, derivation, response shape)
// live in the KindConfig table below.

interface FinalizeResult {
  /** Prisma update patch beyond status flip. */
  patch: Record<string, unknown>;
  /** Text fed to the search index (nulls filtered). */
  texts: (string | null | undefined)[];
  /** Runs after the row update (raw-SQL derivations, thumbnails). */
  after?: () => Promise<void>;
}

interface KindConfig {
  kind: ArtifactKind;
  sourceType: SourceType;
  createSchema: object;
  delegate: (app: FastifyInstance) => any;
  /** Validate the create body against the world; return extra row fields. May throw. */
  prepareCreate: (app: FastifyInstance, entry: { id: string; worldId: string }, body: any) => Promise<Record<string, unknown>>;
  /** Validate uploaded bytes and derive cached fields. Throws PayloadError. */
  finalize: (app: FastifyInstance, row: any, bytes: Buffer) => Promise<FinalizeResult>;
  /** Kind-specific metadata fields for responses. */
  fields: (app: FastifyInstance, row: any) => Promise<Record<string, unknown>>;
  /** Extra storage keys owned by this artifact (thumbnails). */
  extraKeys?: (row: any) => string[];
}

const label = { label: { type: ['string', 'null'] } };

const KINDS: KindConfig[] = [
  {
    kind: 'images',
    sourceType: 'image',
    delegate: (app) => app.prisma.image,
    createSchema: {
      type: 'object',
      required: ['contentType'],
      properties: { contentType: { enum: IMAGE_CONTENT_TYPES }, ...label },
    },
    prepareCreate: async (_app, _entry, body) => ({
      contentType: body.contentType,
      label: body.label ?? null,
    }),
    finalize: async (app, row, bytes) => {
      checkImageBytes(bytes, row.contentType);
      const thumb = await sharp(bytes)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp()
        .toBuffer();
      return {
        patch: {},
        texts: [row.label],
        after: () => app.store.putBytes(thumbKeyFor(row.filePath), thumb, 'image/webp'),
      };
    },
    fields: async (app, row) => ({
      contentType: row.contentType,
      thumbnail:
        deriveStatus(row) === 'ready'
          ? {
              url: await app.store.presignGet(thumbKeyFor(row.filePath)),
              expiresAt: app.store.downloadExpiry().toISOString(),
            }
          : null,
    }),
    extraKeys: (row) => [thumbKeyFor(row.filePath)],
  },
  {
    kind: 'sketches',
    sourceType: 'sketch',
    delegate: (app) => app.prisma.sketch,
    createSchema: { type: 'object', properties: { ...label } },
    prepareCreate: async (_app, _entry, body) => ({ label: body.label ?? null }),
    finalize: async (_app, row, bytes) => {
      const { texts } = parseExcalidraw(bytes.toString('utf8'));
      return { patch: {}, texts: [...texts, row.label] };
    },
    fields: async () => ({}),
  },
  {
    kind: 'geometries',
    sourceType: 'geometry',
    delegate: (app) => app.prisma.geometry,
    createSchema: {
      type: 'object',
      required: ['crsId'],
      properties: { crsId: { type: 'string', minLength: 1 }, ...label },
    },
    prepareCreate: async (app, entry, body) => {
      const crs = await app.prisma.crsDefinition.findUnique({
        where: { id: body.crsId },
        include: { globe: true },
      });
      if (!crs) throw notFound('CRS definition', body.crsId);
      if (crs.globe.worldId !== entry.worldId) {
        throw crossWorld('CRS definition belongs to a different world than the entry');
      }
      return { crsId: crs.id, label: body.label ?? null };
    },
    finalize: async (app, row, bytes) => {
      const parsed = parseGeoJson(bytes.toString('utf8'));
      const crs = await app.prisma.crsDefinition.findUnique({
        where: { id: row.crsId },
        include: { globe: true },
      });
      if (!crs) throw notFound('CRS definition', row.crsId);
      const radius = Number((crs.globe.params as any)?.radius);
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new PayloadError("globe params.radius must be a positive number");
      }
      const boxes = canonicalize(parsed.features, crs.params as any, radius);
      return {
        patch: { properties: parsed.properties ?? undefined },
        texts: [row.label],
        after: () => setBboxes(app.prisma, row.id, boxes),
      };
    },
    fields: async (app, row) => {
      const bboxes = await getBboxes(app.prisma, [row.id]);
      return {
        crsId: row.crsId,
        bboxes: bboxes.get(row.id) ?? [],
        properties: row.properties ?? null,
      };
    },
  },
];

async function serialize(app: FastifyInstance, cfg: KindConfig, row: any) {
  const status = deriveStatus(row);
  return {
    id: row.id,
    entryId: row.entryId,
    label: row.label ?? null,
    order: row.order,
    status,
    ...(await cfg.fields(app, row)),
    download:
      status === 'ready'
        ? {
            url: await app.store.presignGet(row.filePath),
            expiresAt: app.store.downloadExpiry().toISOString(),
          }
        : null,
  };
}

async function uploadSlot(app: FastifyInstance, row: { filePath: string; uploadExpiresAt: Date }) {
  const ttl = app.appConfig.uploadTtlSeconds;
  return {
    url: await app.store.presignPut(row.filePath, ttl),
    method: 'PUT' as const,
    expiresAt: row.uploadExpiresAt.toISOString(),
  };
}

function registerKind(app: FastifyInstance, cfg: KindConfig): void {
  const { kind } = cfg;

  app.post<{ Params: { entryId: string }; Body: any }>(
    `/entries/:entryId/${kind}`,
    { schema: { body: cfg.createSchema } },
    async (req, reply) => {
      const entry = await app.prisma.entry.findUnique({ where: { id: req.params.entryId } });
      if (!entry) throw notFound('entry', req.params.entryId);
      const extra = await cfg.prepareCreate(app, entry, req.body);

      const id = randomUUID();
      const filePath = filePathFor(
        entry.worldId,
        entry.id,
        kind,
        id,
        (extra as { contentType?: string }).contentType
      );
      const uploadExpiresAt = new Date(Date.now() + app.appConfig.uploadTtlSeconds * 1000);
      const last = await cfg.delegate(app).findFirst({
        where: { entryId: entry.id },
        orderBy: { order: 'desc' },
      });
      const order = (last?.order ?? 0) + 1;
      const row = await cfg.delegate(app).create({
        data: { id, entryId: entry.id, filePath, status: 'pending', uploadExpiresAt, order, ...extra },
      });
      return reply
        .code(201)
        .send({ ...(await serialize(app, cfg, row)), upload: await uploadSlot(app, row) });
    }
  );

  app.post<{ Params: { id: string } }>(`/${kind}/:id/upload-url`, async (req) => {
    const existing = await cfg.delegate(app).findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound(kind, req.params.id);
    const row = await cfg.delegate(app).update({
      where: { id: existing.id },
      data: {
        status: 'pending',
        uploadExpiresAt: new Date(Date.now() + app.appConfig.uploadTtlSeconds * 1000),
      },
    });
    return { ...(await serialize(app, cfg, row)), upload: await uploadSlot(app, row) };
  });

  app.post<{ Params: { id: string } }>(`/${kind}/:id/finalize`, async (req) => {
    const row = await cfg.delegate(app).findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound(kind, req.params.id);
    if (!(await app.store.exists(row.filePath))) throw uploadMissing(row.id);

    const bytes = await app.store.getBytes(row.filePath);
    let result: FinalizeResult;
    try {
      result = await cfg.finalize(app, row, bytes);
    } catch (err) {
      if (err instanceof PayloadError) throw invalidPayload(err.message);
      throw err;
    }

    const updated = await cfg.delegate(app).update({
      where: { id: row.id },
      data: { ...result.patch, status: 'ready', uploadExpiresAt: null },
    });
    if (result.after) await result.after();
    await reindexArtifact(app.prisma, row.entryId, cfg.sourceType, row.id, result.texts);
    return serialize(app, cfg, updated);
  });

  app.get<{ Params: { id: string } }>(`/${kind}/:id`, async (req) => {
    const row = await cfg.delegate(app).findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound(kind, req.params.id);
    return serialize(app, cfg, row);
  });

  // Metadata-only patch (label, order). Content changes go through the upload
  // lifecycle, not here.
  app.patch<{ Params: { id: string }; Body: { label?: string | null; order?: number } }>(
    `/${kind}/:id`,
    {
      schema: {
        body: {
          type: 'object',
          properties: { label: { type: ['string', 'null'] }, order: { type: 'number' } },
        },
      },
    },
    async (req) => {
      const existing = await cfg.delegate(app).findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound(kind, req.params.id);
      const row = await cfg.delegate(app).update({
        where: { id: existing.id },
        data: {
          ...(req.body.label !== undefined ? { label: req.body.label } : {}),
          ...(req.body.order !== undefined ? { order: req.body.order } : {}),
        },
      });
      return serialize(app, cfg, row);
    }
  );

  app.delete<{ Params: { id: string } }>(`/${kind}/:id`, async (req, reply) => {
    const row = await cfg.delegate(app).findUnique({ where: { id: req.params.id } });
    if (!row) throw notFound(kind, req.params.id);
    try {
      await app.store.deleteAll([row.filePath, ...(cfg.extraKeys?.(row) ?? [])]);
    } catch (err) {
      req.log.warn({ err }, 'storage cleanup failed during artifact delete');
    }
    await dropArtifactIndex(app.prisma, row.id);
    await cfg.delegate(app).delete({ where: { id: row.id } });
    return reply.code(204).send();
  });
}

export function artifactRoutes(app: FastifyInstance): void {
  for (const cfg of KINDS) registerKind(app, cfg);
}
