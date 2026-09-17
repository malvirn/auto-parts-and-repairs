-- ============================================================
-- REPAIR JOBS OVERHAUL — PHASE 6: Intake details
-- ============================================================
alter table public.repair_jobs add column if not exists fuel_level_in text;
alter table public.repair_jobs drop constraint if exists repair_jobs_fuel_level_check;
alter table public.repair_jobs add constraint repair_jobs_fuel_level_check check (fuel_level_in is null or fuel_level_in in ('Empty', '1/4', '1/2', '3/4', 'Full'));

alter table public.repair_jobs add column if not exists odometer_in integer;

-- A company car isn't picked up by "the customer" personally the way an
-- individual's own car is — it's collected by whichever staff member or
-- driver was sent. This captures who that was, specifically for company
-- (Internal) jobs.
alter table public.repair_jobs add column if not exists picked_up_by text;
