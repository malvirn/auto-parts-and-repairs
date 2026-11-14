create or replace function public.lookup_repair_portal(
  p_phone text,
  p_license_plate text,
  p_job_number integer default null,
  p_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  result jsonb;
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
  v_client_key text;
  v_lookup_key text;
  v_ip_attempts integer := 0;
  v_lookup_attempts integer := 0;
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_ip := coalesce(
    nullif(split_part(coalesce(v_headers->>'cf-connecting-ip', v_headers->>'x-real-ip', v_headers->>'x-forwarded-for', ''), ',', 1), ''),
    null
  );
  v_client_key := case when v_ip is not null then md5(lower(trim(v_ip))) else null end;

  if p_token is not null and p_job_number is not null then
    v_lookup_key := md5('token:' || p_job_number::text || ':' || p_token);
  else
    v_lookup_key := md5(
      'details:' ||
      regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') || ':' ||
      lower(regexp_replace(coalesce(p_license_plate, ''), '[[:space:]]', '', 'g'))
    );
  end if;

  if v_client_key is not null then
    perform pg_advisory_xact_lock(hashtext('repair-portal-ip:' || v_client_key));
  end if;
  perform pg_advisory_xact_lock(hashtext('repair-portal-lookup:' || v_lookup_key));

  if v_client_key is not null then
    select count(*) into v_ip_attempts from public.repair_portal_lookup_attempts
    where client_key = v_client_key and attempted_at > now() - interval '15 minutes';
  end if;
  select count(*) into v_lookup_attempts from public.repair_portal_lookup_attempts
  where lookup_key = v_lookup_key and attempted_at > now() - interval '15 minutes';

  if v_ip_attempts >= 12 or v_lookup_attempts >= 5 then
    raise exception 'Too many repair lookup attempts. Please wait 15 minutes before trying again.';
  end if;

  insert into public.repair_portal_lookup_attempts(client_key, lookup_key)
  values (v_client_key, v_lookup_key);
  delete from public.repair_portal_lookup_attempts where attempted_at < now() - interval '1 day';

  select jsonb_build_object(
    'job_number', r.job_number,
    'status', r.status,
    'total_cost', r.total_cost,
    'created_at', r.created_at,
    'completed_at', r.completed_at,
    'collected_at', r.collected_at,
    'customer_name', c.full_name,
    'vehicle', jsonb_build_object(
      'make', v.make, 'model', v.model, 'year', v.year,
      'body_type', v.body_type, 'license_plate', v.license_plate
    ),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('status', h.status, 'created_at', h.created_at) order by h.created_at)
      from public.status_history h where h.job_id = r.id
    ), '[]'::jsonb)
  )
  into result
  from public.repair_jobs r
  join public.customers c on c.id = r.customer_id
  join public.vehicles v on v.id = r.vehicle_id
  where (
    (p_token is not null and p_job_number is not null and r.job_number = p_job_number and r.portal_token::text = p_token)
    or (
      p_token is null
      and nullif(trim(p_phone), '') is not null
      and nullif(trim(p_license_plate), '') is not null
      and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
      and lower(regexp_replace(coalesce(v.license_plate, ''), '[[:space:]]', '', 'g')) =
          lower(regexp_replace(coalesce(p_license_plate, ''), '[[:space:]]', '', 'g'))
    )
  )
  limit 1;

  return result;
end;
$function$;

revoke all on function public.lookup_repair_portal(text, text, integer, text) from public;
grant execute on function public.lookup_repair_portal(text, text, integer, text) to anon, authenticated;
