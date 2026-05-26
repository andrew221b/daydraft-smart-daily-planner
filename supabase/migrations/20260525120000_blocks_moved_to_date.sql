-- Add moved_to_date to track which date a block was moved to.
-- Nullable: existing rows keep NULL and display as "Skipped" (backward compat).
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS moved_to_date text;
