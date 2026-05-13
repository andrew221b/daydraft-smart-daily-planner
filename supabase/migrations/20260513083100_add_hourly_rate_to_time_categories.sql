ALTER TABLE public.time_categories
ADD COLUMN IF NOT EXISTS hourly_rate numeric(12, 2);

ALTER TABLE public.time_categories
DROP CONSTRAINT IF EXISTS time_categories_hourly_rate_nonnegative;

ALTER TABLE public.time_categories
ADD CONSTRAINT time_categories_hourly_rate_nonnegative
CHECK (hourly_rate IS NULL OR hourly_rate >= 0);
