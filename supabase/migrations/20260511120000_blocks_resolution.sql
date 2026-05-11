-- Terminal outcome for plan blocks (done / user-skipped / auto-missed).
-- NULL resolution = still "open" for user tasks; completed=true legacy rows get backfilled.

ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_resolution_check;
ALTER TABLE public.blocks ADD CONSTRAINT blocks_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('done', 'skipped', 'missed'));

COMMENT ON COLUMN public.blocks.resolution IS 'done | skipped | missed — NULL means not yet resolved';
COMMENT ON COLUMN public.blocks.resolved_at IS 'When the block reached its terminal state (wall clock)';

UPDATE public.blocks
SET
  resolution = 'done',
  resolved_at = COALESCE(completed_at, created_at)
WHERE completed = true
  AND resolution IS NULL;

CREATE INDEX IF NOT EXISTS idx_blocks_plan_resolution ON public.blocks (plan_id)
  WHERE resolution IS NULL AND kind = 'task' AND (is_calendar_event IS NOT TRUE);
