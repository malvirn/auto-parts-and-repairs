-- Allow prepaid quotation deposits to apply to newly created job cards.
-- The customer statement intentionally hides Draft/Received jobs until they progress,
-- but quotation deposits must be usable against their linked job immediately.

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
set search_path = 'pg_catalog', 'public'
as $function$
declare
  deposit_row public.quotation_deposit_receipts%rowtype;
  existing_row public.customer_credit_movements%rowtype;
  target_customer_id uuid;
  target_customer_name text;
  target_source_type text;
  available_credit numeric(12,2);
  available_balance numeric(12,2);
  deposit_account_id uuid;
  receivable_account_id uuid;
  entry_id uuid;
  movement_id uuid := gen_random_uuid();
  amount_value numeric(12,2);
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
    if existing_row.deposit_receipt_id is distinct from p_deposit_receipt_id
      or existing_row.amount <> round(p_amount, 2)
      or existing_row.movement_type <> 'application'
      or existing_row.target_type <> p_target_type
      or existing_row.target_id <> p_target_id then
      raise exception 'This credit request key was already used for a different application';
    end if;
    if existing_row.reversed_at is not null then
      raise exception 'This credit application was reversed. Start a new application request.';
    end if;
    return jsonb_build_object('id', existing_row.id, 'amount', existing_row.amount, 'replayed', true);
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
    select job.customer_id, customer.full_name into target_customer_id, target_customer_name
    from public.repair_jobs job
    left join public.customers customer on customer.id = job.customer_id
    where job.id = p_target_id for update of job;
    if not found then raise exception 'Repair job not found'; end if;
    target_label := 'Repair job ' || p_target_id;
    target_source_type := 'Repair job';
  elsif p_target_type = 'sales_order' then
    select sales_order.customer_id, customer.full_name into target_customer_id, target_customer_name
    from public.sales_orders sales_order
    join public.customers customer on customer.id = sales_order.customer_id
    where sales_order.id = p_target_id and sales_order.status = 'Confirmed'
    for update of sales_order;
    if not found then raise exception 'Confirmed sales order not found'; end if;
    target_label := 'Sales order ' || p_target_id;
    target_source_type := 'Sales order';
  else
    select invoice.customer_id, customer.full_name into target_customer_id, target_customer_name
    from public.invoices invoice
    join public.customers customer on customer.id = invoice.customer_id
    where invoice.id = p_target_id for update of invoice;
    if not found then raise exception 'Invoice not found'; end if;
    target_label := 'Invoice ' || p_target_id;
    target_source_type := 'Invoice';
  end if;

  if deposit_row.customer_id is not null then
    if target_customer_id is distinct from deposit_row.customer_id then
      raise exception 'Customer credit can only be applied to that same customer';
    end if;
  elsif lower(btrim(target_customer_name)) is distinct from lower(btrim(deposit_row.customer_name)) then
    raise exception 'This credit note belongs to a different customer name';
  end if;

  if p_target_type = 'repair_job' then
    -- Draft and Received jobs are intentionally absent from the customer statement.
    -- Calculate their real outstanding amount directly so a linked quotation deposit
    -- can be applied as soon as the job card is created.
    select greatest(
      coalesce(job.total_cost, 0)
        - greatest(
            coalesce((
              select sum(payment.amount)
              from public.repair_job_payments payment
              where payment.repair_job_id = job.id
                and payment.voided_at is null
            ), 0),
            coalesce((
              select max(invoice.amount_paid)
              from public.invoices invoice
              where invoice.repair_job_id = job.id
            ), 0)
          )
        - coalesce((
            select sum(movement.amount)
            from public.customer_credit_movements movement
            where movement.target_type = 'repair_job'
              and movement.target_id = job.id
              and movement.movement_type = 'application'
              and movement.reversed_at is null
          ), 0),
      0
    )::numeric(12,2)
    into available_balance
    from public.repair_jobs job
    where job.id = p_target_id;
  else
    -- Keep the existing statement-based validation for sales orders and invoices.
    select greatest(coalesce(statement.balance_due, 0), 0)::numeric(12,2)
    into available_balance
    from public.customer_account_statement statement
    where statement.source_id = p_target_id and statement.source_type = target_source_type;
    if not found then available_balance := 0; end if;
  end if;

  if coalesce(available_balance, 0) <= 0.005 then
    raise exception 'The selected customer balance has no amount outstanding';
  end if;
  if amount_value > available_balance + 0.005 then
    raise exception 'Credit application exceeds the outstanding balance of %', available_balance;
  end if;

  select id into deposit_account_id from public.accounts
  where code = '2300' and is_active and type = 'liability';
  select id into receivable_account_id from public.accounts
  where code = '1100' and is_active and type = 'asset';
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
  values (entry_id, deposit_account_id, amount_value, 0),
         (entry_id, receivable_account_id, 0, amount_value);

  insert into public.customer_credit_movements (
    id, deposit_receipt_id, movement_type, amount, target_type, target_id,
    reason, journal_entry_id, idempotency_key, created_by
  ) values (
    movement_id, deposit_row.id, 'application', amount_value, p_target_type, p_target_id,
    coalesce(nullif(btrim(p_reason), ''), ''), entry_id, p_idempotency_key, auth.uid()
  );

  return jsonb_build_object(
    'id', movement_id, 'amount', amount_value,
    'remaining_target_balance', available_balance - amount_value
  );
end;
$function$;

revoke all on function public.apply_customer_credit(uuid, numeric, text, uuid, text, uuid) from public, anon;
grant execute on function public.apply_customer_credit(uuid, numeric, text, uuid, text, uuid) to authenticated;
