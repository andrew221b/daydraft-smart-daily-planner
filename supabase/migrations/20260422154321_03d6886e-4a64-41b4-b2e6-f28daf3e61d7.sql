alter table public.profiles
  add column if not exists theme text not null default 'system',
  add column if not exists passkey_enabled boolean not null default false;