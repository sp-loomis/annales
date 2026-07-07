import type { PrismaClient } from '@prisma/client';

export type SourceType = 'document' | 'geometry' | 'sketch' | 'image';

// tsv is an Unsupported column, so all SearchIndex writes go through raw SQL.

export async function reindexArtifact(
  prisma: PrismaClient,
  entryId: string,
  sourceType: SourceType,
  sourceId: string,
  texts: (string | null | undefined)[]
): Promise<void> {
  const text = texts.filter((t): t is string => !!t && t.trim().length > 0).join('\n');
  await prisma.$executeRaw`
    DELETE FROM "SearchIndex" WHERE "sourceType" = ${sourceType} AND "sourceId" = ${sourceId}`;
  if (!text) return;
  await prisma.$executeRaw`
    INSERT INTO "SearchIndex" (id, "entryId", "sourceType", "sourceId", text, tsv)
    VALUES (gen_random_uuid(), ${entryId}, ${sourceType}, ${sourceId}, ${text},
            to_tsvector('english', ${text}))`;
}

export async function dropArtifactIndex(prisma: PrismaClient, sourceId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "SearchIndex" WHERE "sourceId" = ${sourceId}`;
}

export async function dropEntryIndex(prisma: PrismaClient, entryId: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "SearchIndex" WHERE "entryId" = ${entryId}`;
}

export async function dropWorldIndex(prisma: PrismaClient, worldId: string): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "SearchIndex"
    WHERE "entryId" IN (SELECT id FROM "Entry" WHERE "worldId" = ${worldId})`;
}
