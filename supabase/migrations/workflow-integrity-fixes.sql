begin;

create or replace function public.current_access_level()
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when lower(coalesce(profile.role, '')) in ('accounting', 'super_admin', 'superadmin')
      then greatest(coalesce(profile.access_level, 1), 2)
    else coalesce(profile.access_level, 1)
  end
  from (select 1) as singleton
  left join public.profiles as profile on profile.id = auth.uid();
$$;

alter table public.repair_job_payments
  add column if not exists voided_at timestamptz;

alter table public.invoices
  add column if not exists repair_job_id uuid references public.repair_jobs(id) on delete set null,
  add column if not exists vat_base numeric(12, 2);

update public.invoices invoice
set vat_base = case
  when invoice.repair_job_id is null then round(coalesce(invoice.subtotal, 0), 2)
  else coalesce((
    select round(sum(job_part.quantity * job_part.price_at_time), 2)
    from public.job_parts job_part
    where job_part.job_id = invoice.repair_job_id
  ), 0)
end
where invoice.vat_base is null;

alter table public.invoices
  alter column vat_base set default 0,
  alter column vat_base set not null;

create or replace function public.sync_repair_job_invoice_paid_amount()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected_job_id uuid;
  affected_job_ids uuid[];
begin
  if tg_op = 'INSERT' then
    affected_job_ids := array[new.repair_job_id];
  elsif tg_op = 'DELETE' then
    affected_job_ids := array[old.repair_job_id];
  else
    affected_job_ids := array[old.repair_job_id, new.repair_job_id];
  end if;

  foreach affected_job_id in array affected_job_ids
  loop
    if affected_job_id is not null then
      with payment_totals as (
        select invoice.id,
          invoice.total,
          least(invoice.total, round(
            coalesce((
              select sum(payment.amount)
              from public.repair_job_payments payment
              where payment.repair_job_id = affected_job_id
                and payment.voided_at is null
            ), 0)
            + coalesce((
              select sum(payment.amount)
              from public.invoice_payments payment
              where payment.invoice_id = invoice.id
            ), 0),
            2
          )) as amount_paid
        from public.invoices invoice
        where invoice.repair_job_id = affected_job_id
      )
      update public.invoices invoice
      set amount_paid = payment_totals.amount_paid,
          status = case
            when payment_totals.amount_paid >= payment_totals.total - 0.005 then 'paid'
            when payment_totals.amount_paid > 0 then 'partially_paid'
            else 'unpaid'
          end
      from payment_totals
      where invoice.id = payment_totals.id;
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_repair_job_invoice_paid_amount on public.repair_job_payments;
create trigger sync_repair_job_invoice_paid_amount
  after insert or update of repair_job_id, amount, voided_at or delete
  on public.repair_job_payments
  for each row execute function public.sync_repair_job_invoice_paid_amount();

create or replace function public.validate_customer_invoice()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  item_row jsonb;
  item_description text;
  item_quantity numeric;
  item_price numeric;
  calculated_subtotal numeric(12, 2) := 0;
  expected_total numeric(12, 2);
begin
  if new.items is null or jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) = 0 then
    raise exception 'An invoice must contain at least one item';
  end if;

  for item_row in select value from jsonb_array_elements(new.items) as items(value)
  loop
    item_description := coalesce(
      nullif(btrim(item_row ->> 'd'), ''),
      nullif(btrim(item_row ->> 'description'), ''),
      nullif(btrim(item_row ->> 'name'), ''),
      nullif(btrim(item_row ->> 'part_name'), '')
    );
    if item_description is null then
      raise exception 'Each invoice item needs a description';
    end if;

    if jsonb_typeof(coalesce(item_row -> 'q', item_row -> 'quantity')) <> 'number'
      or jsonb_typeof(coalesce(item_row -> 'p', item_row -> 'price', item_row -> 'unit_price', item_row -> 'unit_price_usd', item_row -> 'amount')) <> 'number' then
      raise exception 'Each invoice item needs a numeric quantity and price';
    end if;

    item_quantity := coalesce(item_row ->> 'q', item_row ->> 'quantity')::numeric;
    item_price := coalesce(
      item_row ->> 'p',
      item_row ->> 'price',
      item_row ->> 'unit_price',
      item_row ->> 'unit_price_usd',
      item_row ->> 'amount'
    )::numeric;
    if item_quantity <= 0 or item_quantity > 99999999
      or item_price < 0 or item_price > 100000000 then
      raise exception 'Invoice quantities must be positive and prices must be non-negative and within the supported range';
    end if;
    calculated_subtotal := calculated_subtotal + item_quantity * item_price;
  end loop;

  calculated_subtotal := round(calculated_subtotal, 2);
  if new.subtotal is null or abs(round(new.subtotal, 2) - calculated_subtotal) > 0.01 then
    raise exception 'Invoice subtotal does not match its line items';
  end if;
  if new.discount is null or new.discount < 0 or new.discount >= calculated_subtotal then
    raise exception 'Invoice discount must be zero or more and less than the subtotal';
  end if;
  if new.vat_rate is null or new.vat_rate < 0 or new.vat_rate > 100
    or new.vat_base is null or new.vat_base < 0 or new.vat_base > calculated_subtotal then
    raise exception 'Invoice VAT values are invalid';
  end if;
  if new.amount_paid is null or new.amount_paid < 0 or new.amount_paid > new.total + 0.005 then
    raise exception 'Invoice amount paid must be between zero and the invoice total';
  end if;

  expected_total := round(
    calculated_subtotal - new.discount
      + greatest(0, new.vat_base - new.discount) * new.vat_rate / 100,
    2
  );
  if new.total is null or new.total <= 0 or abs(round(new.total, 2) - expected_total) > 0.01 then
    raise exception 'Invoice total does not match its items, discount, and VAT';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_customer_invoice on public.invoices;
create trigger validate_customer_invoice
  before insert or update of items, discount, vat_rate, vat_base, subtotal, total
  on public.invoices
  for each row execute function public.validate_customer_invoice();

create or replace function public.sync_repair_job_invoice(p_repair_job_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.repair_jobs%rowtype;
  invoice_row public.invoices%rowtype;
  part_row record;
  extra_row record;
  v_invoice_items jsonb := '[]'::jsonb;
  v_item_subtotal numeric(12, 2) := 0;
  v_subtotal numeric(12, 2);
  v_parts_subtotal numeric(12, 2) := 0;
  v_vat_rate numeric(5, 2);
  v_discount numeric(12, 2);
  v_invoice_total numeric(12, 2);
  v_paid_total numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in to synchronize a repair-job invoice'
      using errcode = '42501';
  end if;
  if p_repair_job_id is null then
    raise exception 'Choose a repair job';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_repair_job_id
  for update;
  if not found then
    raise exception 'Repair job not found';
  end if;

  select * into invoice_row
  from public.invoices
  where repair_job_id = job_row.id
  for update;
  if not found then
    return;
  end if;

  v_subtotal := round(coalesce(job_row.total_cost, 0), 2);
  if v_subtotal <= 0 then
    raise exception 'A linked invoice requires a positive repair-job total';
  end if;

  for part_row in
    select job_part.part_name, job_part.quantity, job_part.price_at_time, part.description
    from public.job_parts job_part
    left join public.parts part on part.id = job_part.part_id
    where job_part.job_id = job_row.id
    order by job_part.id
  loop
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(part_row.description), ''), nullif(btrim(part_row.part_name), ''), 'Part'),
      'q', part_row.quantity,
      'p', coalesce(part_row.price_at_time, 0)
    ));
    v_item_subtotal := v_item_subtotal + part_row.quantity * coalesce(part_row.price_at_time, 0);
    v_parts_subtotal := v_parts_subtotal + part_row.quantity * coalesce(part_row.price_at_time, 0);
  end loop;

  if coalesce(job_row.labour_cost, 0) > 0 then
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(job_row.job_description), ''), 'Labour'),
      'q', 1,
      'p', job_row.labour_cost
    ));
    v_item_subtotal := v_item_subtotal + job_row.labour_cost;
  end if;

  for extra_row in
    select description, amount
    from public.job_incidentals
    where job_id = job_row.id
    order by created_at, id
  loop
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(extra_row.description), ''), 'Additional job cost'),
      'q', 1,
      'p', extra_row.amount
    ));
    v_item_subtotal := v_item_subtotal + extra_row.amount;
  end loop;

  v_item_subtotal := round(v_item_subtotal, 2);
  v_parts_subtotal := round(v_parts_subtotal, 2);
  if abs(v_item_subtotal - v_subtotal) > 0.01 then
    if v_item_subtotal > v_subtotal then
      raise exception 'Repair-job line items exceed the job total and cannot be invoiced consistently';
    end if;
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', 'Job card total adjustment',
      'q', 1,
      'p', v_subtotal - v_item_subtotal
    ));
  end if;

  v_discount := coalesce(invoice_row.discount, 0);
  v_vat_rate := coalesce(invoice_row.vat_rate, 0);
  if v_discount < 0 or v_discount >= v_subtotal or v_vat_rate < 0 or v_vat_rate > 100
    or v_parts_subtotal < 0 or v_parts_subtotal > v_subtotal then
    raise exception 'The repair-job total is incompatible with the linked invoice discount or VAT values';
  end if;

  v_invoice_total := round(
    v_subtotal - v_discount + greatest(0, v_parts_subtotal - v_discount) * v_vat_rate / 100,
    2
  );
  select least(v_invoice_total, round(
    coalesce((
      select sum(payment.amount)
      from public.repair_job_payments payment
      where payment.repair_job_id = job_row.id
        and payment.voided_at is null
    ), 0)
    + coalesce((
      select sum(payment.amount)
      from public.invoice_payments payment
      where payment.invoice_id = invoice_row.id
    ), 0),
    2
  )) into v_paid_total;

  update public.invoices
  set items = v_invoice_items,
      subtotal = v_subtotal,
      vat_base = v_parts_subtotal,
      vat_rate = v_vat_rate,
      total = v_invoice_total,
      amount_paid = v_paid_total,
      status = case
        when v_paid_total >= v_invoice_total - 0.005 then 'paid'
        when v_paid_total > 0 then 'partially_paid'
        else 'unpaid'
      end
  where id = invoice_row.id;
end;
$$;

revoke all on function public.sync_repair_job_invoice(uuid) from public, anon;
grant execute on function public.sync_repair_job_invoice(uuid) to authenticated;

drop policy if exists "Accounting users can create customer invoices" on public.invoices;
create policy "Accounting users can create customer invoices"
  on public.invoices for insert
  to authenticated
  with check (
    public.current_access_level() >= 2
    and (
      (coalesce(amount_paid, 0) = 0 and status = 'unpaid')
      or (
        repair_job_id is not null
        and round(coalesce(amount_paid, 0), 2) = least(
          round(total, 2),
          round(coalesce((
            select sum(payment.amount)
            from public.repair_job_payments payment
            where payment.repair_job_id = invoices.repair_job_id
              and payment.voided_at is null
          ), 0), 2)
        )
        and status = case
          when coalesce(amount_paid, 0) >= total - 0.005 then 'paid'
          when coalesce(amount_paid, 0) > 0 then 'partially_paid'
          else 'unpaid'
        end
      )
    )
  );

drop function if exists public.edit_customer_invoice(uuid, uuid, text, text, text, jsonb, numeric, numeric, date, text, text);
create function public.edit_customer_invoice(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_items jsonb,
  p_discount numeric,
  p_vat_rate numeric,
  p_vat_base numeric,
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
  new_vat_rate numeric(5, 2);
  new_vat_base numeric(12, 2);
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
  if p_discount is null or p_discount < 0
    or p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100
    or p_vat_base is null or p_vat_base < 0 then
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
      or jsonb_typeof(item_row -> 'q') <> 'number'
      or jsonb_typeof(item_row -> 'p') <> 'number' then
      raise exception 'Each invoice item needs a description, quantity, and price';
    end if;
    quantity := (item_row ->> 'q')::numeric;
    unit_price := (item_row ->> 'p')::numeric;
    if quantity <= 0 or quantity > 99999999
      or unit_price < 0 or unit_price > 100000000 then
      raise exception 'Invoice quantities must be positive and prices must be non-negative and within the supported range';
    end if;
    new_subtotal := new_subtotal + quantity * unit_price;
  end loop;

  new_subtotal := round(new_subtotal, 2);
  new_discount := round(p_discount, 2);
  new_vat_rate := round(p_vat_rate, 2);
  new_vat_base := round(p_vat_base, 2);
  if new_subtotal <= 0 or new_discount >= new_subtotal or new_vat_base > new_subtotal then
    raise exception 'Invoice subtotal, discount, or VAT base is invalid';
  end if;
  new_total := round(
    new_subtotal - new_discount
      + greatest(0, new_vat_base - new_discount) * new_vat_rate / 100,
    2
  );
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
      vat_rate = new_vat_rate,
      vat_base = new_vat_base,
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

revoke all on function public.edit_customer_invoice(uuid, uuid, text, text, text, jsonb, numeric, numeric, numeric, date, text, text) from public, anon;
grant execute on function public.edit_customer_invoice(uuid, uuid, text, text, text, jsonb, numeric, numeric, numeric, date, text, text) to authenticated;

create or replace function public.amend_customer_quotation(
  p_quotation_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quotation_row public.quotations%rowtype;
  item_request record;
  item_row public.quotation_items%rowtype;
  line_total numeric(12, 2);
  line_markup numeric(5, 2);
  subtotal numeric(12, 2) := 0;
  parts_subtotal numeric(12, 2) := 0;
  new_total numeric(12, 2);
  item_count integer;
  request_count integer;
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in to amend quotations' using errcode = '42501';
  end if;
  if p_quotation_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose a quotation with at least one item';
  end if;

  select * into quotation_row
  from public.quotations
  where id = p_quotation_id
  for update;
  if not found then
    raise exception 'Quotation not found';
  end if;
  if quotation_row.usd_to_zig_rate is null or quotation_row.usd_to_zig_rate <= 0 then
    raise exception 'The quotation exchange rate is invalid';
  end if;

  select count(*), count(distinct request.id)
  into request_count, item_count
  from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric);
  if request_count = 0 or request_count <> item_count
    or request_count <> (select count(*) from public.quotation_items where quotation_id = quotation_row.id)
    or exists (
      select 1
      from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
      where request.id is null or request.quantity is null or request.quantity <= 0
        or request.quantity > 99999999 or request.unit_price_usd is null
        or request.unit_price_usd < 0 or request.unit_price_usd > 100000000
    )
    or exists (
      select 1
      from public.quotation_items existing
      left join jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
        on request.id = existing.id
      where existing.quotation_id = quotation_row.id and request.id is null
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
      left join public.quotation_items existing
        on existing.id = request.id and existing.quotation_id = quotation_row.id
      where existing.id is null
    ) then
    raise exception 'Quotation lines changed or contain invalid quantities or prices; reload and try again';
  end if;

  for item_request in
    select * from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
    order by id
  loop
    select * into item_row
    from public.quotation_items
    where id = item_request.id and quotation_id = quotation_row.id
    for update;
    line_total := round(item_request.quantity * item_request.unit_price_usd, 2);
    line_markup := case
      when coalesce(item_row.cost_price_usd, 0) > 0
        then round((item_request.unit_price_usd / item_row.cost_price_usd - 1) * 100, 2)
      else 0
    end;
    if line_markup < -100 or line_markup > 999.99 then
      raise exception 'A quotation markup is outside the supported range';
    end if;
    update public.quotation_items
    set quantity = item_request.quantity,
        unit_price_usd = round(item_request.unit_price_usd, 2),
        markup_pct = line_markup,
        total_usd = line_total,
        unit_price_zig = round(item_request.unit_price_usd * quotation_row.usd_to_zig_rate, 2),
        total_zig = round(line_total * quotation_row.usd_to_zig_rate, 2)
    where id = item_row.id;
    subtotal := subtotal + line_total;
    if item_row.item_type = 'part' then
      parts_subtotal := parts_subtotal + line_total;
    end if;
  end loop;

  subtotal := round(subtotal, 2);
  parts_subtotal := round(parts_subtotal, 2);
  new_total := round(subtotal + round(parts_subtotal * 0.05, 2), 2);
  update public.quotations
  set total_usd = new_total,
      total_zig = round(new_total * quotation_row.usd_to_zig_rate, 2),
      updated_at = now(),
      status = 'Amended'
  where id = quotation_row.id;
end;
$$;

revoke all on function public.amend_customer_quotation(uuid, jsonb) from public, anon;
grant execute on function public.amend_customer_quotation(uuid, jsonb) to authenticated;

create table if not exists public.sales_order_stock_allocations (
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  part_id uuid not null,
  quantity numeric(10, 2) not null default 0 check (quantity >= 0),
  job_quantity_covered numeric(10, 2) not null default 0 check (job_quantity_covered >= 0),
  updated_at timestamptz not null default now(),
  primary key (sales_order_id, part_id)
);

alter table public.sales_order_stock_allocations enable row level security;
revoke all on public.sales_order_stock_allocations from public, anon, authenticated;

insert into public.sales_order_stock_allocations (
  sales_order_id, part_id, quantity, job_quantity_covered
)
select sales_order.id,
  order_items.part_id,
  greatest(sum(order_items.quantity) - coalesce(job_parts.quantity, 0), 0),
  coalesce(job_parts.quantity, 0)
from public.sales_orders sales_order
join public.sales_order_items order_items on order_items.sales_order_id = sales_order.id
left join lateral (
  select sum(job_part.quantity)::numeric as quantity
  from public.job_parts job_part
  where sales_order.repair_job_id is not null
    and job_part.job_id = sales_order.repair_job_id
    and job_part.part_id = order_items.part_id
) job_parts on true
where sales_order.status = 'Confirmed'
  and order_items.part_id is not null
group by sales_order.id, order_items.part_id, job_parts.quantity
on conflict (sales_order_id, part_id) do nothing;

create or replace function public.save_sales_order_with_stock(
  p_sales_order_id uuid,
  p_salesperson_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row public.sales_orders%rowtype;
  item_request record;
  stock_row record;
  line_count integer;
  request_count integer;
  distinct_request_count integer;
  line_total numeric(12, 2);
  order_total numeric(12, 2);
  receipt_id uuid;
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in to save sales orders' using errcode = '42501';
  end if;
  if p_sales_order_id is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose an order with at least one item';
  end if;

  select * into order_row
  from public.sales_orders
  where id = p_sales_order_id
  for update;
  if not found then
    raise exception 'Sales order not found';
  end if;
  if order_row.status not in ('Draft', 'Confirmed') or order_row.payment_method is not null then
    raise exception 'Only quotation-based draft or confirmed orders can be amended here';
  end if;
  if order_row.usd_to_zig_rate is null or order_row.usd_to_zig_rate <= 0 then
    raise exception 'The order exchange rate is invalid';
  end if;

  select count(*), count(distinct request.id)
  into request_count, distinct_request_count
  from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric);
  select count(*) into line_count
  from public.sales_order_items
  where sales_order_id = order_row.id;
  if request_count = 0 or request_count <> distinct_request_count or request_count <> line_count
    or exists (
      select 1
      from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
      where request.id is null or request.quantity is null or request.quantity <= 0
        or request.quantity > 99999999 or request.unit_price_usd is null
        or request.unit_price_usd < 0 or request.unit_price_usd > 100000000
    )
    or exists (
      select 1
      from public.sales_order_items existing
      left join jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
        on request.id = existing.id
      where existing.sales_order_id = order_row.id and request.id is null
    )
    or exists (
      select 1
      from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
      left join public.sales_order_items existing
        on existing.id = request.id and existing.sales_order_id = order_row.id
      where existing.id is null
    ) then
    raise exception 'Order lines changed or contain invalid quantities or prices; reload and try again';
  end if;

  for stock_row in
    with requested as (
      select * from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
    ),
    old_totals as (
      select item.part_id, sum(item.quantity)::numeric as old_quantity
      from public.sales_order_items item
      where item.sales_order_id = order_row.id and item.part_id is not null
      group by item.part_id
    ),
    new_totals as (
      select item.part_id, sum(request.quantity)::numeric as new_quantity
      from public.sales_order_items item
      join requested request on request.id = item.id
      where item.sales_order_id = order_row.id and item.part_id is not null
      group by item.part_id
    )
    select old_totals.part_id,
      greatest(new_totals.new_quantity - coalesce(allocation.job_quantity_covered, job_parts.quantity, 0), 0)
        - coalesce(allocation.quantity, 0) as quantity_delta,
      greatest(new_totals.new_quantity - coalesce(allocation.job_quantity_covered, job_parts.quantity, 0), 0)
        as target_quantity,
      coalesce(allocation.job_quantity_covered, job_parts.quantity, 0) as covered_quantity
    from old_totals
    join new_totals using (part_id)
    left join public.sales_order_stock_allocations allocation
      on allocation.sales_order_id = order_row.id and allocation.part_id = old_totals.part_id
    left join lateral (
      select sum(job_part.quantity)::numeric as quantity
      from public.job_parts job_part
      where order_row.repair_job_id is not null
        and job_part.job_id = order_row.repair_job_id
        and job_part.part_id = old_totals.part_id
    ) job_parts on true
    order by old_totals.part_id
  loop
    if stock_row.quantity_delta <> 0 then
      update public.parts
      set quantity_in_stock = coalesce(quantity_in_stock, 0) - stock_row.quantity_delta
      where id = stock_row.part_id
        and (stock_row.quantity_delta <= 0 or coalesce(quantity_in_stock, 0) >= stock_row.quantity_delta);
      if not found then
        raise exception 'Not enough stock is available to amend this order';
      end if;
    end if;
    insert into public.sales_order_stock_allocations (
      sales_order_id, part_id, quantity, job_quantity_covered, updated_at
    )
    values (
      order_row.id, stock_row.part_id, stock_row.target_quantity,
      stock_row.covered_quantity, now()
    )
    on conflict (sales_order_id, part_id) do update
    set quantity = excluded.quantity,
        job_quantity_covered = excluded.job_quantity_covered,
        updated_at = excluded.updated_at;
  end loop;

  for item_request in
    select * from jsonb_to_recordset(p_items) as request(id uuid, quantity numeric, unit_price_usd numeric)
  loop
    line_total := round(item_request.quantity * item_request.unit_price_usd, 2);
    update public.sales_order_items
    set quantity = item_request.quantity,
        unit_price_usd = round(item_request.unit_price_usd, 2),
        total_usd = line_total,
        unit_price_zig = round(item_request.unit_price_usd * order_row.usd_to_zig_rate, 2),
        total_zig = round(line_total * order_row.usd_to_zig_rate, 2)
    where id = item_request.id and sales_order_id = order_row.id;
  end loop;

  select round(sum(total_usd), 2) into order_total
  from public.sales_order_items
  where sales_order_id = order_row.id;
  if order_total is null or order_total <= 0 then
    raise exception 'Order total must be greater than zero';
  end if;

  update public.sales_orders
  set total_usd = order_total,
      total_zig = round(order_total * order_row.usd_to_zig_rate, 2),
      status = 'Confirmed',
      salesperson_id = p_salesperson_id,
      updated_at = now()
  where id = order_row.id;

  select id into receipt_id
  from public.receipts
  where sales_order_id = order_row.id and voided_at is null
  for update;
  if receipt_id is null then
    if exists (
      select 1 from public.receipts
      where sales_order_id = order_row.id and voided_at is null
      offset 1
    ) then
      raise exception 'This order has multiple active receipts; resolve them before saving';
    end if;
    insert into public.receipts (sales_order_id, amount)
    values (order_row.id, order_total);
  else
    if exists (
      select 1 from public.receipts
      where sales_order_id = order_row.id and voided_at is null and id <> receipt_id
    ) then
      raise exception 'This order has multiple active receipts; resolve them before saving';
    end if;
    update public.receipts
    set amount = order_total
    where id = receipt_id;
  end if;
end;
$$;

revoke all on function public.save_sales_order_with_stock(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_sales_order_with_stock(uuid, uuid, jsonb) to authenticated;

create or replace function public.validate_quick_sale_catalog_price()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_id uuid;
  order_method text;
  catalog_price numeric;
begin
  order_id := case when tg_op = 'DELETE' then old.sales_order_id else new.sales_order_id end;
  select payment_method into order_method
  from public.sales_orders
  where id = order_id;
  if order_method in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit') then
    if tg_op = 'DELETE' then
      raise exception 'Quick Sale lines cannot be deleted after checkout; void the sale instead';
    end if;
    if new.part_id is null then
      raise exception 'Quick Sale lines must refer to a catalogue product';
    end if;
    select selling_price into catalog_price
    from public.parts
    where id = new.part_id
    for share;
    if not found or catalog_price is null or catalog_price <= 0 then
      raise exception 'The selected product has no valid catalogue selling price';
    end if;
    if round(new.unit_price_usd, 2) is distinct from round(catalog_price, 2) then
      raise exception 'Quick Sale prices must match the current catalogue price; refresh the product list and use the sale discount field';
    end if;
    if tg_op = 'UPDATE' then
      raise exception 'Quick Sale lines cannot be amended after checkout; void the sale and create a corrected sale';
    end if;
    if tg_op = 'INSERT' then
      insert into public.sales_order_stock_allocations (
        sales_order_id, part_id, quantity, job_quantity_covered, updated_at
      )
      values (new.sales_order_id, new.part_id, new.quantity, 0, now())
      on conflict (sales_order_id, part_id) do update
      set quantity = public.sales_order_stock_allocations.quantity + excluded.quantity,
          updated_at = excluded.updated_at;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_quick_sale_catalog_price on public.sales_order_items;
create trigger validate_quick_sale_catalog_price
  before insert or update or delete on public.sales_order_items
  for each row execute function public.validate_quick_sale_catalog_price();

create or replace function public.prevent_quick_sale_order_changes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  void_function_owner name;
begin
  if tg_op = 'DELETE' then
    if old.payment_method in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit') then
      raise exception 'Quick Sale orders cannot be deleted; void the related receipt instead';
    end if;
    return old;
  end if;

  if new.payment_method in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit')
    and new.payment_method is distinct from old.payment_method then
    raise exception 'Quick Sale payment details cannot be added to an existing order';
  end if;

  if old.payment_method in ('Cash', 'EcoCash', 'Swipe', 'Bank', 'Credit') then
    if new.payment_method is distinct from old.payment_method
      or new.discount_usd is distinct from old.discount_usd
      or new.total_usd is distinct from old.total_usd
      or new.total_zig is distinct from old.total_zig
      or new.usd_to_zig_rate is distinct from old.usd_to_zig_rate
      or new.order_number is distinct from old.order_number
      or new.repair_job_id is distinct from old.repair_job_id
      or new.customer_id is distinct from old.customer_id
      or new.walk_in_name is distinct from old.walk_in_name
      or new.salesperson_id is distinct from old.salesperson_id then
      raise exception 'Quick Sale totals and customer details cannot be amended after checkout';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'Confirmed' or new.status <> 'Cancelled' then
        raise exception 'Quick Sale status can only change through the authorised void operation';
      end if;
      select pg_get_userbyid(proowner) into void_function_owner
      from pg_proc
      where oid = 'public.void_business_receipt(uuid,text)'::regprocedure;
      if current_user <> void_function_owner then
        raise exception 'Quick Sale status can only change through the authorised void operation'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_quick_sale_order_changes on public.sales_orders;
create trigger prevent_quick_sale_order_changes
  before update or delete on public.sales_orders
  for each row execute function public.prevent_quick_sale_order_changes();

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

create or replace view public.customer_account_statement
with (security_invoker = true)
as
with repair_payment_totals as (
  select repair_job_id, sum(amount) as paid_amount
  from public.repair_job_payments
  where voided_at is null
  group by repair_job_id
),
sales_receipt_totals as (
  select sales_order_id, max(amount) as paid_amount
  from public.receipts
  where sales_order_id is not null and voided_at is null
  group by sales_order_id
),
quick_sale_payment_totals as (
  select sales_order_id, sum(amount) as paid_amount,
    string_agg(distinct payment_method, ', ' order by payment_method) as payment_methods
  from public.quick_sale_payments
  group by sales_order_id
),
invoice_payment_totals as (
  select invoice_id, sum(amount) as paid_amount
  from public.invoice_payments
  group by invoice_id
)
select
  customer.id as customer_id,
  customer.full_name as customer_name,
  customer.phone,
  customer.email,
  job.id as source_id,
  'Repair job'::text as source_type,
  coalesce(job.cro_number, 'Job #' || lpad(job.job_number::text, 4, '0')) as reference,
  job.created_at::date as entry_date,
  coalesce(job.total_cost, 0)::numeric(12, 2) as total_amount,
  coalesce(repair_payments.paid_amount, 0)::numeric(12, 2) as amount_paid,
  (coalesce(job.total_cost, 0) - coalesce(repair_payments.paid_amount, 0))::numeric(12, 2) as balance_due,
  0::numeric(12, 2) as discount_amount,
  null::text as payment_method,
  false as can_record_payment
from public.repair_jobs job
join public.customers customer on customer.id = job.customer_id
left join repair_payment_totals repair_payments on repair_payments.repair_job_id = job.id
where coalesce(job.total_cost, 0) > 0
  and (
    job.status::text in ('Ready for Pickup', 'Unclaimed', 'Collected', 'Processed')
    or repair_payments.repair_job_id is not null
  )
  and not exists (
    select 1 from public.invoices invoice
    where invoice.repair_job_id = job.id
  )

union all

select
  customer.id,
  customer.full_name,
  customer.phone,
  customer.email,
  sales_order.id,
  'Sales order'::text,
  'Order #' || lpad(sales_order.order_number::text, 4, '0'),
  sales_order.created_at::date,
  coalesce(sales_order.total_usd, 0)::numeric(12, 2),
  coalesce(quick_sale_payments.paid_amount, receipt_totals.paid_amount, 0)::numeric(12, 2),
  (coalesce(sales_order.total_usd, 0) - coalesce(quick_sale_payments.paid_amount, receipt_totals.paid_amount, 0))::numeric(12, 2),
  coalesce(sales_order.discount_usd, 0)::numeric(12, 2),
  coalesce(quick_sale_payments.payment_methods, sales_order.payment_method),
  exists (
    select 1 from public.quick_sale_order_postings posting
    where posting.sales_order_id = sales_order.id
  )
from public.sales_orders sales_order
join public.customers customer on customer.id = sales_order.customer_id
left join sales_receipt_totals receipt_totals on receipt_totals.sales_order_id = sales_order.id
left join quick_sale_payment_totals quick_sale_payments on quick_sale_payments.sales_order_id = sales_order.id
where sales_order.status = 'Confirmed' and coalesce(sales_order.total_usd, 0) > 0

union all

select
  customer.id,
  customer.full_name,
  customer.phone,
  customer.email,
  invoice.id,
  'Invoice'::text,
  'INV-' || lpad(invoice.invoice_number::text, 5, '0'),
  invoice.issued_at::date,
  coalesce(invoice.total, 0)::numeric(12, 2),
  greatest(coalesce(invoice.amount_paid, 0), coalesce(invoice_payments.paid_amount, 0))::numeric(12, 2),
  (coalesce(invoice.total, 0) - greatest(coalesce(invoice.amount_paid, 0), coalesce(invoice_payments.paid_amount, 0)))::numeric(12, 2),
  0::numeric(12, 2),
  null::text,
  false as can_record_payment
from public.invoices invoice
join public.customers customer on customer.id = invoice.customer_id
left join invoice_payment_totals invoice_payments on invoice_payments.invoice_id = invoice.id
where coalesce(invoice.total, 0) > 0;

commit;
