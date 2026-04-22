-- streaks
create table public.streaks (
  user_id uuid primary key references auth.users on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_planned_date date,
  freezes_remaining int not null default 1,
  freeze_resets_at date not null default (current_date + 7),
  updated_at timestamptz not null default now()
);
alter table public.streaks enable row level security;
create policy "own streaks select" on public.streaks for select using (auth.uid() = user_id);
create policy "own streaks insert" on public.streaks for insert with check (auth.uid() = user_id);
create policy "own streaks update" on public.streaks for update using (auth.uid() = user_id);

create trigger streaks_updated_at before update on public.streaks
for each row execute function public.set_updated_at();

-- subscriptions
create table public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'free',
  plan text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "own subscription select" on public.subscriptions for select using (auth.uid() = user_id);
-- no insert/update policies for end users; service role bypasses RLS

create trigger subscriptions_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();

-- calendar_tokens
create table public.calendar_tokens (
  user_id uuid primary key references auth.users on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
create policy "own calendar_tokens select" on public.calendar_tokens for select using (auth.uid() = user_id);
create policy "own calendar_tokens insert" on public.calendar_tokens for insert with check (auth.uid() = user_id);
create policy "own calendar_tokens update" on public.calendar_tokens for update using (auth.uid() = user_id);
create policy "own calendar_tokens delete" on public.calendar_tokens for delete using (auth.uid() = user_id);

create trigger calendar_tokens_updated_at before update on public.calendar_tokens
for each row execute function public.set_updated_at();

-- profiles additions
alter table public.profiles
  add column if not exists timezone text not null default 'UTC',
  add column if not exists digest_opt_in boolean not null default true,
  add column if not exists install_prompted_at timestamptz;