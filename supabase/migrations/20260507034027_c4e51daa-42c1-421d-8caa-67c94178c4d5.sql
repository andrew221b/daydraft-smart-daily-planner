
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer,
  ADD COLUMN IF NOT EXISTS actual_minutes integer,
  ADD COLUMN IF NOT EXISTS block_type text;

-- Reset all user-generated data
DELETE FROM public.time_entries;
DELETE FROM public.blocks;
DELETE FROM public.plans;
DELETE FROM public.quick_captures;
DELETE FROM public.block_templates;
DELETE FROM public.user_patterns;
DELETE FROM public.streaks;
DELETE FROM public.push_subscriptions;
DELETE FROM public.calendar_tokens;

UPDATE public.profiles SET onboarded = false, tour_seen = '{}'::jsonb;
