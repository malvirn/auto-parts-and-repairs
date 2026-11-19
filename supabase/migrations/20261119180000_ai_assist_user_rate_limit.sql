create table if not exists public.ai_assist_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ai_assist_rate_limits enable row level security;
revoke all privileges on table public.ai_assist_rate_limits from public, anon, authenticated;

create or replace function public.consume_ai_assist_quota()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  current_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  insert into public.ai_assist_rate_limits(user_id, window_started_at, request_count, updated_at)
  values (current_user_id, now(), 1, now())
  on conflict (user_id) do update
  set request_count = case
        when public.ai_assist_rate_limits.window_started_at < now() - interval '5 minutes' then 1
        else public.ai_assist_rate_limits.request_count + 1
      end,
      window_started_at = case
        when public.ai_assist_rate_limits.window_started_at < now() - interval '5 minutes' then now()
        else public.ai_assist_rate_limits.window_started_at
      end,
      updated_at = now()
  returning request_count into current_count;

  if current_count > 12 then
    raise exception 'AI request limit exceeded. Try again in a few minutes.' using errcode = 'P0001';
  end if;

  return current_count;
end;
$$;

revoke all on function public.consume_ai_assist_quota() from public, anon;
grant execute on function public.consume_ai_assist_quota() to authenticated;