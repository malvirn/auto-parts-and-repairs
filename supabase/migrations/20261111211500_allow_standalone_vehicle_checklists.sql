-- Allow completed vehicle inspections to exist independently of repair job cards.
create or replace function public.complete_vehicle_inspection(p_inspection_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = 'pg_catalog', 'public'
as $function$
declare
  v_row public.job_condition_reports%rowtype;
  v_done timestamptz := now();
begin
  if auth.uid() is null or coalesce(public.current_access_level(),0) < 1 then
    raise exception 'Staff access is required to complete an inspection' using errcode='42501';
  end if;

  select * into v_row from public.job_condition_reports
  where id=p_inspection_id for update;

  if not found then raise exception 'Inspection not found'; end if;
  if v_row.status='completed' or v_row.confirmed_at is not null then
    raise exception 'This inspection is already completed';
  end if;
  if v_row.voided_at is not null then raise exception 'A voided inspection cannot be completed'; end if;

  if nullif(btrim(v_row.customer_name),'') is null
    or nullif(btrim(v_row.vehicle_registration),'') is null
    or nullif(btrim(v_row.checked_by),'') is null
    or v_row.fuel_level_in is null
    or v_row.fuel_level_in not in ('Empty','1/4','1/2','3/4','Full')
    or v_row.odometer_in is null or v_row.odometer_in < 0 then
    raise exception 'Enter customer, registration, inspector, fuel level and mileage before completing';
  end if;

  -- A job card is optional. If linked, it must belong to this customer and vehicle.
  if v_row.job_id is not null and not exists (
    select 1 from public.repair_jobs j
    where j.id=v_row.job_id
      and j.customer_id is not distinct from v_row.customer_id
      and j.vehicle_id is not distinct from v_row.vehicle_id
  ) then
    raise exception 'The linked job card must match this customer and vehicle';
  end if;

  update public.job_condition_reports
  set status='completed', completed_by=auth.uid(), completed_at=v_done,
      confirmed_by=auth.uid(), confirmed_at=v_done, updated_at=v_done
  where id=p_inspection_id;

  insert into public.job_condition_report_audit(inspection_id,action,performed_by,performed_at)
  values(p_inspection_id,'completed',auth.uid(),v_done);

  return v_done;
end
$function$;
