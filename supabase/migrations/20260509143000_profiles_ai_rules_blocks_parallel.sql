-- User-authored planning hints for prompts (timezone / block length / blackout windows).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ai_planning_rules TEXT;

COMMENT ON COLUMN profiles.ai_planning_rules IS 'Free-form user rules echoed into AI planning prompts';

-- Concurrent / background-safe obligations (walk + phone call, etc.)
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS overlap_ok BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS parallel_group_id TEXT;

COMMENT ON COLUMN blocks.overlap_ok IS 'When true, this block may intentionally overlap neighboring work in time';
COMMENT ON COLUMN blocks.parallel_group_id IS 'Optional grouping id for simultaneous blocks from AI';
