-- Soft-delete for time_categories.
-- Instead of hard-deleting a category (which orphans time_entries and loses
-- the display name), we stamp deleted_at and keep the row. The app filters
-- deleted rows out of the picker but can still resolve names for history.
ALTER TABLE time_categories ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Index so the "active only" query stays fast as the table grows.
CREATE INDEX IF NOT EXISTS time_categories_deleted_at_idx
  ON time_categories (user_id, deleted_at)
  WHERE deleted_at IS NULL;
