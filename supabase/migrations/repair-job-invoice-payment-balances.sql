begin;

create or replace view public.customer_account_statement
with (security_invoker = true)
as
with repair_payment_totals as (
  select repair_job_id, sum(amount) as paid_amount
  from public.repair_job_payments
  where voided_at is null
  group by repair_job_id
),
repair_invoice_totals as (
  select repair_job_id, max(amount_paid) as paid_amount
  from public.invoices
  where repair_job_id is not null
  group by repair_job_id
),
sales_receipt_totals as (
  select sales_order_id, max(amount) as paid_amount
  from public.receipts
  where sales_order_id is not null and voided_at is null
  group by sales_order_id
),
quick_sale_payment_totals as (
  select sales_order_id, sum(amount) as paid_amount,
         string_agg(distinct payment_method, ', ' order by payment_method) as payment_methods
  from public.quick_sale_payments
  group by sales_order_id
),
invoice_payment_totals as (
  select invoice_id, sum(amount) as paid_amount
  from public.invoice_payments
  group by invoice_id
)
select
  c.id as customer_id, c.full_name as customer_name, c.phone, c.email,
  j.id as source_id, 'Repair job'::text as source_type,
  coalesce(j.cro_number, 'Job #' || lpad(j.job_number::text, 4, '0')) as reference,
  j.created_at::date as entry_date,
  coalesce(j.total_cost, 0)::numeric(12, 2) as total_amount,
  greatest(coalesce(rp.paid_amount, 0), coalesce(ri.paid_amount, 0))::numeric(12, 2) as amount_paid,
  (coalesce(j.total_cost, 0) - greatest(coalesce(rp.paid_amount, 0), coalesce(ri.paid_amount, 0)))::numeric(12, 2) as balance_due,
  0::numeric(12, 2) as discount_amount, null::text as payment_method, false as can_record_payment
from public.repair_jobs j
join public.customers c on c.id = j.customer_id
left join repair_payment_totals rp on rp.repair_job_id = j.id
left join repair_invoice_totals ri on ri.repair_job_id = j.id
where coalesce(j.total_cost, 0) > 0
  and (
    j.status::text in ('Ready for Pickup', 'Unclaimed', 'Collected', 'Processed')
    or rp.repair_job_id is not null
    or ri.repair_job_id is not null
  )

union all

select
  c.id, c.full_name, c.phone, c.email,
  so.id, 'Sales order'::text,
  'Order #' || lpad(so.order_number::text, 4, '0'),
  so.created_at::date,
  coalesce(so.total_usd, 0)::numeric(12, 2),
  coalesce(qp.paid_amount, sr.paid_amount, 0)::numeric(12, 2),
  (coalesce(so.total_usd, 0) - coalesce(qp.paid_amount, sr.paid_amount, 0))::numeric(12, 2),
  coalesce(so.discount_usd, 0)::numeric(12, 2),
  coalesce(qp.payment_methods, so.payment_method),
  exists (select 1 from public.quick_sale_order_postings posting where posting.sales_order_id = so.id)
from public.sales_orders so
join public.customers c on c.id = so.customer_id
left join quick_sale_payment_totals qp on qp.sales_order_id = so.id
left join sales_receipt_totals sr on sr.sales_order_id = so.id
where so.status = 'Confirmed' and coalesce(so.total_usd, 0) > 0

union all

select
  c.id, c.full_name, c.phone, c.email,
  invoice.id, 'Invoice'::text,
  'INV-' || lpad(invoice.invoice_number::text, 5, '0'),
  invoice.issued_at::date,
  coalesce(invoice.total, 0)::numeric(12, 2),
  greatest(coalesce(invoice.amount_paid, 0), coalesce(payments.paid_amount, 0))::numeric(12, 2),
  (coalesce(invoice.total, 0) - greatest(coalesce(invoice.amount_paid, 0), coalesce(payments.paid_amount, 0)))::numeric(12, 2),
  0::numeric(12, 2), null::text, false
from public.invoices invoice
join public.customers c on c.id = invoice.customer_id
left join invoice_payment_totals payments on payments.invoice_id = invoice.id
where coalesce(invoice.total, 0) > 0
  and (
    invoice.repair_job_id is null
    or not exists (
      select 1
      from public.repair_jobs linked_job
      join public.customers linked_customer on linked_customer.id = linked_job.customer_id
      where linked_job.id = invoice.repair_job_id
        and coalesce(linked_job.total_cost, 0) > 0
        and (
          linked_job.status::text in ('Ready for Pickup', 'Unclaimed', 'Collected', 'Processed')
          or exists (
            select 1 from public.repair_job_payments linked_payment
            where linked_payment.repair_job_id = linked_job.id
              and linked_payment.voided_at is null
          )
          or exists (
            select 1 from public.invoices linked_invoice
            where linked_invoice.repair_job_id = linked_job.id
          )
        )
    )
  );

revoke all on public.customer_account_statement from public, anon;
grant select on public.customer_account_statement to authenticated;

commit;
