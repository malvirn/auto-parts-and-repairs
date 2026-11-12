-- Checklist draft permissions and generated blank checklist support.
begin;

-- The original checklist migration intentionally restricted insert columns.
-- status was added later, so granting it explicitly is required for draft inserts.
grant insert (status) on public.job_condition_reports to authenticated;

drop policy if exists "Authenticated staff can save vehicle condition reports" on public.job_condition_reports;
create policy "Authenticated staff can save vehicle condition reports"
on public.job_condition_reports for insert to authenticated
with check (
  auth.uid() is not null
  and coalesce(public.current_access_level(), 0) >= 1
  and confirmed_at is null
  and status = 'draft'
);

-- Inspection marks and audit are separate tables created by the inspection upgrade.
-- Keep access authenticated-only and let their existing RLS policies enforce staff roles.
grant select, insert, update, delete on public.job_condition_report_marks to authenticated;
grant select on public.job_condition_report_audit to authenticated;

-- Ensure staff can read draft checklist rows while the linked report policies
-- continue to enforce the minimum access level.
drop policy if exists "Staff can read inspection marks" on public.job_condition_report_marks;
create policy "Staff can read inspection marks" on public.job_condition_report_marks
for select to authenticated
using (auth.uid() is not null and coalesce(public.current_access_level(), 0) >= 1);

commit;
