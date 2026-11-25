begin;

-- Identify who created a checklist so workshop users can edit only their own
-- unconfirmed drafts. Existing records remain unowned and staff access is unchanged.
alter table public.job_condition_reports
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.job_condition_reports
  alter column created_by set default auth.uid();

alter table public.job_condition_reports enable row level security;
alter table public.job_condition_report_marks enable row level security;

drop policy if exists job_condition_reports_workshop_own_read
  on public.job_condition_reports;
create policy job_condition_reports_workshop_own_read
on public.job_condition_reports
for select
to authenticated
using (
  public.is_workshop()
  and created_by = (select auth.uid())
);

drop policy if exists job_condition_reports_workshop_draft_insert
  on public.job_condition_reports;
create policy job_condition_reports_workshop_draft_insert
on public.job_condition_reports
for insert
to authenticated
with check (
  public.is_workshop()
  and created_by = (select auth.uid())
  and status = 'draft'
  and confirmed_at is null
  and voided_at is null
  and customer_id is not null
  and vehicle_id is not null
  and exists (
    select 1
    from public.customers c
    join public.vehicles v on v.customer_id = c.id
    where c.id = public.job_condition_reports.customer_id
      and v.id = public.job_condition_reports.vehicle_id
      and c.deleted_at is null
  )
  and (
    job_id is null
    or exists (
      select 1
      from public.repair_jobs j
      where j.id = public.job_condition_reports.job_id
        and j.customer_id = public.job_condition_reports.customer_id
        and j.vehicle_id = public.job_condition_reports.vehicle_id
        and j.status in ('Draft', 'Received', 'Diagnosing', 'Processing')
    )
  )
);

drop policy if exists job_condition_reports_workshop_draft_update
  on public.job_condition_reports;
create policy job_condition_reports_workshop_draft_update
on public.job_condition_reports
for update
to authenticated
using (
  public.is_workshop()
  and created_by = (select auth.uid())
  and status = 'draft'
  and confirmed_at is null
  and voided_at is null
)
with check (
  public.is_workshop()
  and created_by = (select auth.uid())
  and status = 'draft'
  and confirmed_at is null
  and voided_at is null
  and customer_id is not null
  and vehicle_id is not null
  and exists (
    select 1
    from public.customers c
    join public.vehicles v on v.customer_id = c.id
    where c.id = public.job_condition_reports.customer_id
      and v.id = public.job_condition_reports.vehicle_id
      and c.deleted_at is null
  )
  and (
    job_id is null
    or exists (
      select 1
      from public.repair_jobs j
      where j.id = public.job_condition_reports.job_id
        and j.customer_id = public.job_condition_reports.customer_id
        and j.vehicle_id = public.job_condition_reports.vehicle_id
        and j.status in ('Draft', 'Received', 'Diagnosing', 'Processing')
    )
  )
);

-- Marks can be read for the user's own checklist, but changed only while
-- that checklist is still an unconfirmed draft.
drop policy if exists job_condition_report_marks_workshop_own_read
  on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_own_read
on public.job_condition_report_marks
for select
to authenticated
using (
  public.is_workshop()
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.created_by = (select auth.uid())
      and r.voided_at is null
  )
);

drop policy if exists job_condition_report_marks_workshop_draft_insert
  on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_draft_insert
on public.job_condition_report_marks
for insert
to authenticated
with check (
  public.is_workshop()
  and marked_by = (select auth.uid())
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.created_by = (select auth.uid())
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

drop policy if exists job_condition_report_marks_workshop_draft_update
  on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_draft_update
on public.job_condition_report_marks
for update
to authenticated
using (
  public.is_workshop()
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.created_by = (select auth.uid())
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
)
with check (
  public.is_workshop()
  and marked_by = (select auth.uid())
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.created_by = (select auth.uid())
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

drop policy if exists job_condition_report_marks_workshop_draft_delete
  on public.job_condition_report_marks;
create policy job_condition_report_marks_workshop_draft_delete
on public.job_condition_report_marks
for delete
to authenticated
using (
  public.is_workshop()
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id = job_condition_report_marks.inspection_id
      and r.created_by = (select auth.uid())
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

-- Inspection images are stored under <checklist UUID>/<area>.jpg.
-- Workshop may read its own draft/completed images and write only draft images.
drop policy if exists workshop_read_own_vehicle_inspection_photos
  on storage.objects;
create policy workshop_read_own_vehicle_inspection_photos
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vehicle-inspections'
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.created_by = (select auth.uid())
      and r.voided_at is null
  )
);

drop policy if exists workshop_upload_own_vehicle_inspection_photos
  on storage.objects;
create policy workshop_upload_own_vehicle_inspection_photos
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vehicle-inspections'
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.created_by = (select auth.uid())
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

drop policy if exists workshop_update_own_vehicle_inspection_photos
  on storage.objects;
create policy workshop_update_own_vehicle_inspection_photos
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vehicle-inspections'
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.created_by = (select auth.uid())
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
)
with check (
  bucket_id = 'vehicle-inspections'
  and exists (
    select 1
    from public.job_condition_reports r
    where r.id::text = split_part(storage.objects.name, '/', 1)
      and r.created_by = (select auth.uid())
      and r.status = 'draft'
      and r.confirmed_at is null
      and r.voided_at is null
  )
);

-- Keep the existing completion validation and audit insert. Only extend the
-- role gate, and require workshop users to complete checklists they created.
do $patch$
declare
  function_definition text;
  old_guard text := 'if auth.uid() is null or coalesce(public.current_access_level(),0) < 1 then';
  new_guard text := 'if auth.uid() is null or (coalesce(public.current_access_level(),0) < 1 and not public.is_workshop()) then';
  old_row_guard text := E'if not found then raise exception ''Inspection not found''; end if;';
  new_row_guard text := E'if not found then raise exception ''Inspection not found''; end if;\n  if public.is_workshop() and v_row.created_by is distinct from auth.uid() then\n    raise exception ''Workshop users can complete only their own checklists'' using errcode = ''42501'';\n  end if;';
begin
  function_definition := pg_get_functiondef('public.complete_vehicle_inspection(uuid)'::regprocedure);

  if position(old_guard in function_definition) > 0 then
    function_definition := replace(function_definition, old_guard, new_guard);
  elsif position(new_guard in function_definition) = 0 then
    raise exception 'Could not safely identify the inspection completion role check';
  end if;

  if position(old_row_guard in function_definition) > 0 then
    function_definition := replace(function_definition, old_row_guard, new_row_guard);
  elsif position(new_row_guard in function_definition) = 0 then
    raise exception 'Could not safely identify the inspection ownership check';
  end if;

  execute function_definition;
end
$patch$;

commit;
