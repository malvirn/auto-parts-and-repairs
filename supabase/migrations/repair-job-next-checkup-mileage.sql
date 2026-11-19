begin;

alter table public.repair_jobs
  add column if not exists next_service_mileage integer;

alter table public.repair_jobs
  drop constraint if exists repair_jobs_next_service_mileage_valid;

alter table public.repair_jobs
  add constraint repair_jobs_next_service_mileage_valid
  check (next_service_mileage is null or next_service_mileage >= 0);

comment on column public.repair_jobs.next_service_mileage is
  'Vehicle mileage at which the next checkup/service is due.';

commit;
