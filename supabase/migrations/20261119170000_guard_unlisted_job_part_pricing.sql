create or replace function public.price_unlisted_job_part(
  p_job_part_id uuid,
  p_cost_price numeric,
  p_markup_pct numeric,
  p_selling_price numeric default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_job_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select job_id into v_job_id
  from public.job_parts
  where id = p_job_part_id;
  if v_job_id is null then
    raise exception 'Job-card part not found';
  end if;

  perform public.price_job_card_parts(
    v_job_id,
    jsonb_build_array(jsonb_build_object(
      'id', p_job_part_id::text,
      'cost_price', p_cost_price,
      'markup_pct', p_markup_pct,
      'selling_price', coalesce(p_selling_price, round(p_cost_price * (1 + p_markup_pct / 100), 2))
    ))
  );
end;
$function$;

revoke all on function public.price_unlisted_job_part(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.price_unlisted_job_part(uuid, numeric, numeric, numeric) to authenticated;