begin;

alter table public.repair_jobs
  add column if not exists job_description text,
  add column if not exists tested_by text,
  add column if not exists next_service_mileage integer,
  add column if not exists closed_at timestamptz;

alter table public.quotations
  add column if not exists vehicle_details jsonb not null default '{}'::jsonb;

commit;
