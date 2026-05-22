-- Extend `push_subscriptions` so a single row can represent either a
-- Web Push subscription (existing: endpoint + p256dh + auth) OR a native
-- APNs device token. The send-daily-nudges edge function dispatches based
-- on which side is populated.

ALTER TABLE public.push_subscriptions
  ALTER COLUMN endpoint DROP NOT NULL,
  ALTER COLUMN p256dh   DROP NOT NULL,
  ALTER COLUMN auth     DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS apns_token TEXT,
  ADD COLUMN IF NOT EXISTS platform   TEXT;

-- One APNs device token per user — uniqueness only applies when the
-- column is populated (Web Push rows leave apns_token NULL).
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_apns_idx
  ON public.push_subscriptions (user_id, apns_token)
  WHERE apns_token IS NOT NULL;

-- Sanity: every row must carry at least one usable channel. Web Push
-- rows have endpoint set; APNs rows have apns_token set. Mixed/empty
-- rows are rejected.
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_channel_present
  CHECK (endpoint IS NOT NULL OR apns_token IS NOT NULL);
