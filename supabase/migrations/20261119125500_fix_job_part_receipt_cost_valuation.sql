begin;

create or replace function public.receive_job_part_purchase(
  p_request_id uuid,
  p_existing_part_id uuid default null,
  p_part_number text default null,
  p_selling_price numeric default null,
  p_vat_rate numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.job_part_purchase_requests%rowtype;
  job_part_row public.job_parts%rowtype;
  part_row public.parts%rowtype;
  part_label text;
  restock_row_id public.restocks.id%type;
  invoice_value text;
  vat_registered_value boolean;
  business_vat_rate numeric(5,2);
  expected_vat_rate numeric(5,2);
  previous_quantity integer;
  previous_cost numeric(12,2);
  received_quantity integer;
  weighted_cost numeric(12,2);
begin
  if coalesce(public.is_operational(), false) is not true then
    raise exception 'Shop access is required to receive job-part purchases';
  end if;

  select coalesce(vat_registered, false), coalesce(vat_rate, 15.5)
  into vat_registered_value, business_vat_rate
  from public.business_settings
  where id = 1;

  expected_vat_rate := case when vat_registered_value then business_vat_rate else 0 end;
  if round(coalesce(p_vat_rate, 0), 2) <> expected_vat_rate then
    raise exception 'Purchase tax rate must match the business VAT registration settings';
  end if;

  select * into request_row
  from public.job_part_purchase_requests
  where id = p_request_id
  for update;
  if not found or request_row.status <> 'paid' then
    raise exception 'Only a purchase with released funds can be received into inventory';
  end if;

  select * into job_part_row
  from public.job_parts
  where id = request_row.job_part_id;
  if not found then
    raise exception 'The original job-card part no longer exists';
  end if;

  if job_part_row.quantity is null
     or job_part_row.quantity <= 0
     or job_part_row.quantity <> trunc(job_part_row.quantity)
     or job_part_row.quantity > 2147483647 then
    raise exception 'Job-part purchase quantity must be a whole number greater than zero';
  end if;
  received_quantity := job_part_row.quantity::integer;

  part_label := btrim(job_part_row.part_name);
  if p_existing_part_id is null then
    if p_selling_price is null or p_selling_price <= 0 then
      raise exception 'Enter a selling price greater than zero for the new stock item';
    end if;
    if round(p_selling_price, 2) <= 0 then
      raise exception 'The selling price must be at least 0.01';
    end if;

    insert into public.parts(
      name, part_number, description, category, quantity_in_stock,
      minimum_stock, cost_price, selling_price, vat_rate, supplier_id
    )
    values (
      part_label, nullif(btrim(p_part_number), ''), part_label, 'Other',
      received_quantity, 0, request_row.quoted_unit_cost,
      round(p_selling_price, 2), expected_vat_rate, request_row.supplier_id
    )
    returning * into part_row;
  else
    select * into part_row
    from public.parts
    where id = p_existing_part_id
    for update;
    if not found then
      raise exception 'The selected inventory part no longer exists';
    end if;

    previous_quantity := coalesce(part_row.quantity_in_stock, 0);
    previous_cost := coalesce(part_row.cost_price, 0);
    if previous_quantity < 0 then
      raise exception 'The selected inventory part has a negative stock balance';
    end if;
    if previous_quantity > 0 and previous_cost <= 0 then
      raise exception 'Set a valid cost price for the existing stock before receiving this purchase';
    end if;

    weighted_cost := round(
      ((previous_quantity * previous_cost)
        + (received_quantity * request_row.quoted_unit_cost))
      / (previous_quantity + received_quantity),
      2
    );

    update public.parts
    set quantity_in_stock = previous_quantity + received_quantity,
        cost_price = weighted_cost,
        supplier_id = request_row.supplier_id
    where id = p_existing_part_id
    returning * into part_row;
  end if;

  invoice_value := 'JPR-' || upper(substr(replace(request_row.id::text, '-', ''), 1, 12));
  insert into public.restocks(
    part_id, part_name, supplier_id, quantity, unit_cost,
    invoice_number, payment_status, journal_entry_id, purchase_request_id, restocked_at
  )
  values (
    part_row.id, part_row.name, request_row.supplier_id,
    received_quantity, request_row.quoted_unit_cost,
    invoice_value, 'paid', request_row.release_journal_entry_id,
    request_row.id, now()
  )
  returning id into restock_row_id;

  -- The purchase is received for a specific job card. Linking the stock item
  -- posts its weighted-average cost to COGS, then the same units are relieved
  -- from physical stock in this transaction.
  update public.job_parts
  set part_id = part_row.id
  where id = job_part_row.id;

  update public.parts
  set quantity_in_stock = quantity_in_stock - received_quantity
  where id = part_row.id
    and quantity_in_stock >= received_quantity;
  if not found then
    raise exception 'Received job-part quantity could not be consumed from stock';
  end if;

  update public.job_part_purchase_requests
  set status = 'received',
      part_id = part_row.id,
      restock_id = restock_row_id,
      received_at = now(),
      received_by = auth.uid()
  where id = request_row.id;

  return part_row.id;
end;
$$;

commit;
