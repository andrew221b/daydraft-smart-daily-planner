
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  energy_preference TEXT NOT NULL DEFAULT 'morning' CHECK (energy_preference IN ('morning','midday','night')),
  notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  onboarded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Plans
CREATE TABLE public.plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  raw_input TEXT NOT NULL,
  ai_summary TEXT,
  ai_subtext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own plans select" ON public.plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own plans insert" ON public.plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own plans update" ON public.plans FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own plans delete" ON public.plans FOR DELETE USING (auth.uid() = user_id);

-- Blocks
CREATE TABLE public.blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL, -- 'HH:MM'
  duration_min INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deep_work','communication','routine')),
  kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','break','lunch')),
  completed BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own blocks select" ON public.blocks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own blocks insert" ON public.blocks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own blocks update" ON public.blocks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own blocks delete" ON public.blocks FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_plans_user_date ON public.plans(user_id, date DESC);
CREATE INDEX idx_blocks_plan ON public.blocks(plan_id, position);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
