-- Native push tokens (APNs + FCM).
--
-- Separate from `push_subscriptions` because that table holds Web Push
-- VAPID subscriptions (endpoint + p256dh + auth) which are useless for
-- native devices, and conversely native tokens are a single string the
-- web push spec has no shape for.
--
-- Each (user_id, token) is unique so a user can have multiple devices
-- (iPhone + iPad + Android tablet) and a fresh install reuses the row.
-- The token rotates whenever the OS decides — we upsert on each app
-- launch via the JS client so the latest token is always current.

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  token text NOT NULL,
  -- Capacitor's Device.getId() — stable across reinstalls on a given
  -- device. We use it to retire stale tokens when the OS hands out a
  -- new one on the same device.
  device_id text,
  device_model text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON public.push_tokens (user_id) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS push_tokens_device_idx ON public.push_tokens (user_id, device_id) WHERE device_id IS NOT NULL;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- A user can see and manage their own tokens; the service role
-- (which the send-push Edge Function uses) bypasses RLS so it can read
-- across users.
CREATE POLICY "own push_tokens select" ON public.push_tokens
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own push_tokens insert" ON public.push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own push_tokens update" ON public.push_tokens
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own push_tokens delete" ON public.push_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Touch updated_at on any row write so tokens that haven't been heard
-- from in a while can be aged out by a future janitor.
CREATE OR REPLACE FUNCTION public.touch_push_tokens_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_tokens_touch_updated_at ON public.push_tokens;
CREATE TRIGGER push_tokens_touch_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_push_tokens_updated_at();
