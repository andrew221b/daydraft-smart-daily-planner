-- Opt-out flag for AI behavioural personalization / learning.
--
-- Default true so existing users keep the current (personalized) experience.
-- When a user turns this off in Settings, generate-plan ignores ALL learned
-- behavioural signals for them — plan-vs-actual overshoot, chronic
-- procrastination, completion-by-hour patterns and weekly AI memory — and
-- builds plans purely from the tasks + explicit settings they typed. Their
-- explicit "About you" context and planning rules are unaffected (those are
-- things they wrote on purpose, not things we inferred).
--
-- NOT NULL DEFAULT true keeps every existing row and all current queries valid.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_personalization_enabled boolean NOT NULL DEFAULT true;
