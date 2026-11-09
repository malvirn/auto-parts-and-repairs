-- Recalculate linked invoice totals when a cumulative job receipt is voided.
create or replace function public.void_business_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  receipt_row public.receipts%rowtype;
  order_row public.sales_orders%rowtype;
  restock_row record;
  reversed_payments integer := 0;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only Accounting-level users and Super Admins can void receipts'
      using errcode = '42501';
  end if;
  if p_receipt_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Choose a receipt and enter a reason for voiding it';
  end if;

  select * into receipt_row
  from public.receipts
  where id = p_receipt_id
  for update;
  if not found then
    raise exception 'Receipt not found';
  end if;
  if receipt_row.voided_at is not null then
    raise exception 'This receipt has already been voided';
  end if;
  if receipt_row.repair_job_id is not null and receipt_row.sales_order_id is not null then
    raise exception 'This receipt is linked to both a job card and a sales order and cannot be safely reversed';
  end if;
  if exists (select 1 from public.credit_notes where receipt_id = receipt_row.id) then
    raise exception 'This receipt has credit notes; resolve them before voiding it';
  end if;

  if receipt_row.repair_job_id is not null then
    perform 1 from public.repair_jobs where id = receipt_row.repair_job_id for update;
    update public.repair_job_payments
    set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where repair_job_id = receipt_row.repair_job_id and voided_at is null;
    get diagnostics reversed_payments = row_count;

    -- Recalculate the linked invoice so its paid amount and balance reflect
    -- the voided job payments rather than leaving the invoice marked as paid.
    perform public.sync_repair_job_invoice(receipt_row.repair_job_id);
  elsif receipt_row.sales_order_id is not null then
    select * into order_row
    from public.sales_orders
    where id = receipt_row.sales_order_id
    for update;
    if not found then
      raise exception 'The sales order linked to this receipt no longer exists';
    end if;
    if order_row.status <> 'Confirmed' then
      raise exception 'Only receipts for confirmed sales orders can be voided';
    end if;
    for restock_row in
      select allocation.part_id, allocation.quantity
      from public.sales_order_stock_allocations allocation
      where allocation.sales_order_id = receipt_row.sales_order_id
      for update
    loop
      if restock_row.quantity > 0 then
        update public.parts
        set quantity_in_stock = coalesce(quantity_in_stock, 0) + restock_row.quantity
        where id = restock_row.part_id;
      end if;
      update public.sales_order_stock_allocations
      set quantity = 0, updated_at = now()
      where sales_order_id = receipt_row.sales_order_id
        and part_id = restock_row.part_id;
    end loop;
    update public.sales_orders
    set status = 'Cancelled', updated_at = now()
    where id = receipt_row.sales_order_id;
  end if;

  update public.receipts
  set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
  where id = receipt_row.id;
  return jsonb_build_object(
    'success', true,
    'receipt_id', receipt_row.id,
    'reversed_job_payments', reversed_payments,
    'cancelled_sales_order_id', receipt_row.sales_order_id
  );
end;
$$;

revoke all on function public.void_business_receipt(uuid, text) from public, anon;
grant execute on function public.void_business_receipt(uuid, text) to authenticated;
