create or replace function public.record_shop_restock_atomic(
  p_part_id uuid,
  p_supplier_id uuid,
  p_quantity integer,
  p_unit_cost numeric,
  p_payment_status text,
  p_cash_account_id uuid default null,
  p_purchase_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_part public.parts%rowtype;
  v_supplier public.suppliers%rowtype;
  v_inventory_account public.accounts%rowtype;
  v_credit_account public.accounts%rowtype;
  v_restock_id uuid;
  v_journal_entry_id uuid;
  v_invoice_number text;
  v_total numeric(14,2);
  v_new_quantity integer;
  v_new_cost numeric(14,2);
  v_new_selling_price numeric(14,2);
  v_markup_rate numeric;
  v_due_date date;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not coalesce(public.is_accounting_or_above(), false) then
    raise exception 'Accounting permission is required to post a stock purchase' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Purchase quantity must be a whole number greater than zero';
  end if;
  if p_unit_cost is null or p_unit_cost <= 0 then
    raise exception 'Unit cost must be greater than zero';
  end if;
  if p_payment_status not in ('paid', 'on_credit') then
    raise exception 'Payment status must be paid or on_credit';
  end if;
  if p_purchase_date is null then
    raise exception 'Purchase date is required';
  end if;

  select * into v_part
  from public.parts
  where id = p_part_id
  for update;
  if not found then
    raise exception 'The selected stock item no longer exists';
  end if;

  select * into v_supplier
  from public.suppliers
  where id = p_supplier_id;
  if not found then
    raise exception 'The selected supplier no longer exists';
  end if;

  select * into v_inventory_account
  from public.accounts
  where code = '1200' and is_active = true
  limit 1;
  if not found then
    raise exception 'Parts Inventory account (1200) is missing or inactive';
  end if;

  if p_payment_status = 'paid' then
    select * into v_credit_account
    from public.accounts
    where id = p_cash_account_id
      and code in ('1000', '1010')
      and is_active = true;
    if not found then
      raise exception 'Select an active cash or bank account';
    end if;
  else
    select * into v_credit_account
    from public.accounts
    where code = '2000' and is_active = true
    limit 1;
    if not found then
      raise exception 'Accounts Payable account (2000) is missing or inactive';
    end if;
  end if;

  v_total := round(p_quantity * p_unit_cost, 2);
  v_new_quantity := coalesce(v_part.quantity_in_stock, 0) + p_quantity;
  v_new_cost := round(
    ((coalesce(v_part.quantity_in_stock, 0) * coalesce(v_part.cost_price, 0))
      + (p_quantity * p_unit_cost)) / v_new_quantity,
    2
  );
  select coalesce(markup_rate, 0.15) into v_markup_rate
  from public.settings
  order by id
  limit 1;
  v_markup_rate := coalesce(v_markup_rate, 0.15);
  if v_markup_rate < 0 or v_markup_rate > 5 then
    raise exception 'The configured markup rate is outside the supported range';
  end if;
  v_new_selling_price := round(v_new_cost * (1 + v_markup_rate), 2);

  insert into public.restocks(
    part_id, part_name, supplier_id, quantity, unit_cost, payment_status, restocked_at
  )
  values (
    v_part.id, v_part.name, v_supplier.id, p_quantity, p_unit_cost,
    p_payment_status, p_purchase_date::timestamptz
  )
  returning id into v_restock_id;

  v_invoice_number := 'SHOP-' || to_char(p_purchase_date, 'YYYY') || '-'
    || upper(substr(replace(v_restock_id::text, '-', ''), 1, 12));

  insert into public.journal_entries(
    entry_date, reference, description, source_type, source_id, created_by
  )
  values (
    p_purchase_date,
    v_invoice_number,
    'Shop stock purchase from ' || v_supplier.name || ': ' || v_part.name || ' x ' || p_quantity,
    'shop_restock',
    v_restock_id,
    auth.uid()
  )
  returning id into v_journal_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
  values
    (v_journal_entry_id, v_inventory_account.id, v_total, 0, 'Inventory received'),
    (v_journal_entry_id, v_credit_account.id, 0, v_total,
      case when p_payment_status = 'paid' then 'Supplier paid' else 'Supplier payable' end);

  update public.restocks
  set invoice_number = v_invoice_number,
      journal_entry_id = v_journal_entry_id
  where id = v_restock_id;

  if p_payment_status = 'on_credit' then
    v_due_date := p_purchase_date + coalesce(v_supplier.payment_terms_days, 30);
    insert into public.payables(
      supplier_id, bill_number, bill_date, due_date, amount,
      description, journal_entry_id, restock_id
    )
    values (
      v_supplier.id,
      v_invoice_number,
      p_purchase_date,
      v_due_date,
      v_total,
      'Shop stock: ' || v_part.name || ' x ' || p_quantity || ' @ $' || to_char(p_unit_cost, 'FM999999990.00'),
      v_journal_entry_id,
      v_restock_id
    );
  end if;

  update public.parts
  set quantity_in_stock = v_new_quantity,
      cost_price = v_new_cost,
      selling_price = v_new_selling_price
  where id = v_part.id;

  return jsonb_build_object(
    'restock_id', v_restock_id,
    'invoice_number', v_invoice_number,
    'new_quantity', v_new_quantity,
    'new_cost_price', v_new_cost,
    'new_selling_price', v_new_selling_price,
    'total_cost', v_total
  );
end;
$$;

revoke all on function public.record_shop_restock_atomic(uuid, uuid, integer, numeric, text, uuid, date) from public, anon;
grant execute on function public.record_shop_restock_atomic(uuid, uuid, integer, numeric, text, uuid, date) to authenticated;