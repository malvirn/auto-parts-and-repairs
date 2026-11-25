-- Allow active workshop users to create, read and complete vehicle checklists.
-- Workshop can only edit unconfirmed, non-voided drafts. It cannot delete,
-- void, reopen, or link a checklist through the invoice-producing link RPC.
-- Job linkage is allowed only at initial insert and must match the selected job.

begin;

drop policy if exists job_condition_reports_workshop_read on public.job_condition_reports;
create policy job_condition_reports_workshop_read
on public.job_condition_reports
for select to authenticated
using (public.is_workshop());

drop policy if exists job_condition_reports_workshop_insert_draft on public.job_condition_reports;
create policy job_condition_reports_workshop_insert_draft
on public.job_condition_reports
for insert to authenticated
with check (
  public.is_workshop()
  and status = 'draft'
  and confirmed_at is null
  and voided_at is null
  and (
    job_id is null
    or exists (
      select 1
      from public.repair_jobs j
      where j.id = job_condition_reports.job_id
        and j.customer_id is not distinct from job_condition_reports.customer_id
        and j.vehicle_id is not distinct from job_condition_reports.vehicle_id
    )
  )
);

drop policy if exists job_condition_reports_workshop_update_draft on public.job_condition_reports;
create policy job_condition_reports_workshop_update_draft
on public.job_condition_reports
for update to authenticated
using (
  public.is_workshop()
  and status = 'draft'
  and confirmed_at is null
  and voided_at is null
)
with check (
  public.is_workshop()
  and status = 'draft'
  and confirmed_at is null
  and voided_at is null
);

drop policy if exists job_condition_report_marks_workshop_read on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_read
on public.job_condition_report_marks
for select to authenticated
using (public.is_workshop());

drop policy if exists job_condition_report_marks_workshop_insert_draft on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_insert_draft
on public.job_condition_report_marks
for insert to authenticated
with check (
  public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

drop policy if exists job_condition_report_marks_workshop_update_draft on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_update_draft
on public.job_condition_report_marks
for update to authenticated
using (
  public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
)
with check (
  public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

drop policy if exists job_condition_report_marks_workshop_delete_draft on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_delete_draft
on public.job_condition_report_marks
for delete to authenticated
using (
  public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

-- Photos are private and scoped to an existing inspection. Workshop may read
-- inspection photos, but may only upload, replace or remove photos on drafts.
drop policy if exists workshop_read_vehicle_inspection_photos on storage.objects;
create policy workshop_read_vehicle_inspection_photos
on storage.objects
for select to authenticated
using (
  bucket_id = 'vehicle-inspections'
  and public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.voided_at is null
  )
);

drop policy if exists workshop_insert_vehicle_inspection_photos on storage.objects;
create policy workshop_insert_vehicle_inspection_photos
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'vehicle-inspections'
  and public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

drop policy if exists workshop_update_vehicle_inspection_photos on storage.objects;
create policy workshop_update_vehicle_inspection_photos
on storage.objects
for update to authenticated
using (
  bucket_id = 'vehicle-inspections'
  and public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
)
with check (
  bucket_id = 'vehicle-inspections'
  and public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

drop policy if exists workshop_delete_vehicle_inspection_photos on storage.objects;
create policy workshop_delete_vehicle_inspection_photos
on storage.objects
for delete to authenticated
using (
  bucket_id = 'vehicle-inspections'
  and public.is_workshop()
  and exists (
    select 1 from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

-- Completing an inspection is permitted for workshop. Linking, voiding,
-- reopening and invoice creation remain outside this role's permissions.
create or replace function public.complete_vehicle_inspection(p_inspection_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.job_condition_reports%rowtype;
  v_done timestamptz := now();
begin
  if auth.uid() is null
     or (coalesce(public.current_access_level(), 0) < 1 and not public.is_workshop()) then
    raise exception 'Staff access is required to complete an inspection' using errcode = '42501';
  end if;

  select * into v_row
  from public.job_condition_reports
  where id = p_inspection_id
  for update;

  if not found then raise exception 'Inspection not found'; end if;
  if v_row.status = 'completed' or v_row.confirmed_at is not null then
    raise exception 'This inspection is already completed';
  end if;
  if v_row.voided_at is not null then
    raise exception 'A voided inspection cannot be completed';
  end if;

  if nullif(btrim(v_row.customer_name), '') is null
    or nullif(btrim(v_row.vehicle_registration), '') is null
    or nullif(btrim(v_row.checked_by), '') is null
    or v_row.fuel_level_in is null
    or v_row.fuel_level_in not in ('Empty', '1/4', '1/2', '3/4', 'Full')
    or v_row.odometer_in is null or v_row.odometer_in < 0 then
    raise exception 'Enter customer, registration, inspector, fuel level and mileage before completing';
  end if;

  if v_row.job_id is not null and not exists (
    select 1 from public.repair_jobs j
    where j.id = v_row.job_id
      and j.customer_id is not distinct from v_row.customer_id
      and j.vehicle_id is not distinct from v_row.vehicle_id
  ) then
    raise exception 'The linked job card must match this customer and vehicle';
  end if;

  update public.job_condition_reports
  set status = 'completed',
      completed_by = auth.uid(),
      completed_at = v_done,
      confirmed_by = auth.uid(),
      confirmed_at = v_done,
      updated_at = v_done
  where id = p_inspection_id;

  insert into public.job_condition_report_audit(inspection_id, action, performed_by, performed_at)
  values (p_inspection_id, 'completed', auth.uid(), v_done);

  return v_done;
end
$function$;

revoke all on function public.complete_vehicle_inspection(uuid) from public, anon;
grant execute on function public.complete_vehicle_inspection(uuid) to authenticated;

commit;
