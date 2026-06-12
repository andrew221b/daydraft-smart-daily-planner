-- Pin checklist categories / loose (ungrouped) items so they persist across
-- days instead of being strictly date-scoped. A pinned row is shown on every
-- day until unpinned; unpinning re-homes it onto the day it was unpinned.
--
-- The client fetches pinned rows with a separate, additive query (any date),
-- so this column is forward-safe: the app keeps working if the code ships
-- slightly before this migration is applied — pinned simply stays inert.

ALTER TABLE public.checklist_groups
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- Partial indexes: the "pinned across all days" lookup only ever scans the
-- handful of pinned rows per user, never the full date-scoped table.
CREATE INDEX IF NOT EXISTS checklist_groups_pinned_idx
  ON public.checklist_groups (user_id) WHERE pinned;

CREATE INDEX IF NOT EXISTS checklist_items_pinned_idx
  ON public.checklist_items (user_id) WHERE pinned;
