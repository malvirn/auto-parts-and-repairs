begin;

alter table public.receipts
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

alter table public.repair_job_payments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

create index if not exists receipts_active_issued_at_idx
  on public.receipts(issued_at desc)
  where voided_at is null;

create or replace function public.prevent_voided_receipt_changes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  void_function_owner name;
begin
  if tg_op = 'INSERT' then
    if new.voided_at is not null
      or new.voided_by is not null
      or new.void_reason is not null then
      select pg_get_userbyid(proowner) into void_function_owner
      from pg_proc
      where oid = 'public.void_business_receipt(uuid,text)'::regprocedure;
      if current_user <> void_function_owner then
        raise exception 'Receipts can only be voided through the authorised void operation'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.voided_at is distinct from old.voided_at
    or new.voided_by is distinct from old.voided_by
    or new.void_reason is distinct from old.void_reason
  ) then
    select pg_get_userbyid(proowner) into void_function_owner
    from pg_proc
    where oid = 'public.void_business_receipt(uuid,text)'::regprocedure;
    if current_user <> void_function_owner then
      raise exception 'Receipt void status can only be changed through the authorised void operation'
        using errcode = '42501';
    end if;
  end if;
  if old.voided_at is not null then
    raise exception 'A voided receipt is retained as an audit record and cannot be changed or deleted'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_direct_job_payment_void_changes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  void_function_owner name;
begin
  if tg_op = 'INSERT' then
    if new.voided_at is not null
      or new.voided_by is not null
      or new.void_reason is not null then
      select pg_get_userbyid(proowner) into void_function_owner
      from pg_proc
      where oid = 'public.void_business_receipt(uuid,text)'::regprocedure;
      if current_user <> void_function_owner then
        raise exception 'Job payment reversals can only be recorded through the authorised receipt void operation'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if new.voided_at is distinct from old.voided_at
    or new.voided_by is distinct from old.voided_by
    or new.void_reason is distinct from old.void_reason then
    select pg_get_userbyid(proowner) into void_function_owner
    from pg_proc
    where oid = 'public.void_business_receipt(uuid,text)'::regprocedure;
    if current_user <> void_function_owner then
      raise exception 'Job payment reversals can only be recorded through the authorised receipt void operation'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_direct_job_payment_void_changes on public.repair_job_payments;
create trigger prevent_direct_job_payment_void_changes
  before insert or update on public.repair_job_payments
  for each row execute function public.prevent_direct_job_payment_void_changes();

drop trigger if exists prevent_voided_receipt_changes on public.receipts;
create trigger prevent_voided_receipt_changes
  before insert or update or delete on public.receipts
  for each row execute function public.prevent_voided_receipt_changes();

create or replace function public.prevent_credit_note_on_voided_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  receipt_voided_at timestamptz;
begin
  select voided_at into receipt_voided_at
  from public.receipts
  where id = new.receipt_id
  for update;
  if not found then
    raise exception 'Receipt not found';
  end if;
  if receipt_voided_at is not null then
    raise exception 'A credit note cannot be issued against a voided receipt'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_credit_note_on_voided_receipt on public.credit_notes;
create trigger prevent_credit_note_on_voided_receipt
  before insert or update on public.credit_notes
  for each row execute function public.prevent_credit_note_on_voided_receipt();

create or replace function public.void_business_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  receipt_row public.receipts%rowtype;
  order_row public.sales_orders%rowtype;
  restock_row record;
  reversed_payments integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        role in ('accounting', 'super_admin')
        or coalesce(access_level, 0) >= 2
      )
  ) then
    raise exception 'Only Accounting-level users and Super Admins can void receipts'
      using errcode = '42501';
  end if;

  if p_receipt_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Choose a receipt and enter a reason for voiding it';
  end if;

  select * into receipt_row
  from public.receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Receipt not found';
  end if;
  if receipt_row.voided_at is not null then
    raise exception 'This receipt has already been voided';
  end if;
  if receipt_row.repair_job_id is not null and receipt_row.sales_order_id is not null then
    raise exception 'This receipt is linked to both a job card and a sales order and cannot be safely reversed';
  end if;
  if exists (select 1 from public.credit_notes where receipt_id = receipt_row.id) then
    raise exception 'This receipt has credit notes; resolve them before voiding it';
  end if;

  if receipt_row.repair_job_id is not null then
    perform 1
    from public.repair_jobs
    where id = receipt_row.repair_job_id
    for update;

    update public.repair_job_payments
    set voided_at = now(),
        voided_by = auth.uid(),
        void_reason = btrim(p_reason)
    where repair_job_id = receipt_row.repair_job_id
      and voided_at is null;
    get diagnostics reversed_payments = row_count;
  elsif receipt_row.sales_order_id is not null then
    select * into order_row
    from public.sales_orders
    where id = receipt_row.sales_order_id
    for update;

    if not found then
      raise exception 'The sales order linked to this receipt no longer exists';
    end if;
    if order_row.status <> 'Confirmed' then
      raise exception 'Only receipts for confirmed sales orders can be voided';
    end if;
    for restock_row in
      select part_id, sum(quantity) as quantity
      from public.sales_order_items
      where sales_order_id = receipt_row.sales_order_id
        and part_id is not null
      group by part_id
    loop
      update public.parts
      set quantity_in_stock = quantity_in_stock + restock_row.quantity
      where id = restock_row.part_id;
    end loop;

    update public.sales_orders
    set status = 'Cancelled',
        updated_at = now()
    where id = receipt_row.sales_order_id;
  end if;

  update public.receipts
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = btrim(p_reason)
  where id = receipt_row.id;

  return jsonb_build_object(
    'success', true,
    'receipt_id', receipt_row.id,
    'reversed_job_payments', reversed_payments,
    'cancelled_sales_order_id', receipt_row.sales_order_id
  );
end;
$$;

revoke all on function public.void_business_receipt(uuid, text) from public, anon;
grant execute on function public.void_business_receipt(uuid, text) to authenticated;

create or replace function public.edit_business_receipt(
  p_receipt_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  receipt_row public.receipts%rowtype;
  payment_row public.repair_job_payments%rowtype;
  current_total numeric(12, 2);
  target_total numeric(12, 2);
  remaining numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised users can correct receipts'
      using errcode = '42501';
  end if;

  if p_receipt_id is null or p_amount is null then
    raise exception 'Choose a receipt and enter a valid amount';
  end if;
  target_total := round(p_amount, 2);
  if target_total <= 0 then
    raise exception 'Receipt amount must be greater than zero';
  end if;

  select * into receipt_row
  from public.receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Receipt not found';
  end if;
  if receipt_row.voided_at is not null then
    raise exception 'A voided receipt cannot be corrected';
  end if;
  if receipt_row.repair_job_id is not null and receipt_row.sales_order_id is not null then
    raise exception 'This receipt is linked to both a job card and a sales order and cannot be safely corrected';
  end if;

  if receipt_row.repair_job_id is not null then
    perform 1 from public.repair_jobs where id = receipt_row.repair_job_id for update;
    select coalesce(sum(amount), 0)::numeric(12, 2)
    into current_total
    from public.repair_job_payments
    where repair_job_id = receipt_row.repair_job_id
      and voided_at is null;

    if target_total < current_total then
      remaining := current_total - target_total;
      for payment_row in
        select * from public.repair_job_payments
        where repair_job_id = receipt_row.repair_job_id
          and voided_at is null
        order by paid_at desc, created_at desc, id desc
        for update
      loop
        exit when remaining <= 0;
        if payment_row.amount <= remaining then
          delete from public.repair_job_payments where id = payment_row.id;
          remaining := remaining - payment_row.amount;
        else
          update public.repair_job_payments
          set amount = round(payment_row.amount - remaining, 2)
          where id = payment_row.id;
          remaining := 0;
        end if;
      end loop;
      if remaining > 0.005 then
        raise exception 'The linked job-card payment history changed while correcting this receipt';
      end if;
    elsif target_total > current_total then
      remaining := target_total - current_total;
      select * into payment_row
      from public.repair_job_payments
      where repair_job_id = receipt_row.repair_job_id
        and voided_at is null
      order by paid_at desc, created_at desc, id desc
      limit 1
      for update;
      if found then
        update public.repair_job_payments
        set amount = round(payment_row.amount + remaining, 2)
        where id = payment_row.id;
      else
        insert into public.repair_job_payments (repair_job_id, amount, payment_method)
        values (receipt_row.repair_job_id, target_total, 'Other');
      end if;
    end if;
  end if;

  update public.receipts
  set amount = target_total
  where id = receipt_row.id;
end;
$$;

revoke all on function public.edit_business_receipt(uuid, numeric) from public, anon;
grant execute on function public.edit_business_receipt(uuid, numeric) to authenticated;

create or replace view public.customer_account_statement
with (security_invoker = true)
as
with repair_payment_totals as (
  select repair_job_id, sum(amount) as paid_amount
  from public.repair_job_payments
  where voided_at is null
  group by repair_job_id
),
sales_receipt_totals as (
  select sales_order_id, max(amount) as paid_amount
  from public.receipts
  where sales_order_id is not null
    and voided_at is null
  group by sales_order_id
),
invoice_payment_totals as (
  select invoice_id, sum(amount) as paid_amount
  from public.invoice_payments
  group by invoice_id
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
  coalesce(rp.paid_amount, 0)::numeric(12, 2) as amount_paid,
  (coalesce(j.total_cost, 0) - coalesce(rp.paid_amount, 0))::numeric(12, 2) as balance_due
from public.repair_jobs j
join public.customers c on c.id = j.customer_id
left join repair_payment_totals rp on rp.repair_job_id = j.id
where coalesce(j.total_cost, 0) > 0
  and (
    j.status::text in ('Ready for Pickup', 'Unclaimed', 'Collected', 'Processed')
    or rp.repair_job_id is not null
  )

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
  coalesce(sr.paid_amount, 0)::numeric(12, 2) as amount_paid,
  (coalesce(so.total_usd, 0) - coalesce(sr.paid_amount, 0))::numeric(12, 2) as balance_due
from public.sales_orders so
join public.customers c on c.id = so.customer_id
left join sales_receipt_totals sr on sr.sales_order_id = so.id
where so.status = 'Confirmed'
  and coalesce(so.total_usd, 0) > 0

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
  coalesce(payments.paid_amount, 0)::numeric(12, 2) as amount_paid,
  (coalesce(invoice.total, 0) - coalesce(payments.paid_amount, 0))::numeric(12, 2) as balance_due
from public.invoices invoice
join public.customers c on c.id = invoice.customer_id
left join invoice_payment_totals payments on payments.invoice_id = invoice.id
where coalesce(invoice.total, 0) > 0;

revoke all on public.customer_account_statement from public, anon;
grant select on public.customer_account_statement to authenticated;

commit;
