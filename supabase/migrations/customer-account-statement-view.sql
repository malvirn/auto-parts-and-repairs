begin;

create or replace view public.customer_account_statement
with (security_invoker = true)
as
with repair_payment_totals as (
  select repair_job_id, sum(amount) as paid_amount
  from public.repair_job_payments
  group by repair_job_id
),
sales_receipt_totals as (
  select sales_order_id, max(amount) as paid_amount
  from public.receipts
  where sales_order_id is not null
  group by sales_order_id
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
  and coalesce(so.total_usd, 0) > 0;

revoke all on public.customer_account_statement from public;
revoke all on public.customer_account_statement from anon;
grant select on public.customer_account_statement to authenticated;

commit;