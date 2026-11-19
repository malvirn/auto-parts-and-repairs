begin;

alter table public.customer_overpayment_credit_job_links
  add column if not exists applied_amount numeric(12,2) not null default 0 check (applied_amount >= 0),
  add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete restrict;

create or replace function public.link_overpayment_credit_to_job(p_credit_note_id uuid, p_repair_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  note_row public.customer_overpayment_credit_notes%rowtype;
  credit_row public.customer_overpayment_credits%rowtype;
  job_row public.repair_jobs%rowtype;
  customer_row public.customers%rowtype;
  original_invoice public.invoices%rowtype;
  link_row public.customer_overpayment_credit_job_links%rowtype;
  cash_liability public.accounts%rowtype;
  receivable public.accounts%rowtype;
  paid_amount numeric(12,2) := 0;
  previously_applied numeric(12,2) := 0;
  amount_to_apply numeric(12,2) := 0;
  journal_id uuid;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can apply customer credit notes';
  end if;

  select * into note_row from public.customer_overpayment_credit_notes where id = p_credit_note_id for update;
  if not found then raise exception 'Credit note not found'; end if;
  select * into credit_row from public.customer_overpayment_credits where id = note_row.overpayment_credit_id for update;
  if not found then raise exception 'Customer credit balance not found'; end if;
  select * into job_row from public.repair_jobs where id = p_repair_job_id for update;
  if not found then raise exception 'Job card not found'; end if;
  select * into customer_row from public.customers where id = job_row.customer_id;
  if not found then raise exception 'The job card customer could not be found'; end if;
  select * into original_invoice from public.invoices where id = note_row.invoice_id;
  if job_row.checklist_number is null then raise exception 'This job card has no checklist number yet'; end if;
  if job_row.customer_id is distinct from note_row.customer_id
    or lower(trim(coalesce(customer_row.full_name,''))) <> lower(trim(coalesce(note_row.customer_name,'')))
    or regexp_replace(coalesce(customer_row.phone,''),'[^0-9]','','g') <> regexp_replace(coalesce(note_row.customer_phone,''),'[^0-9]','','g')
    or lower(trim(coalesce(customer_row.email,''))) <> lower(trim(coalesce(original_invoice.customer_email,''))) then
    raise exception 'Customer details do not match the original credit note';
  end if;

  select * into link_row from public.customer_overpayment_credit_job_links
  where credit_note_id = note_row.id for update;
  if found then
    if link_row.repair_job_id <> job_row.id then
      raise exception 'This credit note is already linked to another job card';
    end if;
    if link_row.applied_amount > 0 then
      return link_row.id;
    end if;
  else
    insert into public.customer_overpayment_credit_job_links(credit_note_id,repair_job_id,linked_by)
    values(note_row.id,job_row.id,auth.uid()) returning * into link_row;
  end if;

  if coalesce(credit_row.available_amount,0) <= 0.005 then
    raise exception 'This credit note has no remaining balance';
  end if;

  select coalesce(sum(payment.amount),0) into paid_amount
  from public.repair_job_payments payment
  where payment.repair_job_id = job_row.id and payment.voided_at is null;
  paid_amount := paid_amount + coalesce((
    select sum(payment.amount)
    from public.invoices invoice
    join public.invoice_payments payment on payment.invoice_id = invoice.id
    where invoice.repair_job_id = job_row.id
  ),0);
  select coalesce(sum(amount),0) into previously_applied
  from public.customer_credit_movements
  where target_type='repair_job' and target_id=job_row.id
    and movement_type='application' and reversed_at is null;
  previously_applied := previously_applied + coalesce((
    select sum(applied_amount) from public.customer_overpayment_credit_job_links
    where repair_job_id=job_row.id and id<>link_row.id
  ),0);

  amount_to_apply := least(
    round(credit_row.available_amount,2),
    greatest(round(coalesce(job_row.total_cost,0)-coalesce(paid_amount,0)-coalesce(previously_applied,0),2),0)
  );
  if amount_to_apply <= 0.005 then
    raise exception 'This job card has no outstanding balance for this credit note';
  end if;

  select * into cash_liability from public.accounts where code='2300' and is_active and type='liability';
  select * into receivable from public.accounts where code='1100' and is_active and type='asset';
  if cash_liability.id is null or receivable.id is null then
    raise exception 'Customer Credit Liability (2300) or Accounts Receivable (1100) is missing or inactive';
  end if;

  insert into public.journal_entries(entry_date,reference,description,source_type,source_id,created_by)
  values((now() at time zone 'Africa/Harare')::date,
    'OCAPP-'||lpad(note_row.note_number::text,5,'0'),
    'Customer overpayment credit applied to repair job '||coalesce(job_row.cro_number,job_row.job_number::text),
    'customer_overpayment_credit_application',note_row.id,auth.uid())
  returning id into journal_id;
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo)
  values(journal_id,cash_liability.id,amount_to_apply,0,'Release customer credit liability'),
        (journal_id,receivable.id,0,amount_to_apply,'Apply customer credit to repair job');

  update public.customer_overpayment_credits
  set available_amount=round(available_amount-amount_to_apply,2)
  where id=credit_row.id;
  update public.customer_overpayment_credit_job_links
  set applied_amount=amount_to_apply,journal_entry_id=journal_id,linked_by=auth.uid(),linked_at=now()
  where id=link_row.id;
  return link_row.id;
end;
$$;

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
  select repair_job_id, sum(applied_amount) as applied_amount
  from (
    select target_id as repair_job_id, amount as applied_amount
    from public.customer_credit_movements
    where movement_type = 'application' and target_type = 'repair_job' and reversed_at is null
    union all
    select repair_job_id, applied_amount
    from public.customer_overpayment_credit_job_links
    where applied_amount > 0
  ) applied_repair_credits
  group by repair_job_id
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
revoke all on function public.link_overpayment_credit_to_job(uuid,uuid) from public, anon;
grant execute on function public.link_overpayment_credit_to_job(uuid,uuid) to authenticated;

commit;
