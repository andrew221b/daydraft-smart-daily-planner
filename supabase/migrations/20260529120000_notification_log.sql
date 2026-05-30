-- Notification dedup log.
--
-- The nudge crons (send-daily-nudges, notify-overrun) run on overlapping
-- windows and can fire more than once for the same user in a day. This table
-- is the single source of truth for "already sent": a row per
-- (user, kind, local_date) that the dispatcher inserts BEFORE sending. The
-- UNIQUE constraint makes a second attempt fail fast, so a user gets exactly
-- one morning brief / evening debrief / overrun alert per local day.
--
-- `local_date` is the user's local calendar date (computed in the function
-- from their timezone), not UTC — so the window lines up with how the user
-- experiences "today".

CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'morning' | 'evening' | 'overrun' (free-form so new nudge kinds don't
  -- need a migration).
  kind text NOT NULL,
  local_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, local_date)
);

CREATE INDEX IF NOT EXISTS notification_log_user_date_idx
  ON public.notification_log (user_id, local_date);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Writes come exclusively from Edge Functions using the service role (which
-- bypasses RLS). A user may read their own log for transparency / debugging;
-- they never write it.
CREATE POLICY "own notification_log select" ON public.notification_log
  FOR SELECT USING (auth.uid() = user_id);
