import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import booleanIntersects from '@turf/boolean-intersects';
import { bboxPolygon } from '@turf/bbox-polygon';
import { notFound, validation } from '../lib/errors.js';
import { type Bbox, getBboxes } from '../lib/artifact-util.js';
import { parseGeoJson } from '../lib/payloads.js';

// Two-stage search (see docs/STACK.md): Postgres indexes narrow candidates
// (tsvector GIN, bbox GiST, tick btree, tag/type equality); the optional
// exact pass (turf) then only ever touches the narrowed set.

interface SearchQuery {
  q?: string;
  type?: string;
  tag?: string | string[];
  bbox?: string;
  crsId?: string;
  exact?: boolean;
  tickStart?: number;
  tickEnd?: number;
  limit?: number;
  cursor?: string;
}

function parseBbox(raw: string): Bbox {
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw validation('bbox must be four comma-separated numbers: minX,minY,maxX,maxY');
  }
  return parts as unknown as Bbox;
}

export function searchRoutes(app: FastifyInstance): void {
  app.get<{ Params: { worldId: string }; Querystring: SearchQuery }>(
    '/worlds/:worldId/search',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', minLength: 1 },
            type: { type: 'string' },
            tag: { type: ['string', 'array'], items: { type: 'string' } },
            bbox: { type: 'string' },
            crsId: { type: 'string' },
            exact: { type: 'boolean', default: false },
            tickStart: { type: 'number' },
            tickEnd: { type: 'number' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const { worldId } = req.params;
      const { q, type, bbox: rawBbox, crsId, exact, tickStart, tickEnd, limit = 50 } = req.query;
      const tags = req.query.tag === undefined ? [] : ([] as string[]).concat(req.query.tag);

      const world = await app.prisma.world.findUnique({ where: { id: worldId } });
      if (!world) throw notFound('world', worldId);

      const hasTicks = tickStart !== undefined || tickEnd !== undefined;
      if (hasTicks && (tickStart === undefined || tickEnd === undefined)) {
        throw validation('tickStart and tickEnd must be given together');
      }
      if (rawBbox && !crsId) throw validation('bbox requires crsId');
      if (!q && !type && tags.length === 0 && !rawBbox && !hasTicks) {
        throw validation('at least one filter (q, type, tag, bbox, tickStart/tickEnd) is required');
      }
      const bbox = rawBbox ? parseBbox(rawBbox) : null;

      // ---- Stage 1: index-backed candidate narrowing, all in one query ----
      const conds: Prisma.Sql[] = [Prisma.sql`e."worldId" = ${worldId}`];
      if (type) conds.push(Prisma.sql`e.type = ${type}`);
      for (const tag of tags) {
        conds.push(
          Prisma.sql`EXISTS (SELECT 1 FROM "EntryTag" et WHERE et."entryId" = e.id AND et.tag = ${tag})`
        );
      }
      if (q) {
        conds.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "SearchIndex" si
          WHERE si."entryId" = e.id AND si.tsv @@ plainto_tsquery('english', ${q}))`);
      }
      if (bbox) {
        conds.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "Geometry" g
          WHERE g."entryId" = e.id AND g."crsId" = ${crsId} AND g.status = 'ready'
            AND g.bbox && box(point(${bbox[0]}, ${bbox[1]}), point(${bbox[2]}, ${bbox[3]})))`);
      }
      if (hasTicks) {
        conds.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "DateRange" d
          WHERE d."entryId" = e.id
            AND d."tickStart" IS NOT NULL AND d."tickEnd" IS NOT NULL
            AND d."tickStart" <= ${tickEnd} AND d."tickEnd" >= ${tickStart})`);
      }

      const candidates = await app.prisma.$queryRaw<
        { id: string; title: string; type: string; updatedAt: Date }[]
      >(Prisma.sql`
        SELECT e.id, e.title, e.type, e."updatedAt"
        FROM "Entry" e
        WHERE ${Prisma.join(conds, ' AND ')}
        ORDER BY e."updatedAt" DESC`);

      let ids = candidates.map((c) => c.id);

      // ---- Stage 2a: exact geometry pass (turf) on the narrowed set only ----
      if (bbox && exact && ids.length > 0) {
        const queryPoly = bboxPolygon(bbox);
        const geoms = await app.prisma.geometry.findMany({
          where: { entryId: { in: ids }, crsId: crsId!, status: 'ready' },
        });
        const geomBboxes = await getBboxes(
          app.prisma,
          geoms.map((g) => g.id)
        );
        const overlaps = (b: Bbox) =>
          b[0] <= bbox[2] && b[2] >= bbox[0] && b[1] <= bbox[3] && b[3] >= bbox[1];

        const surviving = new Set<string>();
        for (const g of geoms) {
          if (surviving.has(g.entryId)) continue;
          const gb = geomBboxes.get(g.id);
          if (!gb || !overlaps(gb)) continue;
          const parsed = parseGeoJson((await app.store.getBytes(g.filePath)).toString('utf8'));
          if (parsed.features.some((f) => booleanIntersects(f as any, queryPoly))) {
            surviving.add(g.entryId);
          }
        }
        ids = ids.filter((id) => surviving.has(id));
      }

      // ---- Stage 2b: rank + snippets for text queries ----
      const matchesByEntry = new Map<
        string,
        { rank: number; matches: { sourceType: string; sourceId: string; snippet: string }[] }
      >();
      if (q && ids.length > 0) {
        const rows = await app.prisma.$queryRaw<
          { entryId: string; sourceType: string; sourceId: string; rank: number; snippet: string }[]
        >(Prisma.sql`
          SELECT si."entryId" AS "entryId", si."sourceType" AS "sourceType",
                 si."sourceId" AS "sourceId",
                 ts_rank(si.tsv, plainto_tsquery('english', ${q}))::float8 AS rank,
                 ts_headline('english', si.text, plainto_tsquery('english', ${q})) AS snippet
          FROM "SearchIndex" si
          WHERE si."entryId" IN (${Prisma.join(ids)})
            AND si.tsv @@ plainto_tsquery('english', ${q})
          ORDER BY rank DESC`);
        for (const row of rows) {
          const bucket = matchesByEntry.get(row.entryId) ?? { rank: 0, matches: [] };
          bucket.rank = Math.max(bucket.rank, row.rank);
          bucket.matches.push({
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            snippet: row.snippet,
          });
          matchesByEntry.set(row.entryId, bucket);
        }
      }

      const byId = new Map(candidates.map((c) => [c.id, c]));
      let items = ids.map((id) => {
        const entry = byId.get(id)!;
        const hit = matchesByEntry.get(id);
        return {
          entryId: entry.id,
          title: entry.title,
          type: entry.type,
          ...(q ? { rank: hit?.rank ?? 0 } : {}),
          matches: hit?.matches ?? [],
        };
      });
      if (q) items = items.sort((a, b) => (b as any).rank - (a as any).rank);

      return { items: items.slice(0, limit), nextCursor: null };
    }
  );
}
