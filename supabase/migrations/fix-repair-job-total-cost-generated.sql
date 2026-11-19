begin;

alter table public.repair_jobs
  add column if not exists labour_cost numeric(12,2) not null default 0,
  add column if not exists parts_cost numeric(12,2) not null default 0,
  add column if not exists incidentals_cost numeric(12,2) not null default 0;

create or replace function public.sync_repair_job_total_cost()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.total_cost := coalesce(new.labour_cost, 0)
                  + coalesce(new.parts_cost, 0)
                  + coalesce(new.incidentals_cost, 0);
  return new;
end;
$$;

do $$
declare
  v_exists boolean;
  v_generated text;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'repair_jobs'
      and column_name = 'total_cost'
  ) into v_exists;

  if not v_exists then
    alter table public.repair_jobs
      add column total_cost numeric(12,2) not null default 0;
  end if;

  select is_generated
  into v_generated
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'repair_jobs'
    and column_name = 'total_cost';

  if v_generated = 'ALWAYS' then
    drop trigger if exists sync_repair_job_total_cost_trigger on public.repair_jobs;
  else
    update public.repair_jobs
    set total_cost = coalesce(labour_cost, 0)
                   + coalesce(parts_cost, 0)
                   + coalesce(incidentals_cost, 0);

    drop trigger if exists sync_repair_job_total_cost_trigger on public.repair_jobs;
    create trigger sync_repair_job_total_cost_trigger
    before insert or update on public.repair_jobs
    for each row execute function public.sync_repair_job_total_cost();
  end if;
end;
$$;

commit;
