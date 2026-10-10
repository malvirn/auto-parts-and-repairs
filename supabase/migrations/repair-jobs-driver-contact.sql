-- Company cars: record who brought the vehicle in. Applied 2026-10-10.
alter table public.repair_jobs add column if not exists driver_name text, add column if not exists driver_phone text;
comment on column public.repair_jobs.driver_name is 'Person who brought the vehicle in (company cars)';
comment on column public.repair_jobs.driver_phone is 'Phone of the person who brought the vehicle in';
