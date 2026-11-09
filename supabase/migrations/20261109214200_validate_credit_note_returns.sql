begin;

-- Enforce original-sale quantity limits in the database, not only in the UI.
create or replace function public.issue_credit_note(
  p_receipt_id uuid,
  p_customer_id uuid,
  p_reason text,
  p_refunded boolean,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_amount numeric(12, 2);
  source_job_id uuid;
  source_order_id uuid;
  source_customer_id uuid;
  receipt_voided_at timestamptz;
  sold_quantity numeric(10,2);
  previously_credited_quantity numeric(10,2);
  submitted_quantity numeric(10,2);
  already_credited numeric(12, 2);
  credit_amount numeric(12, 2) := 0;
  note_id uuid;
  note_number bigint;
  item jsonb;
  item_name text;
  item_part_id uuid;
  item_quantity numeric(10, 2);
  item_price numeric(12, 2);
  should_restock boolean;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'You do not have permission to issue credit notes';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one receipt line';
  end if;

  select amount, repair_job_id, sales_order_id, voided_at
  into receipt_amount, source_job_id, source_order_id, receipt_voided_at
  from public.receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'Receipt not found';
  end if;
  if receipt_voided_at is not null then
    raise exception 'A voided receipt cannot receive a new credit note';
  end if;
  if coalesce(p_refunded, false) then
    raise exception 'A credit note does not confirm a cash refund. Record any refund as a separate authorised cash transaction.';
  end if;

  if source_job_id is not null then
    select customer_id into source_customer_id from public.repair_jobs where id = source_job_id;
  elsif source_order_id is not null then
    select customer_id into source_customer_id from public.sales_orders where id = source_order_id;
  end if;
  if p_customer_id is distinct from source_customer_id then
    raise exception 'The credit note customer does not match the original receipt';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_name := nullif(btrim(item->>'part_name'), '');
    item_quantity := (item->>'quantity')::numeric;
    item_price := (item->>'unit_price')::numeric;
    item_part_id := nullif(item->>'part_id', '')::uuid;
    should_restock := coalesce((item->>'restock')::boolean, false);

    if item_name is null or item_quantity is null or item_quantity <= 0
      or item_price is null or item_price < 0 then
      raise exception 'Credit note lines must have a name, positive quantity, and non-negative price';
    end if;
    if should_restock and item_part_id is null then
      raise exception 'A valid inventory part is required to restock a line';
    end if;

    -- Validate each returned part against the quantity actually sold on this
    -- receipt, including quantities already credited on earlier notes.
    if item_part_id is not null then
      if source_job_id is not null then
        select coalesce(sum(quantity), 0) into sold_quantity
        from public.job_parts
        where job_id = source_job_id and part_id = item_part_id;
      elsif source_order_id is not null then
        select coalesce(sum(quantity), 0) into sold_quantity
        from public.sales_order_items
        where sales_order_id = source_order_id and part_id = item_part_id;
      else
        sold_quantity := 0;
      end if;

      select coalesce(sum(note_item.quantity), 0) into previously_credited_quantity
      from public.credit_note_items note_item
      join public.credit_notes note on note.id = note_item.credit_note_id
      where note.receipt_id = p_receipt_id and note_item.part_id = item_part_id;

      select coalesce(sum((submitted.value->>'quantity')::numeric), 0) into submitted_quantity
      from jsonb_array_elements(p_items) as submitted(value)
      where nullif(submitted.value->>'part_id', '')::uuid = item_part_id;

      if sold_quantity <= 0
        or coalesce(previously_credited_quantity, 0) + coalesce(submitted_quantity, 0) > sold_quantity + 0.0001 then
        raise exception 'Credit quantity for % exceeds the quantity originally sold on this receipt', item_name;
      end if;
    end if;

    credit_amount := credit_amount + item_quantity * item_price;
  end loop;

  if credit_amount <= 0 then
    raise exception 'Credit note amount must be greater than zero';
  end if;

  select coalesce(sum(amount), 0) into already_credited
  from public.credit_notes
  where receipt_id = p_receipt_id;

  if credit_amount > receipt_amount - already_credited then
    raise exception 'Credit amount exceeds the uncredited receipt balance';
  end if;

  insert into public.credit_notes (receipt_id, customer_id, reason, refunded, amount, issued_by)
  values (p_receipt_id, p_customer_id, coalesce(p_reason, ''), coalesce(p_refunded, false), credit_amount, auth.uid())
  returning id, credit_note_number into note_id, note_number;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_part_id := nullif(item->>'part_id', '')::uuid;
    item_quantity := (item->>'quantity')::numeric;
    item_price := (item->>'unit_price')::numeric;
    should_restock := coalesce((item->>'restock')::boolean, false);

    insert into public.credit_note_items (credit_note_id, part_id, part_name, quantity, unit_price, restock)
    values (note_id, item_part_id, btrim(item->>'part_name'), item_quantity, item_price, should_restock);

    if should_restock then
      update public.parts
      set quantity_in_stock = quantity_in_stock + item_quantity
      where id = item_part_id;
      if not found then
        raise exception 'Inventory part no longer exists';
      end if;
    end if;
  end loop;

  return jsonb_build_object('credit_note_number', note_number, 'amount', credit_amount);
end;
$$;

revoke all on function public.issue_credit_note(uuid, uuid, text, boolean, jsonb) from public, anon;
grant execute on function public.issue_credit_note(uuid, uuid, text, boolean, jsonb) to authenticated;

commit;
