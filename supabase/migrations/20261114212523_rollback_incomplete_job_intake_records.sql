create or replace function public.finalize_repair_job_intake(
  p_job_id uuid,
  p_parts jsonb default '[]'::jsonb,
  p_incidentals jsonb default '[]'::jsonb,
  p_labour_cost numeric default 0,
  p_labour_hours numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_item jsonb;
  v_part_id uuid;
  v_quantity integer;
  v_part_name text;
  v_unit_price numeric;
  v_line_total numeric;
  v_parts_total numeric := 0;
  v_incidental_total numeric := 0;
  v_updated integer;
  v_job_id uuid;
  v_error text;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'You are not authorised to add parts to a job card.';
  end if;
  if p_job_id is null or coalesce(p_labour_cost, 0) < 0 or (p_labour_hours is not null and p_labour_hours < 0) then
    raise exception 'Invalid job card totals.';
  end if;
  if jsonb_typeof(coalesce(p_parts, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_incidentals, '[]'::jsonb)) <> 'array' then
    raise exception 'Job card parts and incidentals must be arrays.';
  end if;
  select id into v_job_id from public.repair_jobs where id = p_job_id for update;
  if v_job_id is null then raise exception 'Job card was not found.'; end if;

  begin
    for v_item in select value from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb))
    loop
      v_part_id := nullif(v_item->>'part_id', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::integer;
      v_part_name := nullif(trim(v_item->>'part_name'), '');
      v_unit_price := coalesce(nullif(v_item->>'price_at_time', '')::numeric, 0);
      v_line_total := coalesce(nullif(v_item->>'line_total', '')::numeric, v_unit_price * coalesce(v_quantity, 0));

      if v_part_id is null or v_quantity is null or v_quantity < 1
         or v_part_name is null or v_unit_price < 0 or v_line_total < 0 then
        raise exception 'A job card part has invalid details.';
      end if;
      update public.parts set quantity_in_stock = quantity_in_stock - v_quantity
      where id = v_part_id and quantity_in_stock >= v_quantity;
      get diagnostics v_updated = row_count;
      if v_updated <> 1 then raise exception 'Insufficient stock or missing part: %.', v_part_name; end if;

      insert into public.job_parts(job_id, part_id, part_name, quantity, price_at_time)
      values (p_job_id, v_part_id, v_part_name, v_quantity, v_unit_price);
      v_parts_total := v_parts_total + v_line_total;
    end loop;

    for v_item in select value from jsonb_array_elements(coalesce(p_incidentals, '[]'::jsonb))
    loop
      if nullif(trim(v_item->>'description'), '') is null
         or coalesce(nullif(v_item->>'amount', '')::numeric, -1) < 0 then
        raise exception 'A job card incidental has invalid details.';
      end if;
      insert into public.job_incidentals(job_id, description, amount)
      values (p_job_id, trim(v_item->>'description'), (v_item->>'amount')::numeric);
      v_incidental_total := v_incidental_total + (v_item->>'amount')::numeric;
    end loop;

    update public.repair_jobs
    set labour_cost = coalesce(p_labour_cost, 0),
        labour_hours = p_labour_hours,
        parts_cost = v_parts_total,
        incidentals_cost = v_incidental_total
    where id = p_job_id;
  exception when others then
    get stacked diagnostics v_error = message_text;
    -- The exception block rolls back every stock/line/total write above.
    delete from public.repair_jobs where id = p_job_id;
    return jsonb_build_object('error', v_error);
  end;

  return jsonb_build_object(
    'job_id', p_job_id,
    'parts_cost', v_parts_total,
    'incidentals_cost', v_incidental_total,
    'parts_count', jsonb_array_length(coalesce(p_parts, '[]'::jsonb))
  );
end;
$function$;

revoke all on function public.finalize_repair_job_intake(uuid, jsonb, jsonb, numeric, numeric) from public, anon;
grant execute on function public.finalize_repair_job_intake(uuid, jsonb, jsonb, numeric, numeric) to authenticated;
