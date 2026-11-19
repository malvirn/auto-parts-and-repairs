with eligible_jobs as (
  select
    job.id as repair_job_id,
    job.customer_id,
    customer.full_name as customer_name,
    customer.phone as customer_phone,
    customer.email as customer_email,
    coalesce(nullif(btrim(job.cro_number), ''), 'JC-' || lpad(job.job_number::text, 5, '0')) as reference,
    coalesce(parts.items, '[]'::jsonb)
      || case when coalesce(job.labour_cost, 0) > 0 then
        jsonb_build_array(jsonb_build_object(
          'd', coalesce(nullif(btrim(job.job_description), ''), 'Labour'),
          'q', 1,
          'p', job.labour_cost
        ))
      else '[]'::jsonb end
      || coalesce(extras.items, '[]'::jsonb) as items,
    round(coalesce(parts.parts_subtotal, 0) + coalesce(job.labour_cost, 0) + coalesce(extras.extras_subtotal, 0), 2) as subtotal,
    round(coalesce(parts.parts_subtotal, 0), 2) as vat_base,
    coalesce(job.vat_rate, 0) as vat_rate,
    coalesce(payments.cash_paid, 0) + coalesce(credits.credit_applied, 0) as covered_amount
  from public.repair_jobs job
  join public.customers customer on customer.id = job.customer_id
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'd', coalesce(nullif(btrim(part.description), ''), nullif(btrim(job_part.part_name), ''), 'Part'),
        'q', job_part.quantity,
        'p', coalesce(job_part.price_at_time, 0)
      ) order by job_part.id) as items,
      sum(job_part.quantity * coalesce(job_part.price_at_time, 0)) as parts_subtotal
    from public.job_parts job_part
    left join public.parts part on part.id = job_part.part_id
    where job_part.job_id = job.id
  ) parts on true
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'd', coalesce(nullif(btrim(incident.description), ''), 'Additional job cost'),
        'q', 1,
        'p', incident.amount
      ) order by incident.created_at, incident.id) as items,
      sum(incident.amount) as extras_subtotal
    from public.job_incidentals incident
    where incident.job_id = job.id
  ) extras on true
  left join lateral (
    select sum(payment.amount) filter (where payment.voided_at is null) as cash_paid
    from public.repair_job_payments payment
    where payment.repair_job_id = job.id
  ) payments on true
  left join lateral (
    select sum(movement.amount) as credit_applied
    from public.customer_credit_movements movement
    where movement.target_type = 'repair_job'
      and movement.target_id = job.id
      and movement.movement_type = 'application'
      and movement.reversed_at is null
  ) credits on true
  where job.checklist_number is not null
    and exists (
      select 1 from public.job_condition_reports report
      where report.job_id = job.id and report.confirmed_at is not null
    )
    and not exists (
      select 1 from public.invoices invoice
      where invoice.repair_job_id = job.id
    )
),
totals as (
  select
    eligible_jobs.*,
    round(subtotal + greatest(0, vat_base) * vat_rate / 100, 2) as invoice_total
  from eligible_jobs
),
payments_calculated as (
  select
    totals.*,
    least(invoice_total, round(covered_amount, 2)) as amount_paid
  from totals
)
insert into public.invoices (
  repair_job_id, customer_id, customer_name, customer_phone, customer_email,
  reference, items, discount, vat_rate, subtotal, total, notes, due_date,
  status, amount_paid, vat_base
)
select
  repair_job_id, customer_id, customer_name, customer_phone, customer_email,
  reference, items, 0, vat_rate, subtotal, invoice_total,
  'Automatically created when the vehicle checklist was confirmed',
  current_date + 7,
  case
    when amount_paid >= invoice_total - 0.005 then 'paid'
    when amount_paid > 0 then 'partially_paid'
    else 'unpaid'
  end,
  amount_paid, vat_base
from payments_calculated
on conflict (repair_job_id) where repair_job_id is not null do nothing;