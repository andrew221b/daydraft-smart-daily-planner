-- Wipe user data
TRUNCATE TABLE public.blocks, public.plans, public.time_entries, public.time_categories,
  public.block_templates, public.streaks, public.subscriptions, public.push_subscriptions,
  public.quick_captures, public.user_patterns, public.calendar_tokens, public.profiles
  RESTART IDENTITY CASCADE;

-- Remove all auth users so user can sign up fresh
DELETE FROM auth.users;

-- Re-create RLS policies on time_entries (defensive)
DROP POLICY IF EXISTS "own entries select" ON public.time_entries;
DROP POLICY IF EXISTS "own entries insert" ON public.time_entries;
DROP POLICY IF EXISTS "own entries update" ON public.time_entries;
DROP POLICY IF EXISTS "own entries delete" ON public.time_entries;

CREATE POLICY "own entries select" ON public.time_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own entries insert" ON public.time_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own entries update" ON public.time_entries
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own entries delete" ON public.time_entries
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Re-create RLS policies on time_categories
DROP POLICY IF EXISTS "own categories select" ON public.time_categories;
DROP POLICY IF EXISTS "own categories insert" ON public.time_categories;
DROP POLICY IF EXISTS "own categories update" ON public.time_categories;
DROP POLICY IF EXISTS "own categories delete" ON public.time_categories;

CREATE POLICY "own categories select" ON public.time_categories
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own categories insert" ON public.time_categories
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own categories update" ON public.time_categories
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own categories delete" ON public.time_categories
  FOR DELETE TO authenticated USING (auth.uid() = user_id);