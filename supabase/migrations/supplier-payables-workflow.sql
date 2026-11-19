begin;

alter table public.payables
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text,
  add column if not exists void_journal_entry_id uuid references public.journal_entries(id) on delete set null;

create or replace function public.create_supplier_payable(
  p_supplier_name text,
  p_debit_account_id uuid,
  p_amount numeric,
  p_bill_date date,
  p_due_date date,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  supplier_row public.suppliers%rowtype;
  debit_account public.accounts%rowtype;
  payable_account public.accounts%rowtype;
  bill_id uuid;
  entry_id uuid;
  bill_reference text;
  amount_value numeric(12, 2);
  supplier_label text;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (profiles.role in ('super_admin', 'accounting') or coalesce(profiles.access_level, 0) >= 2)
  ) then
    raise exception 'Only authorised accounting users can create supplier bills';
  end if;

  supplier_label := nullif(btrim(p_supplier_name), '');
  if supplier_label is null then
    raise exception 'Enter a supplier name';
  end if;
  if length(supplier_label) > 200 then
    raise exception 'Supplier name must be 200 characters or fewer';
  end if;
  if p_amount is null or p_amount <= 0 or p_bill_date is null or p_due_date is null then
    raise exception 'Enter a valid amount, bill date, and due date';
  end if;
  if p_due_date < p_bill_date then
    raise exception 'The due date cannot be before the bill date';
  end if;
  amount_value := round(p_amount, 2);
  if amount_value <= 0 then
    raise exception 'Bill amount must be at least one cent';
  end if;

  perform pg_advisory_xact_lock(hashtext('supplier_name:' || lower(supplier_label)));
  select * into supplier_row
  from public.suppliers
  where lower(btrim(name)) = lower(supplier_label)
  order by created_at
  limit 1
  for update;
  if not found then
    insert into public.suppliers(name) values (supplier_label)
    returning * into supplier_row;
  end if;

  select * into debit_account
  from public.accounts
  where id = p_debit_account_id and is_active = true
  for share;
  if not found then
    raise exception 'Choose an active expense or purchase account';
  end if;
  if debit_account.type not in ('asset', 'expense') then
    raise exception 'The bill account must be an asset or expense account';
  end if;

  select * into payable_account
  from public.accounts
  where code = '2000' and is_active = true
  for share;
  if not found then
    raise exception 'Accounts Payable (code 2000) is missing or inactive';
  end if;
  if debit_account.id = payable_account.id then
    raise exception 'Choose an expense or purchase account, not Accounts Payable';
  end if;

  perform pg_advisory_xact_lock(hashtext('supplier_payable_bill_number'));
  loop
    bill_reference := 'AP-' || to_char(p_bill_date, 'YYYYMMDD') || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    exit when not exists (
      select 1 from public.payables where bill_number = bill_reference
    );
  end loop;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    p_bill_date,
    bill_reference,
    'Bill from ' || supplier_row.name
      || case when nullif(btrim(p_description), '') is null then '' else ' — ' || btrim(p_description) end,
    'payable'
  )
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values
    (entry_id, debit_account.id, amount_value, 0),
    (entry_id, payable_account.id, 0, amount_value);

  insert into public.payables (
    supplier_id, bill_number, bill_date, due_date, amount, amount_paid,
    status, description, journal_entry_id
  )
  values (
    supplier_row.id, bill_reference, p_bill_date, p_due_date, amount_value, 0,
    'unpaid', nullif(btrim(p_description), ''), entry_id
  )
  returning id into bill_id;

  return jsonb_build_object(
    'id', bill_id,
    'bill_number', bill_reference,
    'supplier_name', supplier_row.name
  );
end;
$$;

create or replace function public.record_supplier_payable_payment(
  p_payable_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_credit_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payable_row public.payables%rowtype;
  supplier_row public.suppliers%rowtype;
  credit_account public.accounts%rowtype;
  payable_account public.accounts%rowtype;
  entry_id uuid;
  payment_id uuid;
  amount_value numeric(12, 2);
  new_amount_paid numeric(12, 2);
  remaining numeric(12, 2);
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (profiles.role in ('super_admin', 'accounting') or coalesce(profiles.access_level, 0) >= 2)
  ) then
    raise exception 'Only authorised accounting users can record supplier payments';
  end if;
  if p_amount is null or p_amount <= 0 or p_payment_date is null then
    raise exception 'Enter a positive payment amount and payment date';
  end if;
  amount_value := round(p_amount, 2);
  if amount_value <= 0 then
    raise exception 'Payment amount must be at least one cent';
  end if;

  select * into payable_row
  from public.payables
  where id = p_payable_id
  for update;
  if not found then
    raise exception 'Supplier bill not found';
  end if;
  if payable_row.voided_at is not null then
    raise exception 'A voided supplier bill cannot be paid';
  end if;

  remaining := round(payable_row.amount - coalesce(payable_row.amount_paid, 0), 2);
  if amount_value > remaining + 0.005 then
    raise exception 'Payment exceeds the outstanding balance of %', greatest(remaining, 0);
  end if;

  select * into credit_account
  from public.accounts
  where id = p_credit_account_id and is_active = true
  for share;
  if not found then
    raise exception 'Choose an active account to pay from';
  end if;
  if credit_account.type <> 'asset' then
    raise exception 'Choose an asset account such as cash or bank to pay from';
  end if;
  select * into payable_account
  from public.accounts
  where code = '2000' and is_active = true
  for share;
  if not found then
    raise exception 'Accounts Payable (code 2000) is missing or inactive';
  end if;

  select * into supplier_row from public.suppliers where id = payable_row.supplier_id;
  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    p_payment_date,
    payable_row.bill_number,
    'Payment to ' || coalesce(supplier_row.name, 'Supplier')
      || ' — bill ' || coalesce(payable_row.bill_number, payable_row.id::text),
    'payable_payment'
  )
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values
    (entry_id, payable_account.id, amount_value, 0),
    (entry_id, credit_account.id, 0, amount_value);

  insert into public.payable_payments (
    payable_id, payment_date, amount, payment_method, journal_entry_id
  )
  values (
    payable_row.id, p_payment_date, amount_value,
    credit_account.code || ' — ' || credit_account.name, entry_id
  )
  returning id into payment_id;

  new_amount_paid := round(coalesce(payable_row.amount_paid, 0) + amount_value, 2);
  update public.payables
  set amount_paid = new_amount_paid,
      status = case when new_amount_paid >= payable_row.amount - 0.01 then 'paid' else 'partially_paid' end
  where id = payable_row.id;

  return payment_id;
end;
$$;

create or replace function public.void_supplier_payable(p_payable_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payable_row public.payables%rowtype;
  original_entry public.journal_entries%rowtype;
  reversal_entry_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (profiles.role in ('super_admin', 'accounting') or coalesce(profiles.access_level, 0) >= 2)
  ) then
    raise exception 'Only authorised accounting users can void supplier bills';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required to void a supplier bill';
  end if;

  select * into payable_row
  from public.payables
  where id = p_payable_id
  for update;
  if not found then
    raise exception 'Supplier bill not found';
  end if;
  if payable_row.voided_at is not null then
    raise exception 'This supplier bill is already voided';
  end if;
  if payable_row.restock_id is not null then
    raise exception 'This bill is linked to a stock purchase. Reverse the stock purchase first; it cannot be voided from Payables.';
  end if;
  if exists (
    select 1
    from public.payable_payments payment
    left join public.payable_payment_reversals reversal
      on reversal.payable_payment_id = payment.id
    where payment.payable_id = payable_row.id
      and reversal.id is null
  ) then
    raise exception 'Reverse every payment on this bill before voiding it';
  end if;
  if coalesce(payable_row.amount_paid, 0) > 0.01 then
    raise exception 'The recorded paid balance must be fully reversed before voiding this bill';
  end if;
  if payable_row.journal_entry_id is null then
    raise exception 'This bill has no ledger entry to reverse';
  end if;

  select * into original_entry
  from public.journal_entries
  where id = payable_row.journal_entry_id;
  if not found then
    raise exception 'The ledger entry for this bill no longer exists';
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    current_date,
    payable_row.bill_number,
    'Void supplier bill ' || coalesce(payable_row.bill_number, payable_row.id::text)
      || ': ' || btrim(p_reason),
    'payable_void'
  )
  returning id into reversal_entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  select reversal_entry_id, account_id, credit, debit
  from public.journal_lines
  where journal_entry_id = original_entry.id;
  if not found then
    raise exception 'The bill ledger entry has no lines to reverse';
  end if;

  update public.payables
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = btrim(p_reason),
      void_journal_entry_id = reversal_entry_id
  where id = payable_row.id;

  return reversal_entry_id;
end;
$$;

revoke all on function public.create_supplier_payable(text, uuid, numeric, date, date, text) from public, anon;
revoke all on function public.record_supplier_payable_payment(uuid, numeric, date, uuid) from public, anon;
revoke all on function public.void_supplier_payable(uuid, text) from public, anon;
grant execute on function public.create_supplier_payable(text, uuid, numeric, date, date, text) to authenticated;
grant execute on function public.record_supplier_payable_payment(uuid, numeric, date, uuid) to authenticated;
grant execute on function public.void_supplier_payable(uuid, text) to authenticated;

commit;
