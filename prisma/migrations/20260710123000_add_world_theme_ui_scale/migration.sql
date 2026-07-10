-- Add persisted world UI scale for accessibility controls in ThemePanel.
ALTER TABLE "WorldTheme"
ADD COLUMN "uiScale" TEXT NOT NULL DEFAULT 'small';
