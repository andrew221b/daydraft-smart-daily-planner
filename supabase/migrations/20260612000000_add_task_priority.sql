-- Single "priority" flag (important / not) for timeline tasks and checklist items.
-- No levels — a plain boolean. Surfaced as an amber highlight + flag across the
-- timeline, the checklist, and the calendar day markers. Defaults to false so
-- every existing row stays non-priority and all current queries keep working.

alter table public.blocks
  add column if not exists priority boolean not null default false;

alter table public.checklist_items
  add column if not exists priority boolean not null default false;
