begin;

insert into public.accounts (code, name, type, normal_balance, is_active)
values ('1150', 'Staff Cash Advances', 'asset', 'debit', true)
on conflict (code) do update
set name = excluded.name,
    type = excluded.type,
    normal_balance = excluded.normal_balance,
    is_active = true;

create table if not exists public.staff_cash_advances (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null check (length(btrim(staff_name)) between 1 and 120),
  amount numeric(12, 2) not null check (amount > 0),
  advance_date date not null,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_cash_advance_repayments (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.staff_cash_advances(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  repayment_date date not null,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists staff_cash_advances_date_idx
  on public.staff_cash_advances(advance_date desc);
create index if not exists staff_cash_advance_repayments_advance_idx
  on public.staff_cash_advance_repayments(advance_id, repayment_date desc);

alter table public.staff_cash_advances enable row level security;
alter table public.staff_cash_advance_repayments enable row level security;
revoke all on public.staff_cash_advances, public.staff_cash_advance_repayments from public, anon, authenticated;
grant select on public.staff_cash_advances, public.staff_cash_advance_repayments to authenticated;

drop policy if exists "Accounting users can view staff cash advances" on public.staff_cash_advances;
create policy "Accounting users can view staff cash advances"
  on public.staff_cash_advances for select
  to authenticated
  using (public.current_access_level() >= 2);

drop policy if exists "Accounting users can view staff cash advance repayments" on public.staff_cash_advance_repayments;
create policy "Accounting users can view staff cash advance repayments"
  on public.staff_cash_advance_repayments for select
  to authenticated
  using (public.current_access_level() >= 2);

create or replace function public.issue_staff_cash_advance(
  p_staff_name text,
  p_amount numeric,
  p_advance_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cash_account_id uuid;
  advances_account_id uuid;
  entry_id uuid;
  advance_id uuid;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can issue staff cash advances';
  end if;
  if p_staff_name is null or length(btrim(p_staff_name)) not between 1 and 120 then
    raise exception 'Enter a staff member name';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Advance amount must be greater than zero';
  end if;
  if p_advance_date is null then
    raise exception 'Advance date is required';
  end if;

  select id into cash_account_id from public.accounts where code = '1000' and is_active = true;
  if cash_account_id is null then
    raise exception 'Cash on Hand account (1000) is missing or inactive';
  end if;
  select id into advances_account_id from public.accounts where code = '1150' and is_active = true;
  if advances_account_id is null then
    raise exception 'Staff Cash Advances account (1150) is missing or inactive';
  end if;

  insert into public.journal_entries (entry_date, description, source_type)
  values (p_advance_date, 'Staff cash advance — ' || btrim(p_staff_name), 'staff_cash_advance')
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values
    (entry_id, advances_account_id, p_amount, 0),
    (entry_id, cash_account_id, 0, p_amount);

  insert into public.staff_cash_advances (staff_name, amount, advance_date, journal_entry_id, created_by)
  values (btrim(p_staff_name), round(p_amount, 2), p_advance_date, entry_id, auth.uid())
  returning id into advance_id;
  return advance_id;
end;
$$;

create or replace function public.repay_staff_cash_advance(
  p_advance_id uuid,
  p_amount numeric,
  p_repayment_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  advance_row public.staff_cash_advances%rowtype;
  cash_account_id uuid;
  advances_account_id uuid;
  entry_id uuid;
  repayment_id uuid;
  total_repaid numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can record staff cash advance repayments';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Repayment amount must be greater than zero';
  end if;
  if p_repayment_date is null then
    raise exception 'Repayment date is required';
  end if;

  select * into advance_row
  from public.staff_cash_advances
  where id = p_advance_id
  for update;
  if not found then
    raise exception 'Staff cash advance not found';
  end if;

  select coalesce(sum(amount), 0) into total_repaid
  from public.staff_cash_advance_repayments
  where advance_id = p_advance_id;
  if round(p_amount, 2) > advance_row.amount - total_repaid + 0.005 then
    raise exception 'Repayment exceeds the outstanding balance of %', greatest(0, advance_row.amount - total_repaid);
  end if;

  select id into cash_account_id from public.accounts where code = '1000' and is_active = true;
  if cash_account_id is null then
    raise exception 'Cash on Hand account (1000) is missing or inactive';
  end if;
  select id into advances_account_id from public.accounts where code = '1150' and is_active = true;
  if advances_account_id is null then
    raise exception 'Staff Cash Advances account (1150) is missing or inactive';
  end if;

  insert into public.journal_entries (entry_date, description, source_type)
  values (p_repayment_date, 'Staff cash advance repayment — ' || advance_row.staff_name, 'staff_cash_advance_repayment')
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values
    (entry_id, cash_account_id, p_amount, 0),
    (entry_id, advances_account_id, 0, p_amount);

  insert into public.staff_cash_advance_repayments (advance_id, amount, repayment_date, journal_entry_id, created_by)
  values (p_advance_id, round(p_amount, 2), p_repayment_date, entry_id, auth.uid())
  returning id into repayment_id;
  return repayment_id;
end;
$$;

revoke all on function public.issue_staff_cash_advance(text, numeric, date) from public, anon;
revoke all on function public.repay_staff_cash_advance(uuid, numeric, date) from public, anon;
grant execute on function public.issue_staff_cash_advance(text, numeric, date) to authenticated;
grant execute on function public.repay_staff_cash_advance(uuid, numeric, date) to authenticated;

create table if not exists public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  opening_cash numeric(12, 2) not null,
  cash_received numeric(12, 2) not null,
  cash_paid numeric(12, 2) not null,
  expected_cash numeric(12, 2) not null,
  counted_cash numeric(12, 2) not null check (counted_cash >= 0),
  variance numeric(12, 2) not null,
  notes text,
  reconciled_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (round(opening_cash + cash_received - cash_paid, 2) = expected_cash),
  check (round(counted_cash - expected_cash, 2) = variance)
);

create index if not exists cash_reconciliations_business_date_idx
  on public.cash_reconciliations(business_date desc, created_at desc);

alter table public.cash_reconciliations enable row level security;
revoke all on public.cash_reconciliations from public, anon, authenticated;
grant select on public.cash_reconciliations to authenticated;

drop policy if exists "Accounting users can view cash reconciliations" on public.cash_reconciliations;
create policy "Accounting users can view cash reconciliations"
  on public.cash_reconciliations for select
  to authenticated
  using (public.current_access_level() >= 2);

create or replace function public.save_cash_reconciliation(
  p_business_date date,
  p_opening_cash numeric,
  p_cash_received numeric,
  p_cash_paid numeric,
  p_expected_cash numeric,
  p_counted_cash numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reconciliation_id uuid;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can save cash reconciliations';
  end if;
  if p_business_date is null then
    raise exception 'Choose a business date';
  end if;
  if p_opening_cash is null or p_cash_received is null or p_cash_paid is null or p_expected_cash is null or p_counted_cash is null then
    raise exception 'Reconciliation amounts are required';
  end if;
  if p_cash_received < 0 or p_cash_paid < 0 or p_counted_cash < 0 then
    raise exception 'Received, paid and counted amounts cannot be negative';
  end if;
  if round(p_opening_cash + p_cash_received - p_cash_paid, 2) <> round(p_expected_cash, 2) then
    raise exception 'Expected cash does not match opening cash plus received less paid';
  end if;

  insert into public.cash_reconciliations (
    business_date, opening_cash, cash_received, cash_paid, expected_cash,
    counted_cash, variance, notes, reconciled_by
  )
  values (
    p_business_date, round(p_opening_cash, 2), round(p_cash_received, 2),
    round(p_cash_paid, 2), round(p_expected_cash, 2), round(p_counted_cash, 2),
    round(p_counted_cash - p_expected_cash, 2), nullif(btrim(p_notes), ''), auth.uid()
  )
  returning id into reconciliation_id;
  return reconciliation_id;
end;
$$;

revoke all on function public.save_cash_reconciliation(date, numeric, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.save_cash_reconciliation(date, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

commit;
