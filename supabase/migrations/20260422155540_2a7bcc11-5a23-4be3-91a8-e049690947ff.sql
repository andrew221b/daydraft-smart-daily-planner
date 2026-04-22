
ALTER TABLE public.blocks
  ADD COLUMN IF NOT EXISTS ai_reasoning text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS location_lat numeric,
  ADD COLUMN IF NOT EXISTS location_lng numeric,
  ADD COLUMN IF NOT EXISTS is_calendar_event boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS energy_zones jsonb,
  ADD COLUMN IF NOT EXISTS morning_nudge_local_time text NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS evening_nudge_local_time text NOT NULL DEFAULT '21:00';

CREATE TABLE IF NOT EXISTS public.quick_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quick_captures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own quick_captures select" ON public.quick_captures FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own quick_captures insert" ON public.quick_captures FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own quick_captures update" ON public.quick_captures FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own quick_captures delete" ON public.quick_captures FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own push select" ON public.push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own push insert" ON public.push_subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own push delete" ON public.push_subscriptions FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.user_patterns (
  user_id uuid PRIMARY KEY,
  deep_work_overrun_pct numeric NOT NULL DEFAULT 0,
  completion_by_hour jsonb NOT NULL DEFAULT '{}'::jsonb,
  abandoned_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own patterns select" ON public.user_patterns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own patterns insert" ON public.user_patterns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own patterns update" ON public.user_patterns FOR UPDATE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.block_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  raw_input text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.block_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own templates select" ON public.block_templates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own templates insert" ON public.block_templates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own templates update" ON public.block_templates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own templates delete" ON public.block_templates FOR DELETE USING (auth.uid() = user_id);
