import { Prisma, type PrismaClient } from '@prisma/client';

export type ArtifactKind = 'documents' | 'images' | 'sketches' | 'geometries';

// 'failed' is derived, never stored: a pending row whose upload window has
// passed. A fresh upload-url flips it back to pending.
export type ArtifactStatus = 'pending' | 'ready' | 'failed';

export function deriveStatus(row: {
  status: string;
  uploadExpiresAt: Date | null;
}): ArtifactStatus {
  if (row.status === 'ready') return 'ready';
  if (row.uploadExpiresAt && row.uploadExpiresAt.getTime() <= Date.now()) return 'failed';
  return 'pending';
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

export function filePathFor(
  worldId: string,
  entryId: string,
  kind: ArtifactKind,
  artifactId: string,
  imageContentType?: string
): string {
  const ext =
    kind === 'documents'
      ? '.md'
      : kind === 'sketches'
        ? '.excalidraw.json'
        : kind === 'geometries'
          ? '.geojson'
          : IMAGE_EXT[imageContentType ?? ''] ?? '.bin';
  return `worlds/${worldId}/entries/${entryId}/${kind}/${artifactId}${ext}`;
}

export function thumbKeyFor(filePath: string): string {
  return `${filePath}.thumb.webp`;
}

/** Canonical lng/lat bbox: [minLng, minLat, maxLng, maxLat]. */
export type Bbox = [number, number, number, number];

/**
 * A geometry has one or two canonical boxes (antimeridian split). `box` is an
 * Unsupported (native box) column in GeometryBox — read via raw SQL,
 * corner-order agnostic. Returns a list per geometry (empty while pending).
 */
export async function getBboxes(
  prisma: PrismaClient,
  geometryIds: string[]
): Promise<Map<string, Bbox[]>> {
  if (geometryIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    { geometryId: string; minx: number; miny: number; maxx: number; maxy: number }[]
  >(Prisma.sql`
    SELECT "geometryId",
      LEAST((box[0])[0], (box[1])[0])::float8    AS minx,
      LEAST((box[0])[1], (box[1])[1])::float8    AS miny,
      GREATEST((box[0])[0], (box[1])[0])::float8 AS maxx,
      GREATEST((box[0])[1], (box[1])[1])::float8 AS maxy
    FROM "GeometryBox"
    WHERE "geometryId" IN (${Prisma.join(geometryIds)})`);
  const m = new Map<string, Bbox[]>();
  for (const r of rows) {
    const list = m.get(r.geometryId) ?? [];
    list.push([r.minx, r.miny, r.maxx, r.maxy]);
    m.set(r.geometryId, list);
  }
  return m;
}

/** Replace a geometry's canonical boxes (idempotent — safe on re-finalize). */
export async function setBboxes(
  prisma: PrismaClient,
  geometryId: string,
  boxes: Bbox[]
): Promise<void> {
  await prisma.geometryBox.deleteMany({ where: { geometryId } });
  for (const b of boxes) {
    await prisma.$executeRaw`
      INSERT INTO "GeometryBox" (id, "geometryId", box)
      VALUES (gen_random_uuid()::text, ${geometryId}, box(point(${b[0]}, ${b[1]}), point(${b[2]}, ${b[3]})))`;
  }
}
