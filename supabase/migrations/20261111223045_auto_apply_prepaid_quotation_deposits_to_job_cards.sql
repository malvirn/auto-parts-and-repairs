create or replace function public.apply_prepaid_quotation_deposit_to_repair_job(
  p_quotation_id uuid,
  p_repair_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quote_row public.quotations%rowtype;
  job_row public.repair_jobs%rowtype;
  result jsonb;
  customer_code_value text;
  movement_row record;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'Authorised staff access is required to apply a prepaid quotation deposit'
      using errcode = '42501';
  end if;

  select * into quote_row
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found then
    raise exception 'Quotation not found';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_repair_job_id
  for update;
  if not found then
    raise exception 'Job card not found';
  end if;

  if quote_row.repair_job_id is distinct from p_repair_job_id then
    raise exception 'The quotation is not linked to this job card';
  end if;

  if quote_row.customer_id is null
     or job_row.customer_id is distinct from quote_row.customer_id then
    raise exception 'The quotation and job card must belong to the same registered customer';
  end if;

  select coalesce(customer.customer_code, job_row.customer_id::text)
  into customer_code_value
  from public.customers customer
  where customer.id = job_row.customer_id;

  result := public.apply_quotation_deposits_to_repair_job(p_quotation_id, p_repair_job_id);

  for movement_row in
    select movement.id, movement.amount, receipt.credit_note_number
    from public.customer_credit_movements movement
    join public.quotation_deposit_receipts receipt
      on receipt.id = movement.deposit_receipt_id
    where movement.target_type = 'repair_job'
      and movement.target_id = p_repair_job_id
      and movement.movement_type = 'application'
      and movement.reversed_at is null
      and movement.created_by = auth.uid()
      and movement.created_at = transaction_timestamp()
      and movement.reason = 'Quotation deposit automatically applied to its job card'
  loop
    insert into public.customer_credit_redemption_audit(
      customer_id, customer_code, credit_reference, target_type, target_id, amount,
      confirmation_type, confirmed_as, authorised_by, performed_by, source_redemption_id
    ) values (
      job_row.customer_id,
      customer_code_value,
      'QCN-' || lpad(movement_row.credit_note_number::text, 6, '0'),
      'repair_job',
      p_repair_job_id,
      movement_row.amount,
      'prepaid_quotation_deposit',
      'Quotation #' || quote_row.quotation_number::text || ' · prepaid deposit',
      null,
      auth.uid(),
      movement_row.id
    )
    on conflict (source_redemption_id) do nothing;
  end loop;

  return coalesce(result, '{}'::jsonb) ||
    jsonb_build_object('automatic', true, 'quotation_number', quote_row.quotation_number);
end;
$$;

revoke all on function public.apply_prepaid_quotation_deposit_to_repair_job(uuid, uuid)
  from public, anon;
grant execute on function public.apply_prepaid_quotation_deposit_to_repair_job(uuid, uuid)
  to authenticated;
