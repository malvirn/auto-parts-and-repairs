-- Ensure Quick Sale payment rows populate the required tender snapshot columns.
-- The current Quick Sale form accepts USD payments; ZiG tender entry is handled separately.
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
      sales_order_id, amount, payment_method, payment_date, journal_entry_id, created_by,
      tender_amount, currency_code, exchange_rate_to_usd, payment_account_id
    )
    values (
      order_row.id, order_row.total_usd, order_row.payment_method, p_payment_date, entry_id, auth.uid(),
      order_row.total_usd, 'USD', 1, debit_account_id
    );
  end if;

  return entry_id;
end;
$$;
