begin;

create table if not exists public.payable_payment_reversals (
  id uuid primary key default gen_random_uuid(),
  payable_payment_id uuid not null unique references public.payable_payments(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  reversal_date date not null default current_date,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.payable_payment_reversals enable row level security;
revoke all on table public.payable_payment_reversals from anon, authenticated;
grant select on table public.payable_payment_reversals to authenticated;

drop policy if exists "Accounting can view payable payment reversals" on public.payable_payment_reversals;
create policy "Accounting can view payable payment reversals"
  on public.payable_payment_reversals for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (profiles.role in ('super_admin', 'accounting') or coalesce(profiles.access_level, 0) >= 2)
    )
  );

create or replace function public.reverse_payable_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment_row public.payable_payments%rowtype;
  payable_row public.payables%rowtype;
  original_entry public.journal_entries%rowtype;
  reversal_entry_id uuid;
  already_reversed boolean;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (profiles.role in ('super_admin', 'accounting') or coalesce(profiles.access_level, 0) >= 2)
  ) then
    raise exception 'Only accounting users and super admins can reverse payable payments';
  end if;

  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required to reverse a payable payment';
  end if;

  select * into payment_row
  from public.payable_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payable payment not found';
  end if;

  select exists (
    select 1 from public.payable_payment_reversals
    where payable_payment_id = payment_row.id
  ) into already_reversed;

  if already_reversed then
    raise exception 'This payable payment has already been reversed';
  end if;

  select * into payable_row
  from public.payables
  where id = payment_row.payable_id
  for update;

  if not found then
    raise exception 'The bill for this payment no longer exists';
  end if;

  if payment_row.journal_entry_id is null then
    raise exception 'This payment has no ledger entry to reverse';
  end if;

  select * into original_entry
  from public.journal_entries
  where id = payment_row.journal_entry_id;

  if not found then
    raise exception 'The ledger entry for this payment no longer exists';
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    current_date,
    original_entry.reference,
    'Reversal of payable payment ' || payment_row.id::text || ': ' || btrim(p_reason),
    'payable_payment_reversal'
  )
  returning id into reversal_entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  select reversal_entry_id, account_id, credit, debit
  from public.journal_lines
  where journal_entry_id = original_entry.id;

  if not found then
    raise exception 'The original ledger entry has no lines to reverse';
  end if;

  insert into public.payable_payment_reversals (
    payable_payment_id, journal_entry_id, reversal_date, reason, created_by
  )
  values (payment_row.id, reversal_entry_id, current_date, btrim(p_reason), auth.uid());

  update public.payables
  set amount_paid = greatest(0, coalesce(amount_paid, 0) - payment_row.amount),
      status = case
        when greatest(0, coalesce(amount_paid, 0) - payment_row.amount) <= 0.01 then 'unpaid'
        when greatest(0, coalesce(amount_paid, 0) - payment_row.amount) >= amount - 0.01 then 'paid'
        else 'partially_paid'
      end
  where id = payable_row.id;

  return reversal_entry_id;
end;
$$;

revoke all on function public.reverse_payable_payment(uuid, text) from public;
grant execute on function public.reverse_payable_payment(uuid, text) to authenticated;

commit;
