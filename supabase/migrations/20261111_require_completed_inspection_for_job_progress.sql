create or replace function public.require_completed_vehicle_inspection_for_job()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if old.status::text='Draft' and new.status::text<>'Draft' and not exists(
  select 1 from public.job_condition_reports r
  where r.job_id=new.id and r.status='completed' and r.confirmed_at is not null
 ) then
  raise exception 'Complete the linked vehicle inspection before moving this job card beyond Draft';
 end if;
 return new;
end $$;
drop trigger if exists trg_require_completed_vehicle_inspection on public.repair_jobs;
create trigger trg_require_completed_vehicle_inspection before update of status on public.repair_jobs
for each row execute function public.require_completed_vehicle_inspection_for_job();