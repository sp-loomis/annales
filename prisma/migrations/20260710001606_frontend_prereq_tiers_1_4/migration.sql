/*
  Warnings:

  - You are about to drop the column `type` on the `Entry` table. All the data in the column will be lost.
  - You are about to drop the `Document` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `typeId` to the `Entry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order` to the `Geometry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order` to the `Image` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order` to the `Sketch` table without a default value. This is not possible if the table is not empty.

*/
-- Pre-release wipe: Entry.type strings and file-backed Documents cannot be
-- represented under the new EntryType FK / Section model, so dependent rows are
-- deleted rather than backfilled. Deleting entries cascades to all artifacts,
-- tags, date ranges and relations; SearchIndex has no FK, so clear it directly.
DELETE FROM "SearchIndex";
DELETE FROM "Entry";

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_entryId_fkey";

-- DropIndex
DROP INDEX "Entry_worldId_type_idx";

-- AlterTable
ALTER TABLE "Entry" DROP COLUMN "type",
ADD COLUMN     "typeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Geometry" ADD COLUMN     "order" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "order" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "RelationType" ADD COLUMN     "iconName" TEXT,
ADD COLUMN     "iconWeight" TEXT;

-- AlterTable
ALTER TABLE "Sketch" ADD COLUMN     "order" DOUBLE PRECISION NOT NULL;

-- DropTable
DROP TABLE "Document";

-- CreateTable
CREATE TABLE "EntryType" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "iconName" TEXT,
    "iconWeight" TEXT,

    CONSTRAINT "EntryType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "label" TEXT,
    "contentJson" JSONB,
    "order" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldTheme" (
    "worldId" TEXT NOT NULL,
    "fontFamily" TEXT,
    "accentColor" TEXT,
    "surfaceColor" TEXT,
    "darkMode" BOOLEAN NOT NULL DEFAULT true,
    "defaultIconWeight" TEXT NOT NULL DEFAULT 'duotone',

    CONSTRAINT "WorldTheme_pkey" PRIMARY KEY ("worldId")
);

-- CreateTable
CREATE TABLE "WorkspaceState" (
    "worldId" TEXT NOT NULL,
    "openEntryIds" TEXT[],
    "sidebarState" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceState_pkey" PRIMARY KEY ("worldId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntryType_worldId_slug_key" ON "EntryType"("worldId", "slug");

-- CreateIndex
CREATE INDEX "Entry_worldId_typeId_idx" ON "Entry"("worldId", "typeId");

-- AddForeignKey
ALTER TABLE "EntryType" ADD CONSTRAINT "EntryType_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "EntryType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldTheme" ADD CONSTRAINT "WorldTheme_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceState" ADD CONSTRAINT "WorkspaceState_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;
