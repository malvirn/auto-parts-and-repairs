-- Fix the output-column `id` shadowing profiles.id in the Accounting queue RPC.
-- Safe to apply after job-card-daily-updates-accounting-parts.sql.

create or replace function public.get_unpriced_job_parts()
returns table (
  id uuid,
  part_name text,
  quantity numeric,
  job_number text,
  customer_name text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and (profile.role in ('accounting', 'super_admin') or coalesce(profile.access_level, 0) >= 2)
  ) then
    raise exception 'Accounting access is required to review unpriced job parts';
  end if;

  return query
  select jp.id, jp.part_name, jp.quantity::numeric, job.job_number::text, customer.full_name
  from public.job_parts as jp
  join public.repair_jobs as job on job.id = jp.job_id
  left join public.customers as customer on customer.id = job.customer_id
  where jp.awaiting_accounting_price = true
  order by job.created_at, jp.id;
end;
$$;

revoke all on function public.get_unpriced_job_parts() from public, anon;
grant execute on function public.get_unpriced_job_parts() to authenticated;
