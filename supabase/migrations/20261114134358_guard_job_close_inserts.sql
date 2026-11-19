-- Prevent direct inserts as closed. Only the verified close RPC may transition a job to Ready for Pickup.
create or replace function public.guard_repair_job_close()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    if new.status::text='Ready for Pickup'
       and current_setting('app.repair_job_close',true) is distinct from 'authorised' then
      raise exception 'Use the verified Close Job Card action. New job cards cannot be inserted as closed.';
    end if;
  elsif new.status::text='Ready for Pickup'
        and coalesce(old.status::text,'') <> 'Ready for Pickup'
        and current_setting('app.repair_job_close',true) is distinct from 'authorised' then
    raise exception 'Use the verified Close Job Card action. Direct status changes cannot close a job card.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_repair_job_close_insert on public.repair_jobs;
create trigger guard_repair_job_close_insert before insert on public.repair_jobs
for each row execute function public.guard_repair_job_close();
