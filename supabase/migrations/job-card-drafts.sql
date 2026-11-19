-- Draft job cards: a job card saved without a vehicle checklist stays in status 'Draft'.
-- Entering the checklist number links it (customer name + vehicle registration must match)
-- and moves the job card out of Draft to 'Received'.
begin;

create or replace function public.link_draft_job_card_to_checklist(p_job_id uuid, p_checklist_number bigint)
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

  select * into v_job from public.repair_jobs where id = p_job_id for update;
  if not found then raise exception 'Job card not found'; end if;
  if v_job.status <> 'Draft' then raise exception 'Only draft job cards can be linked from here'; end if;

  select * into v_report from public.job_condition_reports where checklist_number = p_checklist_number;
  if not found then raise exception 'No checklist found with number %', p_checklist_number; end if;

  -- Existing function checks: confirmed, name + registration match, not linked elsewhere; copies fuel + odometer.
  perform public.link_vehicle_condition_checklist(v_report.id, p_job_id);

  update public.repair_jobs set status = 'Received' where id = p_job_id;
end;
$$;

revoke all on function public.link_draft_job_card_to_checklist(uuid, bigint) from public, anon, authenticated;
grant execute on function public.link_draft_job_card_to_checklist(uuid, bigint) to authenticated;

commit;
