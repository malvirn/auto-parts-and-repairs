begin;

-- Idempotency ledger for workshop part allocation. The browser never receives
-- direct table privileges; records are written only by the RPC below.
create table if not exists public.workshop_job_part_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  job_id uuid not null references public.repair_jobs(id) on delete cascade,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.workshop_job_part_requests enable row level security;
revoke all on public.workshop_job_part_requests from public, anon, authenticated;

-- Workshop may only append catalogue parts to an active job. Stock, cost,
-- selling price, COGS and any linked invoice are derived and posted here.
create or replace function public.append_workshop_job_parts(
  p_request_id uuid,
  p_job_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_part_id uuid;
  v_quantity integer;
  v_part public.parts%rowtype;
  v_job public.repair_jobs%rowtype;
  v_existing_payload jsonb;
  v_existing_result jsonb;
  v_added_ids jsonb := '[]'::jsonb;
  v_added_count integer := 0;
  v_parts_total numeric(12,2);
  v_result jsonb;
  v_updated integer;
begin
  if v_user_id is null or not public.is_workshop() then
    raise exception 'Active workshop access is required to allocate parts'
      using errcode = '42501';
  end if;
  if p_request_id is null or p_job_id is null
     or p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 1
     or jsonb_array_length(p_lines) > 50 then
    raise exception 'Submit between 1 and 50 valid stock-part lines';
  end if;

  -- Validate the entire request before any stock is changed.
  for v_item in select value from jsonb_array_elements(p_lines) as x(value)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item->>'part_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_item->>'quantity', '') !~ '^[1-9][0-9]{0,3}$' then
      raise exception 'Each allocation needs a valid catalogue part and whole quantity from 1 to 9999';
    end if;
  end loop;

  if exists (
    select value->>'part_id'
    from jsonb_array_elements(p_lines) as x(value)
    group by value->>'part_id'
    having count(*) > 1
  ) then
    raise exception 'A catalogue part appears more than once. Combine its quantities before saving';
  end if;

  -- A retry with the same key returns the original result without deducting
  -- stock twice. A key cannot be reused for a different payload.
  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(p_request_id::text));
  select request_payload, result
    into v_existing_payload, v_existing_result
  from public.workshop_job_part_requests
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_existing_payload is distinct from jsonb_build_object('job_id', p_job_id, 'lines', p_lines) then
      raise exception 'This request ID was already used for a different parts allocation';
    end if;
    return v_existing_result;
  end if;

  select * into v_job
  from public.repair_jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'Job card not found'; end if;
  if v_job.status not in ('Draft', 'Received', 'Diagnosing', 'Processing') then
    raise exception 'Workshop parts can only be allocated while a job is in progress';
  end if;

  -- Stable part ordering reduces lock contention when several devices allocate
  -- stock at the same time.
  for v_item in
    select value
    from jsonb_array_elements(p_lines) as x(value)
    order by (value->>'part_id')::uuid
  loop
    v_part_id := (v_item->>'part_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;

    select * into v_part
    from public.parts
    where id = v_part_id
    for update;
    if not found then raise exception 'A selected stock part no longer exists'; end if;
    if coalesce(v_part.cost_price, 0) <= 0 then
      raise exception 'Enter a positive cost price for % before using it on a job card', v_part.name;
    end if;
    if v_part.selling_price is null or v_part.selling_price < 0 then
      raise exception 'The catalogue selling price for % is invalid', v_part.name;
    end if;
    if coalesce(v_part.quantity_in_stock, 0) < v_quantity then
      raise exception 'Not enough stock is available for %', v_part.name;
    end if;

    update public.parts
    set quantity_in_stock = quantity_in_stock - v_quantity
    where id = v_part_id and quantity_in_stock >= v_quantity;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'Stock changed while allocating %. Refresh and try again', v_part.name;
    end if;

    insert into public.job_parts (
      job_id, part_id, part_name, quantity, price_at_time, cost_price, awaiting_accounting_price
    )
    values (
      p_job_id, v_part.id, v_part.name, v_quantity,
      round(v_part.selling_price, 2), round(v_part.cost_price, 2), false
    )
    returning id into v_part_id;

    v_added_ids := v_added_ids || jsonb_build_array(v_part_id);
    v_added_count := v_added_count + 1;
  end loop;

  select coalesce(sum(quantity * price_at_time), 0)
    into v_parts_total
  from public.job_parts
  where job_id = p_job_id and awaiting_accounting_price = false;

  update public.repair_jobs
  set parts_cost = round(v_parts_total, 2)
  where id = p_job_id;

  -- Invoice refresh is part of the same transaction. A failed invoice update
  -- rolls back the stock deduction, job-part rows and accounting trigger writes.
  perform public.sync_repair_job_invoice(p_job_id);

  v_result := jsonb_build_object(
    'job_id', p_job_id,
    'parts_count', v_added_count,
    'job_part_ids', v_added_ids,
    'parts_cost', round(v_parts_total, 2)
  );

  insert into public.workshop_job_part_requests (
    user_id, request_id, job_id, request_payload, result
  )
  values (
    v_user_id, p_request_id, p_job_id,
    jsonb_build_object('job_id', p_job_id, 'lines', p_lines),
    v_result
  );

  return v_result;
end;
$function$;

revoke all on function public.append_workshop_job_parts(uuid, uuid, jsonb) from public, anon;
grant execute on function public.append_workshop_job_parts(uuid, uuid, jsonb) to authenticated;

-- Preserve the existing invoice synchronisation logic and all of its later
-- customer-credit/payment fixes. Only extend its role gate so an authenticated
-- workshop user can trigger this deterministic recalculation via the RPC above.
do $patch$
declare
  function_definition text;
  old_guard text := 'if auth.uid() is null or public.current_access_level() < 1 then';
  new_guard text := 'if auth.uid() is null or (coalesce(public.current_access_level(), 0) < 1 and not public.is_workshop()) then';
begin
  function_definition := pg_get_functiondef('public.sync_repair_job_invoice(uuid)'::regprocedure);
  if position(old_guard in function_definition) > 0 then
    function_definition := replace(function_definition, old_guard, new_guard);
    execute function_definition;
  elsif position(new_guard in function_definition) = 0 then
    raise exception 'Could not safely identify the repair invoice synchronisation role check';
  end if;
end
$patch$;

commit;
