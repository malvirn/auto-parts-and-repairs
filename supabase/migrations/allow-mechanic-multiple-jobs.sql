-- A mechanic can now be assigned to several open job cards at once. Applied 2026-10-11.
-- (Re-enable with: alter table public.repair_jobs enable trigger trg_check_mechanic_availability;)
alter table public.repair_jobs disable trigger trg_check_mechanic_availability;
