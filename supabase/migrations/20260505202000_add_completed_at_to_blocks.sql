ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

UPDATE public.blocks
SET completed_at = COALESCE(completed_at, created_at)
WHERE completed = true AND completed_at IS NULL;
