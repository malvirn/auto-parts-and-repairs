begin;

-- A typed job part is not a consumed inventory item until the supplier
-- purchase has been received and linked to the job part. Releasing purchase
-- funds debits Parts Inventory and credits Cash/Bank. The
-- post_job_part_inventory_movement trigger then debits COGS and credits
-- inventory when receive_job_part_purchase links the received stock.
--
-- Do not post COGS here as well: doing so records the same purchase cost twice.
-- This function only saves the accountant-approved cost and selling price.

create or replace function public.price_job_card_parts(
  p_job_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.repair_jobs%rowtype;
  line_value jsonb;
  part_row public.job_parts%rowtype;
  line_id uuid;
  cost_value numeric(12,2);
  markup_value numeric(7,2);
  selling_value numeric(12,2);
  submitted_selling_value numeric(12,2);
  quantity_value numeric;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and coalesce(profile.is_active, true)
      and (
        profile.role in ('super_admin', 'accounting')
        or coalesce(profile.access_level, 0) >= 2
      )
  ) then
    raise exception 'Only authorised Accounting users can price job-card parts'
      using errcode = '42501';
  end if;

  if p_job_id is null or p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0
     or jsonb_array_length(p_lines) > 100 then
    raise exception 'Select between 1 and 100 job-card part lines to price';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception 'Job card not found';
  end if;
  if job_row.status = 'Collected' then
    raise exception 'This vehicle has been collected. Its parts can no longer be priced';
  end if;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    begin
      line_id := nullif(trim(line_value->>'id'), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'A job-card part line has an invalid identifier';
    end;

    cost_value := nullif(line_value->>'cost_price', '')::numeric;
    markup_value := nullif(line_value->>'markup_pct', '')::numeric;
    submitted_selling_value := nullif(line_value->>'selling_price', '')::numeric;

    if line_id is null or cost_value is null or markup_value is null
       or cost_value <= 0 or markup_value < -100 or markup_value > 1000 then
      raise exception 'Enter a valid cost price and markup percentage for every part';
    end if;

    cost_value := round(cost_value, 2);
    markup_value := round(markup_value, 2);

    if submitted_selling_value is not null then
      submitted_selling_value := round(submitted_selling_value, 2);
      if submitted_selling_value <= 0 then
        raise exception 'Selling price must be greater than zero';
      end if;
      selling_value := submitted_selling_value;
      markup_value := round((selling_value / cost_value - 1) * 100, 2);
      if markup_value < -100 or markup_value > 1000 then
        raise exception 'Selling price produces an unsupported markup percentage';
      end if;
    else
      selling_value := round(cost_value * (1 + markup_value / 100), 2);
    end if;

    if cost_value <= 0 or selling_value <= 0 then
      raise exception 'The calculated selling price must be greater than zero';
    end if;

    select * into part_row
    from public.job_parts
    where id = line_id
      and job_id = p_job_id
      and awaiting_accounting_price = true
      and part_id is null
    for update;
    if not found then
      raise exception 'One or more job-card part lines are no longer awaiting a price or are already linked to stock';
    end if;

    quantity_value := coalesce(part_row.quantity, 0);
    if quantity_value <= 0 then
      raise exception 'Part quantity must be greater than zero';
    end if;

    update public.job_parts
    set cost_price = cost_value,
        markup_pct = markup_value,
        price_at_time = selling_value,
        awaiting_accounting_price = false
    where id = part_row.id;
  end loop;

  update public.repair_jobs
  set parts_cost = (
    select coalesce(sum(quantity * price_at_time), 0)
    from public.job_parts
    where job_id = p_job_id
      and awaiting_accounting_price = false
  )
  where id = p_job_id;

  -- Keep the existing UUID return contract. Pricing no longer creates a
  -- journal entry; COGS is posted exactly once when the received part is linked.
  return null;
end;
$$;

revoke all on function public.price_job_card_parts(uuid, jsonb) from public, anon;
grant execute on function public.price_job_card_parts(uuid, jsonb) to authenticated;

commit;
