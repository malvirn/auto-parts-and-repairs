begin;

-- Keep the liability account consistent without changing any existing receipt-credit-note records.
do $$
begin
  if exists (
    select 1 from public.accounts
    where code = '2300'
      and (name <> 'Customer Deposits' or type <> 'liability' or normal_balance <> 'credit')
  ) then
    raise exception 'Account code 2300 is already assigned to an incompatible account';
  end if;
end;
$$;

insert into public.accounts (code, name, type, normal_balance, is_active)
values ('2300', 'Customer Deposits', 'liability', 'credit', true)
on conflict (code) do update set is_active = true;

alter table public.quotations alter column customer_id drop not null;
alter table public.quotation_deposit_receipts alter column customer_id drop not null;
alter table public.quotation_deposit_receipts
  add column if not exists customer_name text,
  add column if not exists customer_phone text;

update public.quotation_deposit_receipts receipt
set customer_name = coalesce(
      (select customer.full_name from public.customers customer where customer.id = receipt.customer_id),
      (select quote.walk_in_name from public.quotations quote where quote.id = receipt.quotation_id),
      'Customer'
    ),
    customer_phone = coalesce(
      (select customer.phone from public.customers customer where customer.id = receipt.customer_id),
      (select quote.walk_in_phone from public.quotations quote where quote.id = receipt.quotation_id)
    )
where receipt.customer_name is null;

alter table public.quotation_deposit_receipts alter column customer_name set not null;

alter table public.quotation_deposit_receipts enable row level security;
alter table public.customer_credit_movements enable row level security;
revoke all on public.quotation_deposit_receipts, public.customer_credit_movements from public, anon, authenticated;
grant select on public.quotation_deposit_receipts, public.customer_credit_movements to authenticated;

drop policy if exists "Staff can view quotation deposit receipts" on public.quotation_deposit_receipts;
drop policy if exists "Accounting users can view quotation deposit receipts" on public.quotation_deposit_receipts;
create policy "Staff can view quotation deposit receipts"
  on public.quotation_deposit_receipts for select to authenticated
  using (public.current_access_level() >= 1);

drop policy if exists "Staff can view customer credit movements" on public.customer_credit_movements;
drop policy if exists "Accounting users can view customer credit movements" on public.customer_credit_movements;
create policy "Staff can view customer credit movements"
  on public.customer_credit_movements for select to authenticated
  using (public.current_access_level() >= 1);



create or replace view public.customer_credit_balances
with (security_invoker = true)
as
select
  receipt.id as deposit_receipt_id,
  receipt.credit_note_number,
  receipt.quotation_id,
  receipt.customer_id,
  receipt.customer_name,
  coalesce(receipt.customer_phone, customer.phone) as phone,
  customer.email,
  receipt.amount as issued_amount,
  receipt.payment_method,
  receipt.payment_date,
  receipt.reference,
  receipt.created_at,
  greatest(receipt.amount - coalesce(sum(movement.amount) filter (where movement.reversed_at is null), 0), 0)::numeric(12, 2) as available_amount
from public.quotation_deposit_receipts receipt
left join public.customers customer on customer.id = receipt.customer_id
left join public.customer_credit_movements movement on movement.deposit_receipt_id = receipt.id
group by receipt.id, customer.id;

revoke all on public.customer_credit_balances from public, anon;
grant select on public.customer_credit_balances to authenticated;

create or replace function public.record_quotation_deposit(
  p_quotation_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_reference text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quote_row public.quotations%rowtype;
  account_row public.accounts%rowtype;
  existing_row public.quotation_deposit_receipts%rowtype;
  deposit_account_id uuid;
  payment_account_code text;
  entry_id uuid;
  receipt_id uuid;
  receipt_number bigint;
  amount_value numeric(12, 2);
  previously_received numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Only authorised sales or accounting users can record quotation deposits' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'A payment request key is required';
  end if;
  if p_amount is null or p_amount <= 0 or p_payment_date is null then
    raise exception 'Enter a positive deposit amount and payment date';
  end if;
  if p_payment_method not in ('Cash', 'EcoCash', 'Bank', 'Swipe') then
    raise exception 'Choose Cash, EcoCash, Bank or Swipe';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into existing_row
  from public.quotation_deposit_receipts
  where idempotency_key = p_idempotency_key;
  if found then
    if existing_row.quotation_id <> p_quotation_id
      or existing_row.amount <> round(p_amount, 2)
      or existing_row.payment_method <> p_payment_method
      or existing_row.payment_date <> p_payment_date
      or coalesce(existing_row.reference, '') <> coalesce(nullif(btrim(p_reference), ''), '') then
      raise exception 'This payment request key was already used for a different deposit';
    end if;
    return jsonb_build_object('id', existing_row.id, 'credit_note_number', existing_row.credit_note_number, 'amount', existing_row.amount);
  end if;

  amount_value := round(p_amount, 2);
  payment_account_code := case p_payment_method
    when 'Cash' then '1000'
    when 'EcoCash' then '1020'
    else '1010'
  end;
  select * into account_row
  from public.accounts
  where code = payment_account_code and is_active and type = 'asset';
  if not found then
    raise exception 'The active payment account for % is missing', p_payment_method;
  end if;
  select id into deposit_account_id from public.accounts where code = '2300' and is_active and type = 'liability';
  if deposit_account_id is null then
    raise exception 'Customer Deposits liability account 2300 is missing or inactive';
  end if;

  select * into quote_row
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found then
    raise exception 'Quotation not found';
  end if;
  if quote_row.customer_id is null then
    if nullif(btrim(quote_row.walk_in_name), '') is null then
      raise exception 'Enter the customer name on the quotation before recording a deposit';
    end if;
  end if;
  if quote_row.created_at + interval '7 days' < now() then
    raise exception 'This quotation has expired; deposits are accepted only during its seven-day validity';
  end if;
  if exists (select 1 from public.sales_orders where quotation_id = quote_row.id) then
    raise exception 'Record the quotation deposit before converting it to a sales order';
  end if;
  if amount_value <= 0 then
    raise exception 'Deposit amount must be at least one cent';
  end if;

  select
    coalesce((select sum(receipt.amount) from public.quotation_deposit_receipts receipt where receipt.quotation_id = quote_row.id), 0)
    - coalesce((
      select sum(movement.amount)
      from public.customer_credit_movements movement
      join public.quotation_deposit_receipts receipt on receipt.id = movement.deposit_receipt_id
      where receipt.quotation_id = quote_row.id and movement.movement_type = 'refund' and movement.reversed_at is null
    ), 0)
  into previously_received;
  if previously_received + amount_value > quote_row.total_usd + 0.005 then
    raise exception 'Deposit exceeds the remaining quotation amount of %', greatest(quote_row.total_usd - previously_received, 0);
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    p_payment_date,
    'QDEP-' || quote_row.quotation_number,
    'Quotation deposit · Quote ' || quote_row.quotation_number,
    'quotation_deposit'
  )
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values (entry_id, account_row.id, amount_value, 0), (entry_id, deposit_account_id, 0, amount_value);

  insert into public.quotation_deposit_receipts (
    quotation_id, customer_id, customer_name, customer_phone, amount, payment_method, payment_account_id,
    payment_date, reference, journal_entry_id, idempotency_key, created_by
  )
  values (
    quote_row.id, quote_row.customer_id,
    coalesce((select full_name from public.customers where id = quote_row.customer_id), nullif(btrim(quote_row.walk_in_name), ''), 'Customer'),
    coalesce((select phone from public.customers where id = quote_row.customer_id), nullif(btrim(quote_row.walk_in_phone), '')),
    amount_value, p_payment_method, account_row.id,
    p_payment_date, nullif(btrim(p_reference), ''), entry_id, p_idempotency_key, auth.uid()
  )
  returning id, credit_note_number into receipt_id, receipt_number;

  return jsonb_build_object('id', receipt_id, 'credit_note_number', receipt_number, 'amount', amount_value);
end;
$$;

create or replace function public.link_quotation_deposit_customer(
  p_quotation_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quote_row public.quotations%rowtype;
  customer_row public.customers%rowtype;
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in with staff access to link this quotation';
  end if;
  select * into quote_row from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'Quotation not found'; end if;
  select * into customer_row from public.customers where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;
  if quote_row.customer_id is not null then
    if quote_row.customer_id <> customer_row.id then
      raise exception 'This quotation is already linked to a different customer';
    end if;
    update public.quotation_deposit_receipts set customer_id = customer_row.id
    where quotation_id = quote_row.id and customer_id is null;
    return;
  end if;
  if lower(btrim(quote_row.walk_in_name)) is distinct from lower(btrim(customer_row.full_name)) then
    raise exception 'The registered customer name does not match the walk-in quotation';
  end if;
  update public.quotations set customer_id = customer_row.id, updated_at = now() where id = quote_row.id;
  update public.quotation_deposit_receipts set customer_id = customer_row.id
  where quotation_id = quote_row.id and customer_id is null;
end;
$$;

create or replace function public.apply_customer_credit(
  p_deposit_receipt_id uuid,
  p_amount numeric,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deposit_row public.quotation_deposit_receipts%rowtype;
  existing_row public.customer_credit_movements%rowtype;
  target_customer_id uuid;
  target_customer_name text;
  target_total numeric(12, 2);
  target_paid numeric(12, 2);
  target_applied numeric(12, 2);
  available_credit numeric(12, 2);
  available_balance numeric(12, 2);
  deposit_account_id uuid;
  receivable_account_id uuid;
  entry_id uuid;
  movement_id uuid := gen_random_uuid();
  amount_value numeric(12, 2);
  target_label text;
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Only authorised staff can apply customer credit' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_amount is null or p_amount <= 0 or p_target_id is null then
    raise exception 'Choose a customer balance and enter a positive credit amount';
  end if;
  if p_target_type is null or p_target_type not in ('repair_job', 'sales_order', 'invoice') then
    raise exception 'Credit can be applied only to a repair job, sales order or invoice';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into existing_row from public.customer_credit_movements where idempotency_key = p_idempotency_key;
  if found then
    if existing_row.deposit_receipt_id <> p_deposit_receipt_id
      or existing_row.amount <> round(p_amount, 2)
      or existing_row.movement_type <> 'application'
      or existing_row.target_type <> p_target_type
      or existing_row.target_id <> p_target_id then
      raise exception 'This credit request key was already used for a different application';
    end if;
    return jsonb_build_object('id', existing_row.id, 'amount', existing_row.amount);
  end if;

  amount_value := round(p_amount, 2);
  if amount_value <= 0 then raise exception 'Deposit amount must be at least one cent'; end if;
  select * into deposit_row from public.quotation_deposit_receipts where id = p_deposit_receipt_id for update;
  if not found then raise exception 'Customer credit note not found'; end if;
  select greatest(deposit_row.amount - coalesce(sum(amount) filter (where reversed_at is null), 0), 0)
  into available_credit
  from public.customer_credit_movements
  where deposit_receipt_id = deposit_row.id;
  available_credit := coalesce(available_credit, deposit_row.amount);
  if amount_value > available_credit + 0.005 then
    raise exception 'Credit application exceeds the available customer credit of %', available_credit;
  end if;

  if p_target_type = 'repair_job' then
    select job.customer_id, customer.full_name, coalesce(job.total_cost, 0)::numeric(12, 2)
    into target_customer_id, target_customer_name, target_total
    from public.repair_jobs job left join public.customers customer on customer.id = job.customer_id
    where job.id = p_target_id for update of job;
    if not found then raise exception 'Repair job not found'; end if;
    select coalesce(sum(amount), 0) into target_paid
    from public.repair_job_payments where repair_job_id = p_target_id and voided_at is null;
    target_label := 'Repair job ' || p_target_id;
  elsif p_target_type = 'sales_order' then
    select sales_order.customer_id, customer.full_name, coalesce(sales_order.total_usd, 0)::numeric(12, 2)
    into target_customer_id, target_customer_name, target_total
    from public.sales_orders sales_order
    join public.customers customer on customer.id = sales_order.customer_id
    where sales_order.id = p_target_id and sales_order.status = 'Confirmed'
    for update of sales_order;
    if not found then raise exception 'Confirmed sales order not found'; end if;
    select greatest(
      coalesce((select max(amount) from public.receipts where sales_order_id = p_target_id and voided_at is null), 0),
      coalesce((select sum(amount) from public.quick_sale_payments where sales_order_id = p_target_id), 0)
    ) into target_paid;
    target_label := 'Sales order ' || p_target_id;
  else
    select invoice.customer_id, customer.full_name, coalesce(invoice.total, 0)::numeric(12, 2)
    into target_customer_id, target_customer_name, target_total
    from public.invoices invoice
    join public.customers customer on customer.id = invoice.customer_id
    where invoice.id = p_target_id for update of invoice;
    if not found then raise exception 'Invoice not found'; end if;
    select greatest(
      coalesce((select amount_paid from public.invoices where id = p_target_id), 0),
      coalesce((select sum(amount) from public.invoice_payments where invoice_id = p_target_id), 0)
    ) into target_paid;
    target_label := 'Invoice ' || p_target_id;
  end if;
  if deposit_row.customer_id is not null then
    if target_customer_id is distinct from deposit_row.customer_id then
      raise exception 'Customer credit can only be applied to that same customer';
    end if;
  elsif lower(btrim(target_customer_name)) is distinct from lower(btrim(deposit_row.customer_name)) then
    raise exception 'This credit note belongs to a different customer name';
  end if;

  if p_target_type = 'repair_job' then
    select coalesce(sum(amount), 0) into target_applied
    from public.customer_credit_movements
    where target_type = 'repair_job' and target_id = p_target_id
      and movement_type = 'application' and reversed_at is null;
  elsif p_target_type = 'sales_order' then
    select coalesce(sum(amount), 0) into target_applied
    from public.customer_credit_movements
    where target_type = 'sales_order' and target_id = p_target_id
      and movement_type = 'application' and reversed_at is null;
  else
    select coalesce(sum(amount), 0) into target_applied
    from public.customer_credit_movements
    where target_type = 'invoice' and target_id = p_target_id
      and movement_type = 'application' and reversed_at is null;
  end if;
  available_balance := greatest(target_total - coalesce(target_paid, 0) - target_applied, 0);
  if amount_value > available_balance + 0.005 then
    raise exception 'Credit application exceeds the outstanding balance of %', available_balance;
  end if;

  select id into deposit_account_id from public.accounts where code = '2300' and is_active and type = 'liability';
  select id into receivable_account_id from public.accounts where code = '1100' and is_active and type = 'asset';
  if deposit_account_id is null or receivable_account_id is null then
    raise exception 'Customer Deposits (2300) or Accounts Receivable (1100) is missing or inactive';
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    (now() at time zone 'Africa/Harare')::date,
    'CAPP-' || deposit_row.credit_note_number || '-' || substr(movement_id::text, 1, 8),
    'Customer credit applied · ' || target_label,
    'customer_credit_application'
  ) returning id into entry_id;
  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values (entry_id, deposit_account_id, amount_value, 0), (entry_id, receivable_account_id, 0, amount_value);

  insert into public.customer_credit_movements (
    id, deposit_receipt_id, movement_type, amount, target_type, target_id,
    reason, journal_entry_id, idempotency_key, created_by
  ) values (
    movement_id, deposit_row.id, 'application', amount_value, p_target_type, p_target_id,
    coalesce(nullif(btrim(p_reason), ''), ''), entry_id, p_idempotency_key, auth.uid()
  );
  return jsonb_build_object('id', movement_id, 'amount', amount_value);
end;
$$;

create or replace function public.refund_customer_credit(
  p_deposit_receipt_id uuid,
  p_amount numeric,
  p_payment_account_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deposit_row public.quotation_deposit_receipts%rowtype;
  existing_row public.customer_credit_movements%rowtype;
  payment_account public.accounts%rowtype;
  deposit_account_id uuid;
  entry_id uuid;
  movement_id uuid := gen_random_uuid();
  amount_value numeric(12, 2);
  available_credit numeric(12, 2);
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (lower(replace(replace(trim(role), '-', '_'), ' ', '_')) in ('accounting', 'super_admin', 'superadmin') or coalesce(access_level, 0) >= 2)
  ) then
    raise exception 'Only Accounting-level users and Super Admins can refund customer credit' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_amount is null or p_amount <= 0 or nullif(btrim(p_reason), '') is null then
    raise exception 'Enter a positive refund amount and reason';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select * into existing_row from public.customer_credit_movements where idempotency_key = p_idempotency_key;
  if found then
    if existing_row.deposit_receipt_id <> p_deposit_receipt_id
      or existing_row.amount <> round(p_amount, 2)
      or existing_row.movement_type <> 'refund'
      or existing_row.payment_account_id <> p_payment_account_id
      or existing_row.reason <> btrim(p_reason) then
      raise exception 'This refund request key was already used for a different refund';
    end if;
    return jsonb_build_object('id', existing_row.id, 'amount', existing_row.amount);
  end if;

  amount_value := round(p_amount, 2);
  if amount_value <= 0 then raise exception 'Refund amount must be at least one cent'; end if;
  select * into deposit_row from public.quotation_deposit_receipts where id = p_deposit_receipt_id for update;
  if not found then raise exception 'Customer credit note not found'; end if;
  select * into payment_account from public.accounts
  where id = p_payment_account_id and is_active and type = 'asset' and code like '10%';
  if not found then raise exception 'Choose an active cash or bank account'; end if;
  select id into deposit_account_id from public.accounts where code = '2300' and is_active and type = 'liability';
  if deposit_account_id is null then raise exception 'Customer Deposits liability account 2300 is missing or inactive'; end if;

  select greatest(deposit_row.amount - coalesce(sum(amount) filter (where reversed_at is null), 0), 0)
  into available_credit
  from public.customer_credit_movements where deposit_receipt_id = deposit_row.id;
  available_credit := coalesce(available_credit, deposit_row.amount);
  if amount_value > available_credit + 0.005 then
    raise exception 'Refund exceeds the available customer credit of %', available_credit;
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    (now() at time zone 'Africa/Harare')::date,
    'CREF-' || deposit_row.credit_note_number || '-' || substr(movement_id::text, 1, 8),
    'Customer credit refund · Credit note ' || deposit_row.credit_note_number,
    'customer_credit_refund'
  ) returning id into entry_id;
  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values (entry_id, deposit_account_id, amount_value, 0), (entry_id, payment_account.id, 0, amount_value);

  insert into public.customer_credit_movements (
    id, deposit_receipt_id, movement_type, amount, payment_account_id,
    reason, journal_entry_id, idempotency_key, created_by
  ) values (
    movement_id, deposit_row.id, 'refund', amount_value, payment_account.id,
    btrim(p_reason), entry_id, p_idempotency_key, auth.uid()
  );
  return jsonb_build_object('id', movement_id, 'amount', amount_value);
end;
$$;

create or replace function public.reverse_customer_credit_movement(
  p_movement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  movement_row public.customer_credit_movements%rowtype;
  original_entry public.journal_entries%rowtype;
  reversal_entry_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (lower(replace(replace(trim(role), '-', '_'), ' ', '_')) in ('accounting', 'super_admin', 'superadmin') or coalesce(access_level, 0) >= 2)
  ) then
    raise exception 'Only Accounting-level users and Super Admins can reverse customer credit movements' using errcode = '42501';
  end if;
  if p_movement_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Choose a credit movement and enter a reversal reason';
  end if;

  select * into movement_row from public.customer_credit_movements where id = p_movement_id for update;
  if not found then raise exception 'Customer credit movement not found'; end if;
  if movement_row.reversed_at is not null then raise exception 'This customer credit movement has already been reversed'; end if;
  select * into original_entry from public.journal_entries where id = movement_row.journal_entry_id;
  if not found then raise exception 'The original journal entry is missing'; end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    (now() at time zone 'Africa/Harare')::date,
    'REV-CREDIT-' || substr(movement_row.id::text, 1, 12),
    'Reversal · ' || original_entry.description || ' · ' || btrim(p_reason),
    'customer_credit_reversal'
  ) returning id into reversal_entry_id;
  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  select reversal_entry_id, account_id, credit, debit
  from public.journal_lines
  where journal_entry_id = movement_row.journal_entry_id;

  update public.customer_credit_movements
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason),
      reversal_journal_entry_id = reversal_entry_id
  where id = movement_row.id;
  return reversal_entry_id;
end;
$$;

revoke all on function public.record_quotation_deposit(uuid, numeric, text, date, text, uuid) from public, anon;
revoke all on function public.link_quotation_deposit_customer(uuid, uuid) from public, anon;
revoke all on function public.apply_customer_credit(uuid, numeric, text, uuid, text, uuid) from public, anon;
revoke all on function public.refund_customer_credit(uuid, numeric, uuid, text, uuid) from public, anon;
revoke all on function public.reverse_customer_credit_movement(uuid, text) from public, anon;
grant execute on function public.record_quotation_deposit(uuid, numeric, text, date, text, uuid) to authenticated;
grant execute on function public.link_quotation_deposit_customer(uuid, uuid) to authenticated;
grant execute on function public.apply_customer_credit(uuid, numeric, text, uuid, text, uuid) to authenticated;
grant execute on function public.refund_customer_credit(uuid, numeric, uuid, text, uuid) to authenticated;
grant execute on function public.reverse_customer_credit_movement(uuid, text) to authenticated;

create or replace view public.customer_account_statement
with (security_invoker = true)
as
with repair_payment_totals as (
  select repair_job_id, sum(amount) as paid_amount
  from public.repair_job_payments
  where voided_at is null
  group by repair_job_id
),
repair_credit_totals as (
  select target_id as repair_job_id, sum(amount) as applied_amount
  from public.customer_credit_movements
  where movement_type = 'application' and target_type = 'repair_job' and reversed_at is null
  group by target_id
),
sales_receipt_totals as (
  select sales_order_id, max(amount) as paid_amount
  from public.receipts
  where sales_order_id is not null and voided_at is null
  group by sales_order_id
),
sales_payment_totals as (
  select sales_order_id, sum(amount) as paid_amount,
    string_agg(distinct payment_method, ', ' order by payment_method) as payment_methods
  from public.quick_sale_payments
  group by sales_order_id
),
sales_credit_totals as (
  select target_id as sales_order_id, sum(amount) as applied_amount
  from public.customer_credit_movements
  where movement_type = 'application' and target_type = 'sales_order' and reversed_at is null
  group by target_id
),
invoice_payment_totals as (
  select invoice_id, sum(amount) as paid_amount
  from public.invoice_payments
  group by invoice_id
),
invoice_credit_totals as (
  select target_id as invoice_id, sum(amount) as applied_amount
  from public.customer_credit_movements
  where movement_type = 'application' and target_type = 'invoice' and reversed_at is null
  group by target_id
)
select
  c.id as customer_id,
  c.full_name as customer_name,
  c.phone,
  c.email,
  j.id as source_id,
  'Repair job'::text as source_type,
  coalesce(j.cro_number, 'Job #' || lpad(j.job_number::text, 4, '0')) as reference,
  j.created_at::date as entry_date,
  coalesce(j.total_cost, 0)::numeric(12, 2) as total_amount,
  (coalesce(rp.paid_amount, 0) + coalesce(rc.applied_amount, 0))::numeric(12, 2) as amount_paid,
  (coalesce(j.total_cost, 0) - coalesce(rp.paid_amount, 0) - coalesce(rc.applied_amount, 0))::numeric(12, 2) as balance_due,
  0::numeric(12, 2) as discount_amount,
  null::text as payment_method,
  false as can_record_payment
from public.repair_jobs j
join public.customers c on c.id = j.customer_id
left join repair_payment_totals rp on rp.repair_job_id = j.id
left join repair_credit_totals rc on rc.repair_job_id = j.id
where coalesce(j.total_cost, 0) > 0
  and (j.status::text in ('Ready for Pickup', 'Unclaimed', 'Collected', 'Processed')
    or rp.repair_job_id is not null or rc.repair_job_id is not null)
  and not exists (select 1 from public.invoices invoice where invoice.repair_job_id = j.id)

union all

select
  c.id as customer_id,
  c.full_name as customer_name,
  c.phone,
  c.email,
  so.id as source_id,
  'Sales order'::text as source_type,
  'Order #' || lpad(so.order_number::text, 4, '0') as reference,
  so.created_at::date as entry_date,
  coalesce(so.total_usd, 0)::numeric(12, 2) as total_amount,
  (greatest(coalesce(sr.paid_amount, 0), coalesce(sp.paid_amount, 0)) + coalesce(sc.applied_amount, 0))::numeric(12, 2) as amount_paid,
  (coalesce(so.total_usd, 0) - greatest(coalesce(sr.paid_amount, 0), coalesce(sp.paid_amount, 0)) - coalesce(sc.applied_amount, 0))::numeric(12, 2) as balance_due,
  coalesce(so.discount_usd, 0)::numeric(12, 2) as discount_amount,
  coalesce(sp.payment_methods, so.payment_method),
  exists (select 1 from public.quick_sale_order_postings posting where posting.sales_order_id = so.id) as can_record_payment
from public.sales_orders so
join public.customers c on c.id = so.customer_id
left join sales_receipt_totals sr on sr.sales_order_id = so.id
left join sales_payment_totals sp on sp.sales_order_id = so.id
left join sales_credit_totals sc on sc.sales_order_id = so.id
where so.status = 'Confirmed' and coalesce(so.total_usd, 0) > 0

union all

select
  c.id as customer_id,
  c.full_name as customer_name,
  c.phone,
  c.email,
  invoice.id as source_id,
  'Invoice'::text as source_type,
  'INV-' || lpad(invoice.invoice_number::text, 5, '0') as reference,
  invoice.issued_at::date as entry_date,
  coalesce(invoice.total, 0)::numeric(12, 2) as total_amount,
  (greatest(coalesce(invoice.amount_paid, 0), coalesce(payments.paid_amount, 0)) + coalesce(credits.applied_amount, 0))::numeric(12, 2) as amount_paid,
  (coalesce(invoice.total, 0) - greatest(coalesce(invoice.amount_paid, 0), coalesce(payments.paid_amount, 0)) - coalesce(credits.applied_amount, 0))::numeric(12, 2) as balance_due,
  0::numeric(12, 2) as discount_amount,
  null::text as payment_method,
  false as can_record_payment
from public.invoices invoice
join public.customers c on c.id = invoice.customer_id
left join invoice_payment_totals payments on payments.invoice_id = invoice.id
left join invoice_credit_totals credits on credits.invoice_id = invoice.id
where coalesce(invoice.total, 0) > 0;

revoke all on public.customer_account_statement from public, anon;
grant select on public.customer_account_statement to authenticated;

commit;
