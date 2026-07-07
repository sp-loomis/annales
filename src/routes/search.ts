import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import booleanIntersects from '@turf/boolean-intersects';
import { bboxPolygon } from '@turf/bbox-polygon';
import { geoAzimuthalEquidistant } from 'd3-geo';
import { notFound, validation } from '../lib/errors.js';
import { type Bbox } from '../lib/artifact-util.js';
import { parseGeoJson } from '../lib/payloads.js';
import { splitLngBox, toCanonicalFeatures } from '../lib/geo.js';

// Two-stage search (see docs/STACK.md): Postgres indexes narrow candidates
// (tsvector GIN, canonical bbox GiST, tick btree, tag/type equality); the
// optional exact pass (turf) then only ever touches the narrowed set.
//
// Geo bbox and the query box are canonical lng/lat: bbox search is scoped by
// globeId (a geometry reaches its globe via its CRS), so one query compares
// every CRS under the globe in one frame. Tick search is scoped by timelineId.

interface SearchQuery {
  q?: string;
  type?: string;
  tag?: string | string[];
  bbox?: string;
  globeId?: string;
  exact?: boolean;
  tickStart?: number;
  tickEnd?: number;
  timelineId?: string;
  limit?: number;
  cursor?: string;
}

function parseBbox(raw: string): Bbox {
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw validation('bbox must be four comma-separated numbers: minLng,minLat,maxLng,maxLat');
  }
  return parts as unknown as Bbox;
}

// Project a GeoJSON coordinate tree through a d3 projection (planar output).
function projectCoords(coords: any, proj: (p: [number, number]) => [number, number] | null): any {
  if (typeof coords[0] === 'number') {
    const p = proj([coords[0], coords[1]]);
    return p ?? [NaN, NaN];
  }
  return coords.map((c: any) => projectCoords(c, proj));
}

function projectFeature(feature: any, proj: (p: [number, number]) => [number, number] | null): any {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: feature.geometry.type,
      coordinates: projectCoords(feature.geometry.coordinates, proj),
    },
  };
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// Great-circle angular distance in degrees between two canonical lng/lat points.
function angularDeg(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const c =
    Math.sin(aLat * D2R) * Math.sin(bLat * D2R) +
    Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.cos((bLng - aLng) * D2R);
  return Math.acos(Math.min(1, Math.max(-1, c))) * R2D;
}

// Does any vertex (canonical lng/lat tree) lie more than `limit`° from the
// query centre? Past the near hemisphere the query-local planar frame distorts
// toward its singularity and turf can't be trusted (see docs/ARCHITECTURE.md).
function anyBeyond(coords: any, cLng: number, cLat: number, limit: number): boolean {
  if (typeof coords[0] === 'number') return angularDeg(cLng, cLat, coords[0], coords[1]) > limit;
  return coords.some((c: any) => anyBeyond(c, cLng, cLat, limit));
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
            globeId: { type: 'string' },
            exact: { type: 'boolean', default: false },
            tickStart: { type: 'number' },
            tickEnd: { type: 'number' },
            timelineId: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const { worldId } = req.params;
      const { q, type, bbox: rawBbox, globeId, exact, tickStart, tickEnd, timelineId, limit = 50 } =
        req.query;
      const tags = req.query.tag === undefined ? [] : ([] as string[]).concat(req.query.tag);

      const world = await app.prisma.world.findUnique({ where: { id: worldId } });
      if (!world) throw notFound('world', worldId);

      const hasTicks = tickStart !== undefined || tickEnd !== undefined;
      if (hasTicks && (tickStart === undefined || tickEnd === undefined)) {
        throw validation('tickStart and tickEnd must be given together');
      }
      if (rawBbox && !globeId) throw validation('bbox requires globeId');
      if (hasTicks && !timelineId) throw validation('tickStart/tickEnd requires timelineId');
      if (!q && !type && tags.length === 0 && !rawBbox && !hasTicks) {
        throw validation('at least one filter (q, type, tag, bbox, tickStart/tickEnd) is required');
      }
      const bbox = rawBbox ? parseBbox(rawBbox) : null;
      // The query box may itself cross the antimeridian → 1–2 canonical boxes.
      const qBoxes = bbox ? splitLngBox(bbox[0], bbox[2], bbox[1], bbox[3]) : [];

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
        const overlaps = qBoxes.map(
          (b) => Prisma.sql`gb.box && box(point(${b[0]}, ${b[1]}), point(${b[2]}, ${b[3]}))`
        );
        conds.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "Geometry" g
          JOIN "CrsDefinition" c ON c.id = g."crsId"
          JOIN "GeometryBox" gb ON gb."geometryId" = g.id
          WHERE g."entryId" = e.id AND c."globeId" = ${globeId} AND g.status = 'ready'
            AND (${Prisma.join(overlaps, ' OR ')}))`);
      }
      if (hasTicks) {
        conds.push(Prisma.sql`EXISTS (
          SELECT 1 FROM "DateRange" d
          JOIN "Calendar" cal ON cal.id = d."calendarId"
          WHERE d."entryId" = e.id AND cal."timelineId" = ${timelineId}
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
      // Runs in a query-local azimuthal frame centred on the query box. That
      // frame is only trustworthy within ~a hemisphere of the centre; geometry
      // reaching past HORIZON approaches the frame singularity where turf can't
      // be trusted. So: a near-global query skips the exact pass entirely, and a
      // candidate reaching past the horizon is conservatively KEPT (never dropped
      // on an untrustworthy test). See docs/ARCHITECTURE.md.
      const HORIZON = 90;
      const queryPoly = bbox ? bboxPolygon(bbox) : null;
      const queryDegenerate =
        queryPoly !== null &&
        anyBeyond(queryPoly.geometry.coordinates, (bbox![0] + bbox![2]) / 2, (bbox![1] + bbox![3]) / 2, HORIZON);

      if (bbox && exact && ids.length > 0 && !queryDegenerate) {
        const cLng = (bbox[0] + bbox[2]) / 2;
        const cLat = (bbox[1] + bbox[3]) / 2;
        const local = geoAzimuthalEquidistant().rotate([-cLng, -cLat]);
        const proj = (p: [number, number]) => local(p) as [number, number] | null;
        const projQuery = projectFeature(queryPoly, proj);

        const geoms = await app.prisma.geometry.findMany({
          where: { entryId: { in: ids }, status: 'ready', crs: { globeId } },
          include: { crs: { include: { globe: true } } },
        });

        const surviving = new Set<string>();
        for (const g of geoms) {
          if (surviving.has(g.entryId)) continue;
          const radius = Number((g.crs.globe.params as any)?.radius);
          const parsed = parseGeoJson((await app.store.getBytes(g.filePath)).toString('utf8'));
          const canon = toCanonicalFeatures(parsed.features, g.crs.params as any, radius);
          // candidate wraps toward the frame singularity → keep, don't test
          if (canon.some((f) => anyBeyond(f.geometry.coordinates, cLng, cLat, HORIZON))) {
            surviving.add(g.entryId);
            continue;
          }
          if (canon.some((f) => booleanIntersects(projectFeature(f, proj) as any, projQuery))) {
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
