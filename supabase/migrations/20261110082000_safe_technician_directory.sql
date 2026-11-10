-- Add only non-payroll contract dates to the authenticated safe employee directory.
begin;
create or replace view public.technician_directory as
select id, full_name, department, rank, job_title, employee_type, is_active, contract_end
from public.technicians;
revoke all on public.technician_directory from public, anon;
grant select on public.technician_directory to authenticated;
commit;