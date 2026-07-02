-- Server-side memory of shown Insights (yesterday-debrief).
-- Enables three things at once:
--   1. "Never repeat" — each generation gets the user's recent insight
--      fingerprints fed back as a ban-list (the banana-DNA / birthday-paradox
--      class of AI-favourite clichés kept resurfacing because the model has
--      no memory of what it generated on previous days).
--   2. One canonical insight per user per day — all devices show the SAME
--      riddle/quiz instead of independently generating different ones.
--   3. Fewer AI calls — repeat fetches within a day serve the stored payload.
create table if not exists public.insight_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  mode text not null,
  payload jsonb not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.insight_history enable row level security;

-- The edge function runs with the caller's JWT (anon key + Authorization
-- header), so owner-scoped policies are exactly what it needs.
create policy "insight_history_select_own" on public.insight_history
  for select using (auth.uid() = user_id);
create policy "insight_history_insert_own" on public.insight_history
  for insert with check (auth.uid() = user_id);
create policy "insight_history_update_own" on public.insight_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "insight_history_delete_own" on public.insight_history
  for delete using (auth.uid() = user_id);
