begin;

-- A business that is not VAT registered must not have VAT silently added to
-- new quotations or invoices. The UI supplies the registered business rate.
alter table public.quotations alter column vat_rate set default 0;
alter table public.invoices alter column vat_rate set default 0;

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
      job_part_row.quantity, 0, request_row.quoted_unit_cost,
      round(p_selling_price, 2), expected_vat_rate, request_row.supplier_id
    )
    returning * into part_row;
  else
    if job_part_row.quantity <= 0 or job_part_row.quantity <> trunc(job_part_row.quantity) then
      raise exception 'Job-part purchase quantity must be a whole number greater than zero';
    end if;
    update public.parts
    set quantity_in_stock = coalesce(quantity_in_stock, 0) + job_part_row.quantity,
        cost_price = request_row.quoted_unit_cost,
        supplier_id = request_row.supplier_id
    where id = p_existing_part_id
    returning * into part_row;
    if not found then
      raise exception 'The selected inventory part no longer exists';
    end if;
  end if;

  invoice_value := 'JPR-' || upper(substr(replace(request_row.id::text, '-', ''), 1, 12));
  insert into public.restocks(
    part_id, part_name, supplier_id, quantity, unit_cost,
    invoice_number, payment_status, journal_entry_id, purchase_request_id, restocked_at
  )
  values (
    part_row.id, part_row.name, request_row.supplier_id,
    job_part_row.quantity::integer, request_row.quoted_unit_cost,
    invoice_value, 'paid', request_row.release_journal_entry_id,
    request_row.id, now()
  )
  returning id into restock_row_id;

  update public.job_parts
  set part_id = part_row.id
  where id = job_part_row.id;

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

revoke all on function public.receive_job_part_purchase(uuid, uuid, text, numeric, numeric) from public, anon;
grant execute on function public.receive_job_part_purchase(uuid, uuid, text, numeric, numeric) to authenticated;

commit;