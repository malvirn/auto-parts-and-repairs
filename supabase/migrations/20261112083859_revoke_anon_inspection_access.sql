-- Inspection reports are internal workshop records. Do not expose their
-- marks or audit trail to anonymous Data API callers.
begin;

revoke all on public.job_condition_report_marks from anon, public;
revoke all on public.job_condition_report_audit from anon, public;

grant select, insert, update, delete on public.job_condition_report_marks to authenticated;
grant select on public.job_condition_report_audit to authenticated;

commit;
