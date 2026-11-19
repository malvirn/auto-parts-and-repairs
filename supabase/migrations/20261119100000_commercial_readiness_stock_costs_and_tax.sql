begin;

-- Zimbabwe VAT: catalogue prices are stored exclusive of VAT. The old Shop
-- workflow stored VAT-inclusive prices while quotations added VAT again.
alter table public.parts drop constraint if exists parts_vat_rate_check;
update public.parts
set selling_price = round(selling_price / 1.05, 2),
    vat_rate = 15.5
where vat_rate = 5;

alter table public.parts
  alter column vat_rate set default 15.5,
  add constraint parts_vat_rate_check check (vat_rate >= 0 and vat_rate <= 100);

alter table public.quotations alter column vat_rate set default 15.5;
alter table public.invoices alter column vat_rate set default 15.5;

-- New job totals tax the full taxable service basket. Existing 5% job records
-- retain their legacy parts-only calculation so issued history is not silently rewritten.
create or replace function public.sync_repair_job_total_cost()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  base_value numeric(12,2);
  taxable_value numeric(12,2);
  rate_value numeric(5,2);
begin
  base_value := round(
    coalesce(new.labour_cost, 0)
    + coalesce(new.parts_cost, 0)
    + coalesce(new.incidentals_cost, 0),
    2
  );
  rate_value := greatest(0, least(100, coalesce(new.vat_rate, 0)));
  taxable_value := case
    when rate_value = 5 then coalesce(new.parts_cost, 0)
    else base_value
  end;
  new.total_cost := round(base_value + round(taxable_value * rate_value / 100, 2), 2);
  return new;
end;
$$;

drop trigger if exists sync_repair_job_total_cost_trigger on public.repair_jobs;
create trigger sync_repair_job_total_cost_trigger
before insert or update of labour_cost, parts_cost, incidentals_cost, vat_rate
on public.repair_jobs
for each row execute function public.sync_repair_job_total_cost();

-- Quotation amendment preserves the legacy 5% parts-only snapshot but applies
-- the current 15.5% standard rate to the complete taxable quotation.
create or replace function public.amend_customer_quotation_with_vat(
  p_quotation_id uuid,
  p_items jsonb,
  p_vat_rate numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quotation_row public.quotations%rowtype;
  subtotal_value numeric(12,2);
  parts_subtotal_value numeric(12,2);
  taxable_value numeric(12,2);
  revised_total numeric(12,2);
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in to amend quotations' using errcode = '42501';
  end if;
  if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
    raise exception 'VAT rate must be between 0 and 100 percent';
  end if;

  select * into quotation_row
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found then raise exception 'Quotation not found'; end if;

  perform public.amend_customer_quotation(p_quotation_id, p_items);

  select coalesce(sum(total_usd), 0),
         coalesce(sum(total_usd) filter (where item_type = 'part'), 0)
  into subtotal_value, parts_subtotal_value
  from public.quotation_items
  where quotation_id = p_quotation_id;

  taxable_value := case when p_vat_rate = 5 then parts_subtotal_value else subtotal_value end;
  revised_total := round(subtotal_value + round(taxable_value * p_vat_rate / 100, 2), 2);

  update public.quotations
  set vat_rate = round(p_vat_rate, 2),
      total_usd = revised_total,
      total_zig = round(revised_total * quotation_row.usd_to_zig_rate, 2),
      updated_at = now()
  where id = p_quotation_id;
end;
$$;
revoke all on function public.amend_customer_quotation_with_vat(uuid, jsonb, numeric) from public, anon;
grant execute on function public.amend_customer_quotation_with_vat(uuid, jsonb, numeric) to authenticated;

-- Capture the cost of each sold part at the moment of checkout. Historical
-- rows remain NULL because their original cost cannot be reconstructed safely.
alter table public.sales_order_items
  add column if not exists cost_price_usd numeric(12,2);
alter table public.sales_order_items
  drop constraint if exists sales_order_items_cost_price_usd_check;
alter table public.sales_order_items
  add constraint sales_order_items_cost_price_usd_check
  check (cost_price_usd is null or cost_price_usd >= 0);

create or replace function public.snapshot_quick_sale_item_cost()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment_method_value text;
  cost_value numeric(12,2);
begin
  select payment_method into payment_method_value
  from public.sales_orders
  where id = new.sales_order_id;

  if payment_method_value in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit') then
    if coalesce(new.item_type, 'part') <> 'part' or new.part_id is null then
      raise exception 'Quick Sale lines must reference a catalogue part';
    end if;

    select cost_price into cost_value
    from public.parts
    where id = new.part_id
    for share;

    if not found or cost_value is null or cost_value <= 0 then
      raise exception 'Enter a positive cost price for this part before completing the sale';
    end if;

    new.cost_price_usd := round(cost_value, 2);
  end if;

  return new;
end;
$$;

drop trigger if exists snapshot_quick_sale_item_cost_trigger on public.sales_order_items;
create trigger snapshot_quick_sale_item_cost_trigger
before insert on public.sales_order_items
for each row execute function public.snapshot_quick_sale_item_cost();

create or replace function public.post_quick_sale_inventory_cogs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cost_total numeric(12,2);
  line_count integer;
  missing_cost_count integer;
  inventory_account_id uuid;
  cogs_account_id uuid;
begin
  select count(*),
         count(*) filter (where cost_price_usd is null or cost_price_usd <= 0),
         round(coalesce(sum(quantity * cost_price_usd), 0), 2)
  into line_count, missing_cost_count, cost_total
  from public.sales_order_items
  where sales_order_id = new.sales_order_id
    and coalesce(item_type, 'part') = 'part';

  if line_count = 0 then
    raise exception 'Quick Sale has no stock lines to account for';
  end if;
  if missing_cost_count > 0 then
    raise exception 'Quick Sale is missing one or more historical cost snapshots';
  end if;
  if cost_total <= 0 then
    raise exception 'Quick Sale cost of goods sold must be greater than zero';
  end if;

  select id into inventory_account_id
  from public.accounts
  where code = '1200' and is_active = true;
  select id into cogs_account_id
  from public.accounts
  where code = '5000' and is_active = true;

  if inventory_account_id is null or cogs_account_id is null then
    raise exception 'Parts Inventory (1200) and Cost of Parts Sold (5000) accounts must be active';
  end if;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
  values
    (new.journal_entry_id, cogs_account_id, cost_total, 0, 'Cost of parts sold'),
    (new.journal_entry_id, inventory_account_id, 0, cost_total, 'Inventory relieved on sale');

  return new;
end;
$$;

drop trigger if exists post_quick_sale_inventory_cogs_trigger on public.quick_sale_order_postings;
create trigger post_quick_sale_inventory_cogs_trigger
after insert on public.quick_sale_order_postings
for each row execute function public.post_quick_sale_inventory_cogs();

-- Snapshot stock cost when a catalogue part is attached to a job card.
create or replace function public.snapshot_job_part_cost()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cost_value numeric(12,2);
begin
  if new.part_id is not null
     and (tg_op = 'INSERT' or new.part_id is distinct from old.part_id or new.cost_price is null) then
    select cost_price into cost_value
    from public.parts
    where id = new.part_id
    for share;

    if not found or cost_value is null or cost_value <= 0 then
      raise exception 'Enter a positive cost price for this catalogue part before using it on a job card';
    end if;

    new.cost_price := round(cost_value, 2);
  end if;

  return new;
end;
$$;

drop trigger if exists snapshot_job_part_cost_trigger on public.job_parts;
create trigger snapshot_job_part_cost_trigger
before insert or update on public.job_parts
for each row execute function public.snapshot_job_part_cost();

create or replace function public.write_job_part_inventory_entry(
  p_job_part_id uuid,
  p_job_id uuid,
  p_quantity numeric,
  p_cost_price numeric,
  p_is_reversal boolean,
  p_entry_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inventory_account_id uuid;
  cogs_account_id uuid;
  entry_id uuid;
  job_number_value text;
  amount_value numeric(12,2);
begin
  amount_value := round(coalesce(p_quantity, 0) * coalesce(p_cost_price, 0), 2);
  if amount_value <= 0 then
    raise exception 'Job part inventory cost must be greater than zero';
  end if;

  select job_number::text into job_number_value
  from public.repair_jobs
  where id = p_job_id;

  select id into inventory_account_id
  from public.accounts
  where code = '1200' and is_active = true;
  select id into cogs_account_id
  from public.accounts
  where code = '5000' and is_active = true;

  if inventory_account_id is null or cogs_account_id is null then
    raise exception 'Parts Inventory (1200) and Cost of Parts Sold (5000) accounts must be active';
  end if;

  insert into public.journal_entries (
    entry_date, reference, description, source_type, source_id
  )
  values (
    coalesce(p_entry_date, current_date),
    'JC-' || lpad(coalesce(job_number_value, substr(p_job_id::text, 1, 8)), 5, '0'),
    case when p_is_reversal
      then 'Reverse part inventory cost — JC-' || coalesce(job_number_value, substr(p_job_id::text, 1, 8))
      else 'Job-card parts consumed — JC-' || coalesce(job_number_value, substr(p_job_id::text, 1, 8))
    end,
    case when p_is_reversal then 'job_part_inventory_reversal' else 'job_part_inventory' end,
    p_job_part_id
  )
  returning id into entry_id;

  if p_is_reversal then
    insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    values
      (entry_id, inventory_account_id, amount_value, 0, 'Return cost to parts inventory'),
      (entry_id, cogs_account_id, 0, amount_value, 'Reverse cost of parts consumed');
  else
    insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    values
      (entry_id, cogs_account_id, amount_value, 0, 'Cost of parts consumed on job card'),
      (entry_id, inventory_account_id, 0, amount_value, 'Parts inventory relieved');
  end if;

  return entry_id;
end;
$$;
revoke all on function public.write_job_part_inventory_entry(uuid, uuid, numeric, numeric, boolean, date) from public, anon, authenticated;

create or replace function public.post_job_part_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    if old.part_id is not null
       and old.cost_price is not null
       and exists (
         select 1 from public.journal_entries
         where source_type = 'job_part_inventory'
           and source_id = old.id
       ) then
      perform public.write_job_part_inventory_entry(
        old.id, old.job_id, old.quantity, old.cost_price, true, current_date
      );
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.part_id is not distinct from new.part_id
       and old.quantity is not distinct from new.quantity
       and old.cost_price is not distinct from new.cost_price then
      return new;
    end if;

    if old.part_id is not null
       and old.cost_price is not null
       and exists (
         select 1 from public.journal_entries
         where source_type = 'job_part_inventory'
           and source_id = old.id
       ) then
      perform public.write_job_part_inventory_entry(
        old.id, old.job_id, old.quantity, old.cost_price, true, current_date
      );
    end if;
  end if;

  if new.part_id is not null then
    perform public.write_job_part_inventory_entry(
      new.id, new.job_id, new.quantity, new.cost_price, false,
      coalesce(new.created_at::date, current_date)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists post_job_part_inventory_movement_trigger on public.job_parts;
create trigger post_job_part_inventory_movement_trigger
after insert or update or delete on public.job_parts
for each row execute function public.post_job_part_inventory_movement();

revoke all on function public.snapshot_quick_sale_item_cost() from public, anon, authenticated;
revoke all on function public.post_quick_sale_inventory_cogs() from public, anon, authenticated;
revoke all on function public.snapshot_job_part_cost() from public, anon, authenticated;
revoke all on function public.post_job_part_inventory_movement() from public, anon, authenticated;

-- Atomic stock + job-part writes for the Repairs module.
create or replace function public.add_job_part_with_stock(
  p_job_id uuid,
  p_part_id uuid,
  p_quantity integer,
  p_price_at_time numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.repair_jobs%rowtype;
  part_row public.parts%rowtype;
  job_part_id uuid;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'You are not authorised to add parts to job cards' using errcode = '42501';
  end if;
  if p_job_id is null or p_part_id is null or p_quantity is null or p_quantity < 1
     or p_price_at_time is null or p_price_at_time < 0 then
    raise exception 'Enter a valid job, part, quantity and selling price';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job card not found'; end if;
  if job_row.status = 'Collected' then
    raise exception 'This vehicle has been collected. Parts can no longer be changed';
  end if;

  select * into part_row
  from public.parts
  where id = p_part_id
  for update;
  if not found then raise exception 'Selected part no longer exists'; end if;
  if coalesce(part_row.cost_price, 0) <= 0 then
    raise exception 'Enter a positive cost price for this part before using it on a job card';
  end if;
  if part_row.quantity_in_stock < p_quantity then
    raise exception 'Not enough stock is available for this job-card change';
  end if;

  update public.parts
  set quantity_in_stock = quantity_in_stock - p_quantity
  where id = p_part_id;

  insert into public.job_parts (
    job_id, part_id, part_name, quantity, price_at_time, cost_price, awaiting_accounting_price
  )
  values (
    p_job_id, p_part_id, part_row.name, p_quantity,
    round(p_price_at_time, 2), round(part_row.cost_price, 2), false
  )
  returning id into job_part_id;

  update public.repair_jobs
  set parts_cost = (
    select coalesce(sum(quantity * price_at_time), 0)
    from public.job_parts
    where job_id = p_job_id and awaiting_accounting_price = false
  )
  where id = p_job_id;

  return job_part_id;
end;
$$;
revoke all on function public.add_job_part_with_stock(uuid, uuid, integer, numeric) from public, anon;
grant execute on function public.add_job_part_with_stock(uuid, uuid, integer, numeric) to authenticated;

create or replace function public.remove_job_part_with_stock(
  p_job_id uuid,
  p_job_part_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.repair_jobs%rowtype;
  part_row public.job_parts%rowtype;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'You are not authorised to remove parts from job cards' using errcode = '42501';
  end if;
  if p_job_id is null or p_job_part_id is null then
    raise exception 'Select a job card part to remove';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job card not found'; end if;
  if job_row.status = 'Collected' then
    raise exception 'This vehicle has been collected. Parts can no longer be changed';
  end if;

  select * into part_row
  from public.job_parts
  where id = p_job_part_id and job_id = p_job_id
  for update;
  if not found then raise exception 'Job-card part not found'; end if;

  if part_row.part_id is not null then
    update public.parts
    set quantity_in_stock = quantity_in_stock + part_row.quantity
    where id = part_row.part_id;
  end if;

  delete from public.job_parts where id = part_row.id;

  update public.repair_jobs
  set parts_cost = (
    select coalesce(sum(quantity * price_at_time), 0)
    from public.job_parts
    where job_id = p_job_id and awaiting_accounting_price = false
  )
  where id = p_job_id;

  return true;
end;
$$;
revoke all on function public.remove_job_part_with_stock(uuid, uuid) from public, anon;
grant execute on function public.remove_job_part_with_stock(uuid, uuid) to authenticated;

-- Atomic replacement for the full-page job-card editor. This keeps stock,
-- job-part rows, COGS and the job total in one database transaction.
create or replace function public.replace_job_parts(
  p_job_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.repair_jobs%rowtype;
  old_row public.job_parts%rowtype;
  line_value jsonb;
  matched_line jsonb;
  line_id uuid;
  next_part_id uuid;
  next_quantity integer;
  next_name text;
  next_price numeric(12,2);
  next_awaiting boolean;
  part_cost numeric(12,2);
  stock_value integer;
  delta_value integer;
  new_count integer := 0;
  changed_count integer := 0;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'You are not authorised to edit job-card parts' using errcode = '42501';
  end if;
  if p_job_id is null or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) > 100 then
    raise exception 'Job-card parts must be a valid list of up to 100 lines';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job card not found'; end if;
  if job_row.status = 'Collected' then
    raise exception 'Parts cannot be changed after the vehicle has been collected';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line
    where nullif(line->>'job_part_id', '') is not null
      and not exists (
        select 1 from public.job_parts jp
        where jp.id = nullif(line->>'job_part_id', '')::uuid
          and jp.job_id = p_job_id
      )
  ) then
    raise exception 'One or more job-part lines no longer belong to this job card';
  end if;

  if exists (
    select nullif(line->>'job_part_id', '')
    from jsonb_array_elements(p_lines) line
    where nullif(line->>'job_part_id', '') is not null
    group by nullif(line->>'job_part_id', '')
    having count(*) > 1
  ) then
    raise exception 'A job-part line was submitted more than once';
  end if;

  for old_row in
    select * from public.job_parts
    where job_id = p_job_id
    order by id
    for update
  loop
    matched_line := null;
    select line into matched_line
    from jsonb_array_elements(p_lines) line
    where nullif(line->>'job_part_id', '')::uuid = old_row.id
    limit 1;

    if matched_line is null then
      if old_row.part_id is not null then
        update public.parts
        set quantity_in_stock = quantity_in_stock + old_row.quantity
        where id = old_row.part_id;
      end if;
      delete from public.job_parts where id = old_row.id;
      changed_count := changed_count + 1;
      continue;
    end if;

    next_part_id := nullif(matched_line->>'part_id', '')::uuid;
    next_quantity := nullif(matched_line->>'quantity', '')::integer;
    next_name := nullif(btrim(matched_line->>'part_name'), '');
    next_price := round(coalesce(nullif(matched_line->>'price_at_time', '')::numeric, 0), 2);
    next_awaiting := coalesce(nullif(matched_line->>'awaiting_accounting_price', '')::boolean, false);

    if next_quantity is null or next_quantity < 1 or next_name is null or next_price < 0 then
      raise exception 'Each job-part line needs a name, positive whole quantity and valid selling price';
    end if;

    if old_row.part_id is distinct from next_part_id then
      if old_row.part_id is not null then
        update public.parts
        set quantity_in_stock = quantity_in_stock + old_row.quantity
        where id = old_row.part_id;
      end if;

      if next_part_id is not null then
        select cost_price, quantity_in_stock
        into part_cost, stock_value
        from public.parts
        where id = next_part_id
        for update;
        if not found then raise exception 'A selected catalogue part no longer exists'; end if;
        if coalesce(part_cost, 0) <= 0 then
          raise exception 'Enter a positive cost price for each catalogue part before using it';
        end if;
        if stock_value < next_quantity then
          raise exception 'Not enough stock is available for %', next_name;
        end if;
        update public.parts
        set quantity_in_stock = quantity_in_stock - next_quantity
        where id = next_part_id;
      end if;
    elsif next_part_id is not null then
      delta_value := next_quantity - old_row.quantity;
      if delta_value > 0 then
        update public.parts
        set quantity_in_stock = quantity_in_stock - delta_value
        where id = next_part_id and quantity_in_stock >= delta_value;
        if not found then raise exception 'Not enough stock is available for %', next_name; end if;
      elsif delta_value < 0 then
        update public.parts
        set quantity_in_stock = quantity_in_stock - delta_value
        where id = next_part_id;
      end if;
    end if;

    if old_row.part_id is distinct from next_part_id
       or old_row.quantity is distinct from next_quantity
       or old_row.part_name is distinct from next_name
       or old_row.price_at_time is distinct from next_price
       or old_row.awaiting_accounting_price is distinct from next_awaiting then
      update public.job_parts
      set part_id = next_part_id,
          part_name = next_name,
          quantity = next_quantity,
          price_at_time = next_price,
          awaiting_accounting_price = next_awaiting
      where id = old_row.id;
      changed_count := changed_count + 1;
    end if;
  end loop;

  for line_value in
    select value from jsonb_array_elements(p_lines) value
    where nullif(value->>'job_part_id', '') is null
  loop
    next_part_id := nullif(line_value->>'part_id', '')::uuid;
    next_quantity := nullif(line_value->>'quantity', '')::integer;
    next_name := nullif(btrim(line_value->>'part_name'), '');
    next_price := round(coalesce(nullif(line_value->>'price_at_time', '')::numeric, 0), 2);
    next_awaiting := coalesce(nullif(line_value->>'awaiting_accounting_price', '')::boolean, false);

    if next_quantity is null or next_quantity < 1 or next_name is null or next_price < 0 then
      raise exception 'Each new job-part line needs a name, positive whole quantity and valid selling price';
    end if;

    if next_part_id is not null then
      select cost_price, quantity_in_stock
      into part_cost, stock_value
      from public.parts
      where id = next_part_id
      for update;
      if not found then raise exception 'A selected catalogue part no longer exists'; end if;
      if coalesce(part_cost, 0) <= 0 then
        raise exception 'Enter a positive cost price for each catalogue part before using it';
      end if;
      if stock_value < next_quantity then
        raise exception 'Not enough stock is available for %', next_name;
      end if;
      update public.parts
      set quantity_in_stock = quantity_in_stock - next_quantity
      where id = next_part_id;
      next_awaiting := false;
      insert into public.job_parts (
        job_id, part_id, part_name, quantity, price_at_time, cost_price, awaiting_accounting_price
      )
      values (
        p_job_id, next_part_id, next_name, next_quantity, next_price, part_cost, false
      );
    else
      insert into public.job_parts (
        job_id, part_id, part_name, quantity, price_at_time, awaiting_accounting_price
      )
      values (
        p_job_id, null, next_name, next_quantity, next_price, next_awaiting
      );
    end if;
    new_count := new_count + 1;
  end loop;

  update public.repair_jobs
  set parts_cost = (
    select coalesce(sum(quantity * price_at_time), 0)
    from public.job_parts
    where job_id = p_job_id and awaiting_accounting_price = false
  )
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'created', new_count,
    'changed', changed_count
  );
end;
$$;
revoke all on function public.replace_job_parts(uuid, jsonb) from public, anon;
grant execute on function public.replace_job_parts(uuid, jsonb) to authenticated;

commit;