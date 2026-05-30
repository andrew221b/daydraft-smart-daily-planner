-- Track when a rate was first assigned to a category.
-- Earnings calculations only count sessions that started on or after this
-- timestamp, so time tracked before a rate was set is not retroactively billed.
-- NULL means "apply to all time" (user chose to backfill or rate was always set).
alter table time_categories
  add column if not exists rate_set_at timestamptz default null;
