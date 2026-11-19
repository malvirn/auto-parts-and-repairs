begin;

create or replace function public.edit_customer_invoice(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_items jsonb,
  p_discount numeric,
  p_vat_rate numeric,
  p_due_date date,
  p_reference text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  invoice_row public.invoices%rowtype;
  item_row jsonb;
  item_name text;
  quantity numeric;
  unit_price numeric;
  new_subtotal numeric(12, 2) := 0;
  new_discount numeric(12, 2);
  new_vat numeric(12, 2);
  new_total numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can edit customer invoices'
      using errcode = '42501';
  end if;

  if p_invoice_id is null or nullif(btrim(p_customer_name), '') is null then
    raise exception 'Choose an invoice and enter a customer name';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An invoice must contain at least one item';
  end if;
  if p_discount is null or p_discount < 0 or p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
    raise exception 'Discount and VAT values are invalid';
  end if;

  select * into invoice_row
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Customer invoice not found';
  end if;

  for item_row in select value from jsonb_array_elements(p_items) as items(value)
  loop
    item_name := nullif(btrim(item_row ->> 'd'), '');
    if item_name is null
      or coalesce(jsonb_typeof(item_row -> 'q'), '') <> 'number'
      or coalesce(jsonb_typeof(item_row -> 'p'), '') <> 'number' then
      raise exception 'Each invoice item needs a description, quantity, and price';
    end if;

    quantity := (item_row ->> 'q')::numeric;
    unit_price := (item_row ->> 'p')::numeric;
    if quantity <= 0 or unit_price < 0 then
      raise exception 'Item quantities must be positive and prices cannot be negative';
    end if;

    new_subtotal := new_subtotal + quantity * unit_price;
  end loop;

  new_subtotal := round(new_subtotal, 2);
  new_discount := least(round(p_discount, 2), new_subtotal);
  new_vat := round((new_subtotal - new_discount) * round(p_vat_rate, 2) / 100, 2);
  new_total := round(new_subtotal - new_discount + new_vat, 2);

  if coalesce(invoice_row.amount_paid, 0) > new_total + 0.005 then
    raise exception 'Invoice total cannot be lower than the amount already paid (%)', invoice_row.amount_paid;
  end if;

  update public.invoices
  set customer_id = p_customer_id,
      customer_name = btrim(p_customer_name),
      customer_phone = nullif(btrim(coalesce(p_customer_phone, '')), ''),
      customer_email = nullif(btrim(coalesce(p_customer_email, '')), ''),
      items = p_items,
      discount = new_discount,
      vat_rate = round(p_vat_rate, 2),
      subtotal = new_subtotal,
      total = new_total,
      due_date = p_due_date,
      reference = nullif(btrim(coalesce(p_reference, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      status = case
        when coalesce(invoice_row.amount_paid, 0) >= new_total - 0.005 then 'paid'
        when coalesce(invoice_row.amount_paid, 0) > 0 then 'partially_paid'
        else 'unpaid'
      end
  where id = invoice_row.id;
end;
$$;

revoke all on function public.edit_customer_invoice(uuid, uuid, text, text, text, jsonb, numeric, numeric, date, text, text) from public, anon;
grant execute on function public.edit_customer_invoice(uuid, uuid, text, text, text, jsonb, numeric, numeric, date, text, text) to authenticated;

create or replace function public.edit_business_receipt(
  p_receipt_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  receipt_row public.receipts%rowtype;
  payment_row public.repair_job_payments%rowtype;
  current_total numeric(12, 2);
  target_total numeric(12, 2);
  remaining numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised users can correct receipts'
      using errcode = '42501';
  end if;

  if p_receipt_id is null or p_amount is null then
    raise exception 'Choose a receipt and enter a valid amount';
  end if;
  target_total := round(p_amount, 2);
  if target_total <= 0 then
    raise exception 'Receipt amount must be greater than zero';
  end if;

  select * into receipt_row
  from public.receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Receipt not found';
  end if;
  if receipt_row.repair_job_id is not null and receipt_row.sales_order_id is not null then
    raise exception 'This receipt is linked to both a job card and a sales order and cannot be safely corrected';
  end if;

  if receipt_row.repair_job_id is not null then
    perform 1 from public.repair_jobs where id = receipt_row.repair_job_id for update;
    select coalesce(sum(amount), 0)::numeric(12, 2)
    into current_total
    from public.repair_job_payments
    where repair_job_id = receipt_row.repair_job_id;

    if target_total < current_total then
      remaining := current_total - target_total;
      for payment_row in
        select * from public.repair_job_payments
        where repair_job_id = receipt_row.repair_job_id
        order by paid_at desc, created_at desc, id desc
        for update
      loop
        exit when remaining <= 0;
        if payment_row.amount <= remaining then
          delete from public.repair_job_payments where id = payment_row.id;
          remaining := remaining - payment_row.amount;
        else
          update public.repair_job_payments
          set amount = round(payment_row.amount - remaining, 2)
          where id = payment_row.id;
          remaining := 0;
        end if;
      end loop;
      if remaining > 0.005 then
        raise exception 'The linked job-card payment history changed while correcting this receipt';
      end if;
    elsif target_total > current_total then
      remaining := target_total - current_total;
      select * into payment_row
      from public.repair_job_payments
      where repair_job_id = receipt_row.repair_job_id
      order by paid_at desc, created_at desc, id desc
      limit 1
      for update;
      if found then
        update public.repair_job_payments
        set amount = round(payment_row.amount + remaining, 2)
        where id = payment_row.id;
      else
        insert into public.repair_job_payments (repair_job_id, amount, payment_method)
        values (receipt_row.repair_job_id, target_total, 'Other');
      end if;
    end if;
  end if;

  update public.receipts
  set amount = target_total
  where id = receipt_row.id;
end;
$$;

revoke all on function public.edit_business_receipt(uuid, numeric) from public, anon;
grant execute on function public.edit_business_receipt(uuid, numeric) to authenticated;

commit;
