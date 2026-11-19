begin;

alter table public.customers
  add column if not exists deleted_at timestamptz;

create index if not exists customers_active_name_idx
  on public.customers (full_name)
  where deleted_at is null;

alter table public.repair_jobs
  add column if not exists labour_mode text not null default 'time_based';

alter table public.repair_jobs
  drop constraint if exists repair_jobs_labour_mode_check;

alter table public.repair_jobs
  add constraint repair_jobs_labour_mode_check
  check (labour_mode in ('time_based', 'provider_estimate'));

commit;
