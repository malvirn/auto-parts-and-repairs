-- Permit authorised supervisors/admins to override missing close requirements,
-- including missing QC or customer sign-off. The reason and unmet checks are audited.
create or replace function public.close_repair_job_with_checks(
  p_job_id uuid,p_tested_by text,p_next_service_mileage integer,
  p_work_complete boolean,p_customer_signed_by text,p_override_reason text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  j public.repair_jobs%rowtype; readiness jsonb; actor_role text;
  reason text:=nullif(trim(coalesce(p_override_reason,'')),''); now_at timestamptz:=now();
  qc_name text:=nullif(trim(coalesce(p_tested_by,'')),'');
  customer_name text:=nullif(trim(coalesce(p_customer_signed_by,'')),'');
begin
  if auth.uid() is null then raise exception 'Sign in before closing a job card'; end if;
  select * into j from public.repair_jobs where id=p_job_id for update;
  if not found then raise exception 'Job card not found'; end if;
  if j.closed_at is not null then return jsonb_build_object('closed',true,'already_closed',true); end if;
  if qc_name is null and reason is null then raise exception 'Enter the QC / final inspector name'; end if;
  if p_next_service_mileage is null or p_next_service_mileage<0 then raise exception 'Enter a valid next service mileage'; end if;
  if p_work_complete is distinct from true and reason is null then raise exception 'Confirm that all work tasks are complete'; end if;
  if customer_name is null and reason is null then raise exception 'Record the customer sign-off name'; end if;
  readiness:=public.get_repair_job_close_readiness(p_job_id,p_work_complete,qc_name,customer_name);
  if coalesce((readiness->>'can_close')::boolean,false) then
    reason:=null;
  else
    if reason is null then raise exception 'Job card cannot close. Unmet conditions: %',readiness->'checks'; end if;
    select role into actor_role from public.profiles
      where id=(select auth.uid()) and coalesce(is_active,true);
    if not public.is_admin() and lower(coalesce(actor_role,'')) not in ('admin','supervisor','super_admin') then
      raise exception 'Only an authorised supervisor or administrator can override job-card closing';
    end if;
    if length(reason)<8 then raise exception 'Override reason must contain at least 8 characters'; end if;
    insert into public.repair_job_close_overrides(repair_job_id,actor_id,actor_role,reason,unmet_conditions)
    values(p_job_id,(select auth.uid()),coalesce(actor_role,'unknown'),reason,readiness->'checks');
  end if;
  perform set_config('app.repair_job_close','authorised',true);
  update public.repair_jobs set status='Ready for Pickup',work_ready=coalesce(p_work_complete,false),
    tested_by=qc_name,qc_signed_by=qc_name,qc_signed_at=case when qc_name is not null then now_at else null end,
    customer_signed_by=customer_name,customer_signed_at=case when customer_name is not null then now_at else null end,
    next_service_mileage=p_next_service_mileage,closed_at=now_at,ready_at=now_at
  where id=p_job_id;
  return jsonb_build_object('closed',true,'overridden',reason is not null,'readiness',readiness);
end; $$;
revoke execute on function public.close_repair_job_with_checks(uuid,text,integer,boolean,text,text) from public,anon;
grant execute on function public.close_repair_job_with_checks(uuid,text,integer,boolean,text,text) to authenticated;
