begin;

do $$
begin
  if exists (
    select 1
    from public.accounts
    where code in ('1000', '1010', '1020', '1100')
      and (type <> 'asset' or normal_balance <> 'debit')
  ) then
    raise exception 'A Quick Sale payment account code (1000, 1010, 1020, or 1100) is assigned to an account with an incompatible type or balance; resolve the chart-of-accounts conflict before enabling Quick Sale';
  end if;
  if exists (
    select 1
    from public.accounts
    where code = '4100'
      and (type <> 'revenue' or normal_balance <> 'credit')
  ) then
    raise exception 'Account code 4100 is assigned to a non-revenue account; resolve the chart-of-accounts conflict before enabling Quick Sale';
  end if;
end;
$$;

insert into public.accounts (code, name, type, normal_balance, is_active)
values
  ('1000', 'Cash on Hand', 'asset', 'debit', true),
  ('1010', 'Bank Account', 'asset', 'debit', true),
  ('1020', 'EcoCash', 'asset', 'debit', true),
  ('1100', 'Accounts Receivable', 'asset', 'debit', true)
on conflict (code) do update set is_active = true;

insert into public.accounts (code, name, type, normal_balance, is_active)
values ('4100', 'Parts Sales Revenue', 'revenue', 'credit', true)
on conflict (code) do update set is_active = true;

create or replace function public.complete_quick_sale(
  p_customer_id uuid,
  p_customer_name text,
  p_salesperson_id uuid,
  p_usd_to_zig_rate numeric,
  p_discount_usd numeric,
  p_payment_method text,
  p_payment_date date,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_id uuid;
  order_number bigint;
  item_count integer;
  subtotal numeric(12, 2);
  discount numeric(12, 2);
  total numeric(12, 2);
  line record;
  consumed_part_id uuid;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised sales users can complete Quick Sales';
  end if;
  if p_payment_date is null then
    raise exception 'Sale date is required';
  end if;
  if p_usd_to_zig_rate is null or p_usd_to_zig_rate <= 0 then
    raise exception 'A valid exchange rate is required';
  end if;
  if p_payment_method is null
    or p_payment_method not in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit') then
    raise exception 'Choose a supported Quick Sale payment method';
  end if;
  if p_payment_method = 'Credit' and (
    p_customer_id is null
    or not exists (
      select 1 from public.customers
      where id = p_customer_id and deleted_at is null
    )
  ) then
    raise exception 'Credit sales require an active registered customer';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers
    where id = p_customer_id and deleted_at is null
  ) then
    raise exception 'The selected customer is no longer active';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the sale';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'A Quick Sale cannot contain more than 100 lines';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(part_id uuid, quantity integer, unit_price_usd numeric)
    where item.part_id is null
      or item.quantity is null
      or item.quantity < 1
      or item.unit_price_usd is null
      or item.unit_price_usd <= 0
      or item.unit_price_usd > 100000000
  ) then
    raise exception 'Each sale line needs a valid product, positive whole quantity, and valid selling price';
  end if;

  select count(*), round(sum(round(item.quantity * item.unit_price_usd, 2)), 2)
  into item_count, subtotal
  from jsonb_to_recordset(p_items) as item(part_id uuid, quantity integer, unit_price_usd numeric);
  if item_count = 0 or subtotal is null or subtotal > 100000000 then
    raise exception 'Sale subtotal is invalid or exceeds the supported limit';
  end if;
  discount := round(coalesce(p_discount_usd, 0), 2);
  if discount < 0 or discount >= subtotal then
    raise exception 'Discount must be zero or more and less than the sale subtotal';
  end if;
  total := round(subtotal - discount, 2);
  if total <= 0 then
    raise exception 'Sale total must be greater than zero';
  end if;

  for line in
    select item.part_id, sum(item.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as item(part_id uuid, quantity integer, unit_price_usd numeric)
    group by item.part_id
    order by item.part_id
  loop
    update public.parts
    set quantity_in_stock = quantity_in_stock - line.quantity
    where id = line.part_id
      and quantity_in_stock >= line.quantity
    returning id into consumed_part_id;
    if not found then
      if not exists (select 1 from public.parts where id = line.part_id) then
        raise exception 'A selected product no longer exists';
      end if;
      raise exception 'Not enough stock for product %', line.part_id;
    end if;
  end loop;

  insert into public.sales_orders as new_order (
    customer_id, walk_in_name, salesperson_id, usd_to_zig_rate,
    total_usd, total_zig, discount_usd, payment_method, status
  )
  values (
    p_customer_id,
    coalesce(nullif(btrim(p_customer_name), ''), 'Walk-in Sale'),
    p_salesperson_id,
    p_usd_to_zig_rate,
    total,
    round(total * p_usd_to_zig_rate, 2),
    discount,
    p_payment_method,
    'Confirmed'
  )
  returning new_order.id, new_order.order_number into order_id, order_number;

  insert into public.sales_order_items (
    sales_order_id, part_id, part_name, quantity,
    unit_price_usd, total_usd, unit_price_zig, total_zig
  )
  select
    order_id,
    item.part_id,
    part.name,
    item.quantity,
    round(item.unit_price_usd, 2),
    round(item.quantity * item.unit_price_usd, 2),
    round(item.unit_price_usd * p_usd_to_zig_rate, 2),
    round(round(item.quantity * item.unit_price_usd, 2) * p_usd_to_zig_rate, 2)
  from jsonb_to_recordset(p_items) as item(part_id uuid, quantity integer, unit_price_usd numeric)
  join public.parts part on part.id = item.part_id;

  perform public.post_quick_sale_order(order_id, p_payment_date);

  return jsonb_build_object('id', order_id, 'order_number', order_number, 'total_usd', total);
end;
$$;

revoke all on function public.complete_quick_sale(uuid, text, uuid, numeric, numeric, text, date, jsonb) from public, anon;
grant execute on function public.complete_quick_sale(uuid, text, uuid, numeric, numeric, text, date, jsonb) to authenticated;

commit;
