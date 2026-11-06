begin;

alter table public.payroll_payments
  add column if not exists overtime_hours numeric not null default 0,
  add column if not exists overtime_amount numeric not null default 0,
  add column if not exists bonus_amount numeric not null default 0;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        access_level >= 2
        or lower(replace(replace(trim(coalesce(role, '')), '-', '_'), ' ', '_')) in ('super_admin', 'superadmin')
      )
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

alter table public.payroll_runs enable row level security;
alter table public.payroll_payments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payroll_payments_adjustments_nonnegative'
      and conrelid = 'public.payroll_payments'::regclass
  ) then
    alter table public.payroll_payments
      add constraint payroll_payments_adjustments_nonnegative
      check (overtime_hours >= 0 and overtime_amount >= 0 and bonus_amount >= 0);
  end if;
end
$$;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('payroll_runs', 'payroll_payments')
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$$;

create policy "Payroll runs are visible to accounting and super admins"
  on public.payroll_runs for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
        and lower(replace(replace(trim(coalesce(role, '')), '-', '_'), ' ', '_')) = 'accounting'
    )
  );

create policy "Super admins manage payroll runs"
  on public.payroll_runs for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "Super admins manage payroll payment details"
  on public.payroll_payments for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

commit;
