create or replace function public.apply_quotation_deposits_to_repair_job(
  p_quotation_id uuid,
  p_repair_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quote_row public.quotations%rowtype;
  job_row public.repair_jobs%rowtype;
  deposit_row public.quotation_deposit_receipts%rowtype;
  available_amount numeric(12,2);
  outstanding_amount numeric(12,2);
  paid_amount numeric(12,2);
  applied_amount numeric(12,2) := 0;
  amount_to_apply numeric(12,2);
  application_result jsonb;
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Only authorised staff can apply quotation deposits' using errcode = '42501';
  end if;

  select * into quote_row
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found then raise exception 'Quotation not found'; end if;
  if quote_row.repair_job_id is distinct from p_repair_job_id then
    raise exception 'The quotation is not linked to this job card';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_repair_job_id
  for update;
  if not found then raise exception 'Job card not found'; end if;
  if quote_row.customer_id is null or job_row.customer_id is distinct from quote_row.customer_id then
    raise exception 'The quotation and job card must belong to the same registered customer';
  end if;

  select coalesce(sum(amount), 0)
  into paid_amount
  from public.repair_job_payments
  where repair_job_id = p_repair_job_id and voided_at is null;

  select greatest(
    coalesce(job_row.total_cost, 0)
      - coalesce(paid_amount, 0)
      - coalesce((
          select sum(amount)
          from public.customer_credit_movements
          where target_type = 'repair_job'
            and target_id = p_repair_job_id
            and movement_type = 'application'
            and reversed_at is null
        ), 0),
    0
  )::numeric(12,2)
  into outstanding_amount;

  for deposit_row in
    select receipt.*
    from public.quotation_deposit_receipts receipt
    where receipt.quotation_id = p_quotation_id
    order by receipt.created_at, receipt.id
    for update
  loop
    exit when outstanding_amount <= 0.005;

    select greatest(
      deposit_row.amount - coalesce(sum(movement.amount) filter (where movement.reversed_at is null), 0),
      0
    )::numeric(12,2)
    into available_amount
    from public.customer_credit_movements movement
    where movement.deposit_receipt_id = deposit_row.id;

    if coalesce(available_amount, 0) <= 0.005 then
      continue;
    end if;

    amount_to_apply := least(available_amount, outstanding_amount);
    application_result := public.apply_customer_credit(
      deposit_row.id,
      amount_to_apply,
      'repair_job',
      p_repair_job_id,
      'Quotation deposit automatically applied to its job card',
      gen_random_uuid()
    );
    applied_amount := applied_amount + amount_to_apply;
    outstanding_amount := greatest(outstanding_amount - amount_to_apply, 0);
  end loop;

  return jsonb_build_object('applied_amount', applied_amount);
end;
$$;

revoke all on function public.apply_quotation_deposits_to_repair_job(uuid, uuid) from public, anon;
grant execute on function public.apply_quotation_deposits_to_repair_job(uuid, uuid) to authenticated;
