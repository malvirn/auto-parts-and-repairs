begin;

create or replace function public.link_vehicle_condition_checklist(p_checklist_id uuid, p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_report public.job_condition_reports%rowtype;
  v_job public.repair_jobs%rowtype;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'Staff access is required to link a vehicle checklist';
  end if;

  select * into v_report
  from public.job_condition_reports
  where id = p_checklist_id
  for update;
  if not found then raise exception 'Vehicle checklist not found'; end if;

  select * into v_job
  from public.repair_jobs
  where id = p_job_id;
  if not found then raise exception 'Job card not found'; end if;
  if v_report.confirmed_at is null then raise exception 'Confirm the checklist before linking it'; end if;

  if not exists (
    select 1
    from public.customers customer
    join public.vehicles vehicle on vehicle.id = v_job.vehicle_id
    where customer.id = v_job.customer_id
      and upper(btrim(customer.full_name)) = upper(btrim(v_report.customer_name))
      and upper(btrim(vehicle.license_plate)) = upper(btrim(v_report.vehicle_registration))
  ) then
    raise exception 'The checklist customer name and vehicle registration must match the job card';
  end if;

  if v_report.job_id is not null and v_report.job_id <> p_job_id then
    raise exception 'This checklist is already linked to another job card';
  end if;

  update public.job_condition_reports
  set job_id = p_job_id,
      customer_id = v_job.customer_id,
      vehicle_id = v_job.vehicle_id,
      updated_at = now()
  where id = p_checklist_id;

  update public.repair_jobs
  set checklist_number = v_report.checklist_number,
      fuel_level_in = v_report.fuel_level_in,
      odometer_in = v_report.odometer_in
  where id = p_job_id;
end;
$$;

revoke all on function public.link_vehicle_condition_checklist(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_vehicle_condition_checklist(uuid, uuid) to authenticated;

commit;
