-- NOTE: the original TRUNCATE of all user tables + `DELETE FROM auth.users` was
-- removed 2026-06-19 (release-readiness audit). It was a data-loss footgun on any
-- fresh/restored environment via `supabase db push`. Already applied on prod, so
-- stripping it has no effect there. The RLS policy (re)creation below is the only
-- part worth keeping — it must still run on a fresh DB, so it stays.

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