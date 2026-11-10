-- Convert the employee directory to an invoker view. Staff see only
-- non-payroll columns; the full employee record is returned by an admin-only RPC.
begin;

create or replace view public.technician_directory
with (security_invoker = true) as
select id, full_name, department, rank, job_title, employee_type, is_active, contract_end
from public.technicians;

revoke all on public.technician_directory from public, anon, authenticated;
grant select on public.technician_directory to authenticated;

revoke all on public.technicians from public, anon, authenticated;
grant select (id, full_name, department, rank, job_title, employee_type, is_active, contract_end)
  on public.technicians to authenticated;
grant insert, update, delete on public.technicians to authenticated;

drop policy if exists technicians_directory_read on public.technicians;
create policy technicians_directory_read
  on public.technicians for select to authenticated
  using (public.current_access_level() >= 1);

create or replace function public.get_technicians_admin()
returns setof public.technicians
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_current_user_super_admin() then
    raise exception 'Only an active Super Admin can view full employee records'
      using errcode = '42501';
  end if;

  return query
  select * from public.technicians
  order by department, full_name;
end;
$$;

revoke all on function public.get_technicians_admin() from public, anon;
grant execute on function public.get_technicians_admin() to authenticated;

commit;