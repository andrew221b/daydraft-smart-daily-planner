-- Burst-rate guard for the AI chat/Coach endpoint (ai-assist). Deliberately a
-- short rolling window, not a daily cap, so it never contradicts the
-- "Unlimited prompts / No daily caps" Pro-tier promise in AskAiSheet.tsx —
-- it only stops scripted/bot-speed bursts, which no real human chat session
-- produces.
create table if not exists public.ai_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  request_count int not null default 0
);

alter table public.ai_rate_limits enable row level security;
-- No policies: only ever touched through the security-definer function
-- below, which runs as the table owner and scopes itself to auth.uid().

create or replace function public.check_ai_rate_limit(p_max_requests int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;

  insert into public.ai_rate_limits (user_id, window_start, request_count)
  values (v_uid, v_now, 1)
  on conflict (user_id) do update
    set request_count = case
          when ai_rate_limits.window_start < v_now - (p_window_seconds || ' seconds')::interval
            then 1
          else ai_rate_limits.request_count + 1
        end,
        window_start = case
          when ai_rate_limits.window_start < v_now - (p_window_seconds || ' seconds')::interval
            then v_now
          else ai_rate_limits.window_start
        end
  returning request_count into v_count;

  return v_count <= p_max_requests;
end;
$$;

grant execute on function public.check_ai_rate_limit(int, int) to authenticated;
