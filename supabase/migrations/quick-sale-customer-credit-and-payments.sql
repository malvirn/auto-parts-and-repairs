begin;

alter table public.sales_orders
  alter column customer_id drop not null,
  add column if not exists walk_in_name text,
  add column if not exists salesperson_id uuid;

alter table public.sales_orders
  drop constraint if exists sales_orders_payment_method_check;
alter table public.sales_orders
  add constraint sales_orders_payment_method_check
  check (payment_method is null or payment_method in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit'));

do $$
begin
  if exists (
    select 1 from public.accounts
    where code = '1020'
      and (name <> 'EcoCash' or type <> 'asset' or normal_balance <> 'debit')
  ) then
    raise exception 'Account code 1020 is already assigned to another account; assign EcoCash a different code before applying this migration';
  end if;
end;
$$;

insert into public.accounts (code, name, type, normal_balance, is_active)
values ('1020', 'EcoCash', 'asset', 'debit', true)
on conflict (code) do update set is_active = true;

create table if not exists public.quick_sale_payments (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('Cash', 'EcoCash', 'Bank', 'Swipe')),
  payment_date date not null,
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists quick_sale_payments_order_date_idx
  on public.quick_sale_payments(sales_order_id, payment_date, created_at);

alter table public.quick_sale_payments enable row level security;
revoke all on public.quick_sale_payments from public, anon, authenticated;
grant select on public.quick_sale_payments to authenticated;

drop policy if exists "Accounting users can view quick sale payments" on public.quick_sale_payments;
create policy "Accounting users can view quick sale payments"
  on public.quick_sale_payments for select
  to authenticated
  using (public.current_access_level() >= 2);

create table if not exists public.quick_sale_order_postings (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null unique references public.sales_orders(id) on delete cascade,
  journal_entry_id uuid not null unique references public.journal_entries(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.quick_sale_order_postings enable row level security;
revoke all on public.quick_sale_order_postings from public, anon, authenticated;
grant select on public.quick_sale_order_postings to authenticated;

drop policy if exists "Accounting users can view quick sale order postings" on public.quick_sale_order_postings;
create policy "Accounting users can view quick sale order postings"
  on public.quick_sale_order_postings for select
  to authenticated
  using (public.current_access_level() >= 2);

create table if not exists public.quick_sale_journal_reversals (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  original_entry_id uuid not null unique references public.journal_entries(id) on delete restrict,
  reversal_entry_id uuid not null unique references public.journal_entries(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.quick_sale_journal_reversals enable row level security;
revoke all on public.quick_sale_journal_reversals from public, anon, authenticated;
grant select on public.quick_sale_journal_reversals to authenticated;

drop policy if exists "Accounting users can view quick sale journal reversals" on public.quick_sale_journal_reversals;
create policy "Accounting users can view quick sale journal reversals"
  on public.quick_sale_journal_reversals for select
  to authenticated
  using (public.current_access_level() >= 2);

create or replace function public.reverse_cancelled_quick_sale()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  source_entry record;
  reversal_id uuid;
begin
  if old.status = 'Confirmed' and new.status = 'Cancelled' then
    for source_entry in
      select posting.journal_entry_id
      from public.quick_sale_order_postings posting
      where posting.sales_order_id = new.id
      union
      select payment.journal_entry_id
      from public.quick_sale_payments payment
      where payment.sales_order_id = new.id
    loop
      if exists (
        select 1 from public.quick_sale_journal_reversals
        where original_entry_id = source_entry.journal_entry_id
      ) then
        continue;
      end if;

      insert into public.journal_entries (entry_date, reference, description, source_type)
      values (
        (now() at time zone 'Africa/Harare')::date,
        'REV-SO-' || new.order_number || '-' || source_entry.journal_entry_id,
        'Reversal · Cancelled Quick Sale Order ' || new.order_number,
        'quick_sale_reversal'
      )
      returning id into reversal_id;

      insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
      select reversal_id, account_id, credit, debit
      from public.journal_lines
      where journal_entry_id = source_entry.journal_entry_id;

      insert into public.quick_sale_journal_reversals (
        sales_order_id, original_entry_id, reversal_entry_id
      )
      values (new.id, source_entry.journal_entry_id, reversal_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists reverse_cancelled_quick_sale on public.sales_orders;
create trigger reverse_cancelled_quick_sale
  after update of status on public.sales_orders
  for each row
  execute function public.reverse_cancelled_quick_sale();

create or replace function public.post_quick_sale_order(
  p_sales_order_id uuid,
  p_payment_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row public.sales_orders%rowtype;
  entry_id uuid;
  debit_account_id uuid;
  revenue_account_id uuid;
  method_account_code text;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised sales users can post Quick Sales';
  end if;
  if p_payment_date is null then
    raise exception 'Sale date is required';
  end if;

  select * into order_row
  from public.sales_orders
  where id = p_sales_order_id
  for update;
  if not found or order_row.status <> 'Confirmed' then
    raise exception 'Confirmed Quick Sale order not found';
  end if;
  if order_row.payment_method is null or order_row.payment_method not in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit') then
    raise exception 'Choose a supported Quick Sale payment method';
  end if;
  if order_row.total_usd is null or order_row.total_usd <= 0 then
    raise exception 'Quick Sale total must be greater than zero';
  end if;
  if order_row.payment_method = 'Credit' and order_row.customer_id is null then
    raise exception 'Credit sales require a registered customer';
  end if;
  if order_row.payment_method = 'Credit' and not exists (
    select 1 from public.customers
    where id = order_row.customer_id and deleted_at is null
  ) then
    raise exception 'Credit sales require an active registered customer';
  end if;
  if exists (select 1 from public.quick_sale_order_postings where sales_order_id = order_row.id) then
    raise exception 'This Quick Sale has already been posted';
  end if;

  select id into revenue_account_id
  from public.accounts
  where code = '4100' and is_active = true;
  if revenue_account_id is null then
    raise exception 'Parts Sales Revenue account (4100) is missing or inactive';
  end if;

  if order_row.payment_method = 'Credit' then
    select id into debit_account_id
    from public.accounts
    where code = '1100' and is_active = true;
    if debit_account_id is null then
      raise exception 'Accounts Receivable account (1100) is missing or inactive';
    end if;
  else
    method_account_code := case order_row.payment_method
      when 'Cash' then '1000'
      when 'EcoCash' then '1020'
      when 'Bank' then '1010'
      when 'Swipe' then '1010'
    end;
    select id into debit_account_id
    from public.accounts
    where code = method_account_code and is_active = true;
    if debit_account_id is null then
      raise exception 'The account for payment method % is missing or inactive', order_row.payment_method;
    end if;
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    p_payment_date,
    'SO-' || order_row.order_number,
    'Quick Sale · Order ' || order_row.order_number,
    'quick_sale'
  )
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values
    (entry_id, debit_account_id, order_row.total_usd, 0),
    (entry_id, revenue_account_id, 0, order_row.total_usd);

  if order_row.payment_method <> 'Credit' then
    insert into public.receipts (sales_order_id, amount)
    values (order_row.id, order_row.total_usd);
  end if;

  insert into public.quick_sale_order_postings (sales_order_id, journal_entry_id)
  values (order_row.id, entry_id);

  if order_row.payment_method <> 'Credit' then
    insert into public.quick_sale_payments (
      sales_order_id, amount, payment_method, payment_date, journal_entry_id, created_by
    )
    values (
      order_row.id, order_row.total_usd, order_row.payment_method, p_payment_date, entry_id, auth.uid()
    );
  end if;

  return entry_id;
end;
$$;

create or replace function public.record_quick_sale_payment(
  p_sales_order_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row public.sales_orders%rowtype;
  entry_id uuid;
  payment_account_id uuid;
  receivable_account_id uuid;
  already_paid numeric(12, 2);
  receipt_paid numeric(12, 2);
  balance_due numeric(12, 2);
  account_code text;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can record Quick Sale payments';
  end if;
  if p_amount is null or p_amount <= 0 or p_payment_date is null then
    raise exception 'Enter a positive payment amount and payment date';
  end if;
  if p_payment_method is null or p_payment_method not in ('Cash', 'EcoCash', 'Bank') then
    raise exception 'Choose Cash, EcoCash or Bank';
  end if;

  select * into order_row
  from public.sales_orders
  where id = p_sales_order_id
  for update;
  if not found or order_row.customer_id is null or order_row.status <> 'Confirmed' then
    raise exception 'Registered customer Quick Sale not found';
  end if;
  if not exists (select 1 from public.quick_sale_order_postings where sales_order_id = order_row.id) then
    raise exception 'The Quick Sale has not been posted to the ledger';
  end if;

  select coalesce(sum(amount), 0) into already_paid
  from public.quick_sale_payments
  where sales_order_id = order_row.id;
  select coalesce(max(amount), 0) into receipt_paid
  from public.receipts
  where sales_order_id = order_row.id and voided_at is null;
  balance_due := round(order_row.total_usd - greatest(already_paid, receipt_paid), 2);
  if p_amount > balance_due + 0.005 then
    raise exception 'Payment exceeds the outstanding balance of %', greatest(balance_due, 0);
  end if;

  account_code := case p_payment_method
    when 'Cash' then '1000'
    when 'EcoCash' then '1020'
    when 'Bank' then '1010'
  end;
  select id into payment_account_id
  from public.accounts
  where code = account_code and is_active = true;
  if payment_account_id is null then
    raise exception 'The account for payment method % is missing or inactive', p_payment_method;
  end if;
  select id into receivable_account_id
  from public.accounts
  where code = '1100' and is_active = true;
  if receivable_account_id is null then
    raise exception 'Accounts Receivable account (1100) is missing or inactive';
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    p_payment_date,
    'SO-' || order_row.order_number,
    'Quick Sale payment · Order ' || order_row.order_number,
    'quick_sale_payment'
  )
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values
    (entry_id, payment_account_id, p_amount, 0),
    (entry_id, receivable_account_id, 0, p_amount);

  insert into public.quick_sale_payments (
    sales_order_id, amount, payment_method, payment_date, journal_entry_id, created_by
  )
  values (
    order_row.id, round(p_amount, 2), p_payment_method, p_payment_date, entry_id, auth.uid()
  );
  return entry_id;
end;
$$;

revoke all on function public.post_quick_sale_order(uuid, date) from public, anon;
revoke all on function public.record_quick_sale_payment(uuid, numeric, text, date) from public, anon;
grant execute on function public.post_quick_sale_order(uuid, date) to authenticated;
grant execute on function public.record_quick_sale_payment(uuid, numeric, text, date) to authenticated;

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
  coalesce(rp.paid_amount, 0)::numeric(12, 2) as amount_paid,
  (coalesce(j.total_cost, 0) - coalesce(rp.paid_amount, 0))::numeric(12, 2) as balance_due,
  0::numeric(12, 2) as discount_amount, null::text as payment_method, false as can_record_payment
from public.repair_jobs j
join public.customers c on c.id = j.customer_id
left join repair_payment_totals rp on rp.repair_job_id = j.id
where coalesce(j.total_cost, 0) > 0
  and (j.status::text in ('Ready for Pickup', 'Unclaimed', 'Collected', 'Processed') or rp.repair_job_id is not null)

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
  coalesce(payments.paid_amount, 0)::numeric(12, 2),
  (coalesce(invoice.total, 0) - coalesce(payments.paid_amount, 0))::numeric(12, 2),
  0::numeric(12, 2), null::text, false
from public.invoices invoice
join public.customers c on c.id = invoice.customer_id
left join invoice_payment_totals payments on payments.invoice_id = invoice.id
where coalesce(invoice.total, 0) > 0;

alter table public.repair_job_payments
  drop constraint if exists repair_job_payments_payment_method_check;
alter table public.repair_job_payments
  add constraint repair_job_payments_payment_method_check
  check (payment_method in ('Cash', 'Card', 'Bank transfer', 'EcoCash', 'Mobile money', 'Other'));

commit;
