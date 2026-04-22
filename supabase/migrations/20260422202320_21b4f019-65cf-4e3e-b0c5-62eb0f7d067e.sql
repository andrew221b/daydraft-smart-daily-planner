ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS tour_seen jsonb NOT NULL DEFAULT '{}'::jsonb;