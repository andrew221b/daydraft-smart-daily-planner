-- Per-category daily tracking cap + optional browser notification when reached.
ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS daily_cap_minutes integer;

ALTER TABLE public.time_categories
  ADD COLUMN IF NOT EXISTS cap_notify_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.time_categories
  DROP CONSTRAINT IF EXISTS time_categories_daily_cap_minutes_range;

ALTER TABLE public.time_categories
  ADD CONSTRAINT time_categories_daily_cap_minutes_range
  CHECK (daily_cap_minutes IS NULL OR (daily_cap_minutes >= 1 AND daily_cap_minutes <= 1440));

COMMENT ON COLUMN public.time_categories.daily_cap_minutes IS 'Max tracked minutes for this category in the local calendar day; NULL = no cap.';
COMMENT ON COLUMN public.time_categories.cap_notify_enabled IS 'When true, client may toast/notify once the day total reaches daily_cap_minutes.';
