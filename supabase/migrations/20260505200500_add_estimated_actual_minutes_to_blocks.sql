ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS actual_minutes INTEGER;

UPDATE public.blocks
SET estimated_minutes = duration_min
WHERE estimated_minutes IS NULL;

ALTER TABLE public.blocks
  ALTER COLUMN estimated_minutes SET NOT NULL;

ALTER TABLE public.blocks
  ALTER COLUMN estimated_minutes SET DEFAULT 0;

ALTER TABLE public.blocks
  ADD CONSTRAINT blocks_estimated_minutes_nonnegative CHECK (estimated_minutes >= 0);

ALTER TABLE public.blocks
  ADD CONSTRAINT blocks_actual_minutes_nonnegative CHECK (actual_minutes IS NULL OR actual_minutes >= 0);
