-- Replace the calendar system: schema-driven definitions (no type column),
-- integer ticks. Pre-release: existing calendar data is unrepresentable in the
-- new format, so dependent rows are wiped rather than migrated.

DELETE FROM "DateRange";
DELETE FROM "Calendar";

ALTER TABLE "Calendar" DROP COLUMN "type";

ALTER TABLE "DateRange"
  ALTER COLUMN "tickStart" TYPE BIGINT USING ROUND("tickStart")::bigint,
  ALTER COLUMN "tickEnd"   TYPE BIGINT USING ROUND("tickEnd")::bigint;
