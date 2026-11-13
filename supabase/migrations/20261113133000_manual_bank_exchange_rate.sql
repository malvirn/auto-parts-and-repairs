-- Centric manual USD/ZiG bank exchange rate and audit history.
alter table public.business_settings
  add column if not exists usd_to_zig_bank_rate numeric(20,6),
  add column if not exists exchange_rate_updated_at timestamptz,
  add column if not exists exchange_rate_updated_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_settings'::regclass
      and conname = 'business_settings_bank_rate_positive'
  ) then
    alter table public.business_settings
      add constraint business_settings_bank_rate_positive
      check (usd_to_zig_bank_rate is null or usd_to_zig_bank_rate > 0);
  end if;
end $$;

create table if not exists public.exchange_rate_history (
  id uuid primary key default gen_random_uuid(),
  usd_to_zig_rate numeric(20,6) not null check (usd_to_zig_rate > 0),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)
);

alter table public.exchange_rate_history enable row level security;
grant select, insert on public.exchange_rate_history to authenticated;

drop policy if exists exchange_rate_history_accounting_read on public.exchange_rate_history;
create policy exchange_rate_history_accounting_read
  on public.exchange_rate_history for select to authenticated
  using (is_accounting_or_above());

drop policy if exists exchange_rate_history_admin_insert on public.exchange_rate_history;
create policy exchange_rate_history_admin_insert
  on public.exchange_rate_history for insert to authenticated
  with check (is_admin());

create or replace function public.audit_manual_bank_rate_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.usd_to_zig_bank_rate is distinct from old.usd_to_zig_bank_rate
     and new.usd_to_zig_bank_rate is not null then
    insert into public.exchange_rate_history (usd_to_zig_rate, changed_at, changed_by)
    values (new.usd_to_zig_bank_rate, coalesce(new.exchange_rate_updated_at, now()), coalesce(new.exchange_rate_updated_by, auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists business_settings_bank_rate_audit on public.business_settings;
create trigger business_settings_bank_rate_audit
after update of usd_to_zig_bank_rate on public.business_settings
for each row execute function public.audit_manual_bank_rate_change();
