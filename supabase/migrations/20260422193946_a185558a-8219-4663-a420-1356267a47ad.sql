-- Categories
CREATE TABLE public.time_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.time_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own categories select" ON public.time_categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own categories insert" ON public.time_categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own categories update" ON public.time_categories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own categories delete" ON public.time_categories FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_time_categories_user ON public.time_categories(user_id);

-- Entries
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id uuid REFERENCES public.time_categories(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  note text,
  source text NOT NULL DEFAULT 'manual',
  block_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own entries select" ON public.time_entries FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own entries insert" ON public.time_entries FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own entries update" ON public.time_entries FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own entries delete" ON public.time_entries FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_time_entries_user_started ON public.time_entries(user_id, started_at DESC);
CREATE INDEX idx_time_entries_user_running ON public.time_entries(user_id) WHERE ended_at IS NULL;

-- Auto-create default Work category for new profiles
CREATE OR REPLACE FUNCTION public.create_default_time_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.time_categories (user_id, name, color, is_default)
  VALUES (NEW.id, 'Work', '#6366f1', true);
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_create_default_time_category
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.create_default_time_category();

-- Backfill for existing profiles
INSERT INTO public.time_categories (user_id, name, color, is_default)
SELECT p.id, 'Work', '#6366f1', true
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.time_categories tc WHERE tc.user_id = p.id);