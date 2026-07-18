-- DropIndex
DROP INDEX "GeometryBox_box_gist";

-- DropIndex
DROP INDEX "SearchIndex_tsv_gin";

-- AlterTable
ALTER TABLE "DateRange" ADD COLUMN     "displayStyle" TEXT NOT NULL DEFAULT 'pretty',
ADD COLUMN     "label" TEXT;
