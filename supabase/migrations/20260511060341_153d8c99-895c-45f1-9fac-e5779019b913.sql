ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS overlap_ok BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parallel_group_id TEXT,
  ADD COLUMN IF NOT EXISTS slot_end_time TEXT;

UPDATE public.blocks
SET slot_end_time = LPAD(((((split_part(start_time, ':', 1))::int * 60
                            + (split_part(start_time, ':', 2))::int
                            + COALESCE(duration_min, 0)) / 60) % 24)::text, 2, '0')
                    || ':' ||
                    LPAD(((((split_part(start_time, ':', 1))::int * 60
                            + (split_part(start_time, ':', 2))::int
                            + COALESCE(duration_min, 0)) % 60))::text, 2, '0')
WHERE slot_end_time IS NULL
  AND start_time ~ '^[0-9]{1,2}:[0-9]{2}$';