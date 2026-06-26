-- A "failed" / not-done flag for checklist items (double-tap → red ✗).
-- Distinct from `done`: an item is open (neither), done (green check), or failed
-- (red cross). Defaults to false so every existing row stays "open" and all
-- current queries keep working. The client writes it best-effort, so shipping
-- the code before this migration is applied simply leaves the red ✗ as a local-
-- only state until the column exists — nothing breaks.

alter table public.checklist_items
  add column if not exists failed boolean not null default false;
