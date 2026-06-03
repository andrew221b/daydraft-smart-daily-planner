-- Checklist mode — an untimed, parallel list that lives alongside the
-- timeline plan but is completely independent of it (blocks/plans).
--
-- Two tables:
--   checklist_groups — optional "accordion" categories (e.g. "Магазин").
--   checklist_items  — the checkboxes themselves. group_id is NULLABLE:
--                      NULL means the item is ungrouped (the flat section).
--
-- Everything is date-scoped (plan_date, 'YYYY-MM-DD') just like plans.date,
-- so navigating days in DayView shows that day's checklist. There is no
-- carry-forward; the user relocates leftover items via "Move to date".
--
-- Items never become "missed" and carry no time/tracking — that logic lives
-- only on `blocks` and never touches these tables.

CREATE TABLE IF NOT EXISTS public.checklist_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  title text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  -- NULL = ungrouped (flat section). Deleting a group cascades its items.
  group_id uuid REFERENCES public.checklist_groups(id) ON DELETE CASCADE,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_groups_user_date_idx
  ON public.checklist_groups (user_id, plan_date);
CREATE INDEX IF NOT EXISTS checklist_items_user_date_idx
  ON public.checklist_items (user_id, plan_date);
CREATE INDEX IF NOT EXISTS checklist_items_group_idx
  ON public.checklist_items (group_id) WHERE group_id IS NOT NULL;

ALTER TABLE public.checklist_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

-- Standard per-user access (same pattern as blocks/time_categories).
CREATE POLICY "own checklist_groups select" ON public.checklist_groups
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own checklist_groups insert" ON public.checklist_groups
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own checklist_groups update" ON public.checklist_groups
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own checklist_groups delete" ON public.checklist_groups
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "own checklist_items select" ON public.checklist_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own checklist_items insert" ON public.checklist_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own checklist_items update" ON public.checklist_items
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own checklist_items delete" ON public.checklist_items
  FOR DELETE USING (auth.uid() = user_id);

-- Touch updated_at on any row write.
CREATE OR REPLACE FUNCTION public.touch_checklist_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklist_groups_touch_updated_at ON public.checklist_groups;
CREATE TRIGGER checklist_groups_touch_updated_at
  BEFORE UPDATE ON public.checklist_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_checklist_updated_at();

DROP TRIGGER IF EXISTS checklist_items_touch_updated_at ON public.checklist_items;
CREATE TRIGGER checklist_items_touch_updated_at
  BEFORE UPDATE ON public.checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_checklist_updated_at();
