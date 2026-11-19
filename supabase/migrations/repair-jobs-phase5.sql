-- ============================================================
-- REPAIR JOBS OVERHAUL — PHASE 5: Job card itemized incidentals
-- ============================================================
-- Small ad-hoc costs that add up during a repair (oil used to clean the
-- engine, rags, misc consumables) — separate from job_parts, since these
-- aren't real shop inventory with stock to deduct, just a cost line.
-- ============================================================

create table if not exists public.job_incidentals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.repair_jobs (id) on delete cascade,
  description text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  created_at timestamp with time zone not null default now()
);

create index if not exists idx_job_incidentals_job on public.job_incidentals (job_id);

alter table public.repair_jobs add column if not exists incidentals_cost numeric(10, 2) not null default 0;

-- ---- Safely fold incidentals into total_cost ----
-- total_cost only ever gets updated by generated-column logic in this
-- app (the client never writes to it directly), which means it's almost
-- certainly a Postgres GENERATED column already. This checks that
-- directly rather than assuming, and only recreates it if confirmed —
-- an uncontrolled drop-and-hope here could leave the column missing
-- entirely if something unexpected went wrong.
do $$
declare
  v_is_generated boolean;
begin
  select (is_generated = 'ALWAYS') into v_is_generated
  from information_schema.columns
  where table_schema = 'public' and table_name = 'repair_jobs' and column_name = 'total_cost';

  if v_is_generated then
    alter table public.repair_jobs drop column total_cost;
    alter table public.repair_jobs add column total_cost numeric generated always as (coalesce(labour_cost, 0) + coalesce(parts_cost, 0) + coalesce(incidentals_cost, 0)) stored;
    raise notice 'total_cost recreated as a generated column, now including incidentals_cost.';
  else
    raise notice 'total_cost was not detected as a generated column (or does not exist) — it was left untouched. Incidentals are still tracked in job_incidentals/incidentals_cost, but total_cost may need a manual look if it is not reflecting them.';
  end if;
end $$;

alter table public.job_incidentals enable row level security;

drop policy if exists job_incidentals_operational on public.job_incidentals;
create policy job_incidentals_operational on public.job_incidentals
  for all using (public.is_operational()) with check (public.is_operational());
