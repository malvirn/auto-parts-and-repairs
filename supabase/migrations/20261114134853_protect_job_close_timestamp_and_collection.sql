-- Prevent bypassing close requirements by setting closed_at directly or
-- inserting/updating a job straight to Collected before verified closure.
create or replace function public.guard_repair_job_close()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if (new.status::text in ('Ready for Pickup','Collected') or new.closed_at is not null)
       and current_setting('app.repair_job_close',true) is distinct from 'authorised' then
      raise exception 'Use the verified Close Job Card action. New job cards cannot be inserted as closed or collected.';
    end if;
  else
    if old.closed_at is null and new.closed_at is not null
       and current_setting('app.repair_job_close',true) is distinct from 'authorised' then
      raise exception 'Only the verified Close Job Card action may set the closed timestamp.';
    end if;
    if new.status::text='Ready for Pickup'
       and coalesce(old.status::text,'') <> 'Ready for Pickup'
       and current_setting('app.repair_job_close',true) is distinct from 'authorised' then
      raise exception 'Use the verified Close Job Card action. Direct status changes cannot close a job card.';
    end if;
    if new.status::text='Collected'
       and coalesce(old.status::text,'') <> 'Collected'
       and old.closed_at is null then
      raise exception 'A vehicle cannot be marked collected before its job card has been closed.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_repair_job_close_insert on public.repair_jobs;
create trigger guard_repair_job_close_insert before insert on public.repair_jobs
for each row execute function public.guard_repair_job_close();
drop trigger if exists guard_repair_job_close on public.repair_jobs;
create trigger guard_repair_job_close before update of status,closed_at on public.repair_jobs
for each row execute function public.guard_repair_job_close();
