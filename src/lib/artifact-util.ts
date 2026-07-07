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

export type Bbox = [number, number, number, number];

/** bbox is an Unsupported (native box) column — read via raw SQL, corner-order agnostic. */
export async function getBboxes(
  prisma: PrismaClient,
  geometryIds: string[]
): Promise<Map<string, Bbox>> {
  if (geometryIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    { id: string; minx: number; miny: number; maxx: number; maxy: number }[]
  >(Prisma.sql`
    SELECT id,
      LEAST((bbox[0])[0], (bbox[1])[0])::float8    AS minx,
      LEAST((bbox[0])[1], (bbox[1])[1])::float8    AS miny,
      GREATEST((bbox[0])[0], (bbox[1])[0])::float8 AS maxx,
      GREATEST((bbox[0])[1], (bbox[1])[1])::float8 AS maxy
    FROM "Geometry"
    WHERE id IN (${Prisma.join(geometryIds)}) AND bbox IS NOT NULL`);
  return new Map(rows.map((r) => [r.id, [r.minx, r.miny, r.maxx, r.maxy] as Bbox]));
}

export async function setBbox(prisma: PrismaClient, geometryId: string, bbox: Bbox): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Geometry"
    SET bbox = box(point(${bbox[0]}, ${bbox[1]}), point(${bbox[2]}, ${bbox[3]}))
    WHERE id = ${geometryId}`;
}
