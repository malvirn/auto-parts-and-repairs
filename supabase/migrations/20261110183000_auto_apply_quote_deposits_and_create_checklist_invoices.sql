-- Automatically apply quotation deposits recorded after a quotation is linked to a job card.
-- Create and sync the linked invoice inside the checklist-confirmation transaction.

CREATE OR REPLACE FUNCTION public.record_quotation_deposit(p_quotation_id uuid, p_amount numeric, p_payment_method text, p_payment_date date, p_reference text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  application_result jsonb;
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
    select * into quote_row from public.quotations where id = p_quotation_id for update;
    if found and quote_row.repair_job_id is not null then
      application_result := public.apply_quotation_deposits_to_repair_job(p_quotation_id, quote_row.repair_job_id);
    end if;
    return jsonb_build_object(
      'id', existing_row.id,
      'credit_note_number', existing_row.credit_note_number,
      'amount', existing_row.amount,
      'applied_amount', coalesce((application_result ->> 'applied_amount')::numeric, 0)
    );
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

  if quote_row.repair_job_id is not null then
    application_result := public.apply_quotation_deposits_to_repair_job(p_quotation_id, quote_row.repair_job_id);
  end if;

  return jsonb_build_object(
    'id', receipt_id,
    'credit_note_number', receipt_number,
    'amount', amount_value,
    'applied_amount', coalesce((application_result ->> 'applied_amount')::numeric, 0)
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.sync_repair_job_invoice(p_repair_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  job_row public.repair_jobs%rowtype;
  invoice_row public.invoices%rowtype;
  part_row record;
  extra_row record;
  v_invoice_items jsonb := '[]'::jsonb;
  v_item_subtotal numeric(12, 2) := 0;
  v_subtotal numeric(12, 2);
  v_parts_subtotal numeric(12, 2) := 0;
  v_vat_rate numeric(5, 2);
  v_discount numeric(12, 2);
  v_invoice_total numeric(12, 2);
  v_paid_total numeric(12, 2);
  customer_row public.customers%rowtype;
  invoice_exists boolean := false;
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in to synchronize a repair-job invoice'
      using errcode = '42501';
  end if;
  if p_repair_job_id is null then
    raise exception 'Choose a repair job';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_repair_job_id
  for update;
  if not found then
    raise exception 'Repair job not found';
  end if;

  select * into invoice_row
  from public.invoices
  where repair_job_id = job_row.id
  for update;
  invoice_exists := found;

  for part_row in
    select job_part.part_name, job_part.quantity, job_part.price_at_time, part.description
    from public.job_parts job_part
    left join public.parts part on part.id = job_part.part_id
    where job_part.job_id = job_row.id
    order by job_part.id
  loop
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(part_row.description), ''), nullif(btrim(part_row.part_name), ''), 'Part'),
      'q', part_row.quantity,
      'p', coalesce(part_row.price_at_time, 0)
    ));
    v_item_subtotal := v_item_subtotal + part_row.quantity * coalesce(part_row.price_at_time, 0);
    v_parts_subtotal := v_parts_subtotal + part_row.quantity * coalesce(part_row.price_at_time, 0);
  end loop;

  if coalesce(job_row.labour_cost, 0) > 0 then
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(job_row.job_description), ''), 'Labour'),
      'q', 1,
      'p', job_row.labour_cost
    ));
    v_item_subtotal := v_item_subtotal + job_row.labour_cost;
  end if;

  for extra_row in
    select description, amount
    from public.job_incidentals
    where job_id = job_row.id
    order by created_at, id
  loop
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(extra_row.description), ''), 'Additional job cost'),
      'q', 1,
      'p', extra_row.amount
    ));
    v_item_subtotal := v_item_subtotal + extra_row.amount;
  end loop;

  v_item_subtotal := round(v_item_subtotal, 2);
  v_parts_subtotal := round(v_parts_subtotal, 2);
  -- Job total_cost already includes VAT. Invoice line items remain pre-VAT;
  -- calculate the invoice VAT once from the parts subtotal below.
  v_subtotal := v_item_subtotal;
  if v_subtotal <= 0 then
    raise exception 'A linked invoice requires a positive repair-job subtotal';
  end if;

  if invoice_exists then
    v_discount := coalesce(invoice_row.discount, 0);
    v_vat_rate := coalesce(invoice_row.vat_rate, 0);
  else
    v_discount := 0;
    v_vat_rate := coalesce(job_row.vat_rate, 0);
  end if;
  if v_discount < 0 or v_discount >= v_subtotal or v_vat_rate < 0 or v_vat_rate > 100
    or v_parts_subtotal < 0 or v_parts_subtotal > v_subtotal then
    raise exception 'The repair-job total is incompatible with the linked invoice discount or VAT values';
  end if;

  v_invoice_total := round(
    v_subtotal - v_discount + greatest(0, v_parts_subtotal - v_discount) * v_vat_rate / 100,
    2
  );
  select least(v_invoice_total, round(
    coalesce((
      select sum(payment.amount)
      from public.repair_job_payments payment
      where payment.repair_job_id = job_row.id
        and payment.voided_at is null
    ), 0)
    + coalesce((
      select sum(payment.amount)
      from public.invoice_payments payment
      where payment.invoice_id = invoice_row.id
    ), 0),
    2
  )) into v_paid_total;

  if invoice_exists then
    update public.invoices
    set items = v_invoice_items,
        subtotal = v_subtotal,
        vat_base = v_parts_subtotal,
        vat_rate = v_vat_rate,
        total = v_invoice_total,
        amount_paid = v_paid_total,
        status = case
          when v_paid_total >= v_invoice_total - 0.005 then 'paid'
          when v_paid_total > 0 then 'partially_paid'
          else 'unpaid'
        end
    where id = invoice_row.id;
  else
    select * into customer_row
    from public.customers
    where id = job_row.customer_id;
    if not found then
      raise exception 'The job card customer could not be loaded for invoice creation';
    end if;

    insert into public.invoices (
      repair_job_id, customer_id, customer_name, customer_phone, customer_email,
      reference, items, discount, vat_rate, subtotal, total, notes, due_date,
      status, amount_paid, vat_base
    ) values (
      job_row.id, job_row.customer_id, customer_row.full_name, customer_row.phone, customer_row.email,
      coalesce(nullif(btrim(job_row.cro_number), ''), 'JC-' || lpad(job_row.job_number::text, 5, '0')),
      v_invoice_items, v_discount, v_vat_rate, v_subtotal, v_invoice_total,
      'Automatically created when the vehicle checklist was confirmed',
      current_date + 7,
      case
        when v_paid_total >= v_invoice_total - 0.005 then 'paid'
        when v_paid_total > 0 then 'partially_paid'
        else 'unpaid'
      end,
      v_paid_total, v_parts_subtotal
    )
    returning * into invoice_row;
  end if;
end;
$function$


CREATE OR REPLACE FUNCTION public.link_draft_job_card_to_checklist(p_job_id uuid, p_checklist_number bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
                                                                                                                        declare
                                                                                                                          v_report public.job_condition_reports%rowtype;
                                                                                                                            v_job public.repair_jobs%rowtype;
                                                                                                                            begin
                                                                                                                              if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
                                                                                                                                  raise exception 'Staff access is required to link a vehicle checklist';
                                                                                                                                    end if;

                                                                                                                                      select * into v_job from public.repair_jobs where id = p_job_id for update;
                                                                                                                                        if not found then raise exception 'Job card not found'; end if;
                                                                                                                                          if v_job.status <> 'Draft' then raise exception 'Only draft job cards can be linked from here'; end if;

                                                                                                                                            select * into v_report from public.job_condition_reports where checklist_number = p_checklist_number;
                                                                                                                                              if not found then raise exception 'No checklist found with number %', p_checklist_number; end if;

                                                                                                                                                perform public.link_vehicle_condition_checklist(v_report.id, p_job_id);

                                                                                                                                                  update public.repair_jobs set status = 'Received' where id = p_job_id;

  perform public.sync_repair_job_invoice(p_job_id);
                                                                                                                                                  end;
                                                                                                                                                  $function$


revoke all on function public.record_quotation_deposit(uuid, numeric, text, date, text, uuid) from public, anon;
grant execute on function public.record_quotation_deposit(uuid, numeric, text, date, text, uuid) to authenticated;

revoke all on function public.sync_repair_job_invoice(uuid) from public, anon;
grant execute on function public.sync_repair_job_invoice(uuid) to authenticated;

revoke all on function public.link_draft_job_card_to_checklist(uuid, bigint) from public, anon;
grant execute on function public.link_draft_job_card_to_checklist(uuid, bigint) to authenticated;
