-- Vehicle inspection upgrade. Preserves existing job_condition_reports rows.
alter table public.job_condition_reports
  add column if not exists inspection_no text,
  add column if not exists status text not null default 'draft',
  add column if not exists completed_by uuid,
  add column if not exists completed_at timestamptz;

update public.job_condition_reports
set inspection_no='CL-'||lpad(checklist_number::text,6,'0')
where inspection_no is null;

update public.job_condition_reports
set status='completed', completed_by=coalesce(completed_by,confirmed_by),
    completed_at=coalesce(completed_at,confirmed_at)
where confirmed_at is not null and status='draft';

alter table public.job_condition_reports drop constraint if exists job_condition_reports_status_check;
alter table public.job_condition_reports add constraint job_condition_reports_status_check
  check(status in ('draft','completed'));
create unique index if not exists job_condition_reports_inspection_no_uidx on public.job_condition_reports(inspection_no);
create index if not exists job_condition_reports_status_idx on public.job_condition_reports(status,updated_at desc);

create or replace function public.set_job_condition_inspection_no()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.inspection_no is null then new.inspection_no:='CL-'||lpad(new.checklist_number::text,6,'0'); end if;
 return new;
end $$;
drop trigger if exists trg_job_condition_inspection_no on public.job_condition_reports;
create trigger trg_job_condition_inspection_no before insert or update of checklist_number
on public.job_condition_reports for each row execute function public.set_job_condition_inspection_no();

create table if not exists public.job_condition_report_marks(
 id uuid primary key default gen_random_uuid(),
 inspection_id uuid not null references public.job_condition_reports(id) on delete cascade,
 area_code text not null,
 condition text not null,
 note text,
 photo_path text,
 marked_by uuid default auth.uid(),
 marked_at timestamptz not null default now(),
 constraint job_condition_report_marks_area_unique unique(inspection_id,area_code),
 constraint job_condition_report_marks_condition_check
 check(condition in ('Scratch','Dent','Crack','Chip','Broken','Missing','Stretched','Worn','Flat','Bald'))
);
create index if not exists job_condition_report_marks_inspection_idx on public.job_condition_report_marks(inspection_id);
alter table public.job_condition_report_marks enable row level security;

drop policy if exists "Staff can read inspection marks" on public.job_condition_report_marks;
create policy "Staff can read inspection marks" on public.job_condition_report_marks for select to authenticated
using(coalesce(public.current_access_level(),0)>=1);
drop policy if exists "Staff can add draft inspection marks" on public.job_condition_report_marks;
create policy "Staff can add draft inspection marks" on public.job_condition_report_marks for insert to authenticated
with check(coalesce(public.current_access_level(),0)>=1 and exists(
 select 1 from public.job_condition_reports r where r.id=inspection_id and r.status='draft' and r.confirmed_at is null));
drop policy if exists "Staff can update draft inspection marks" on public.job_condition_report_marks;
create policy "Staff can update draft inspection marks" on public.job_condition_report_marks for update to authenticated
using(coalesce(public.current_access_level(),0)>=1 and exists(
 select 1 from public.job_condition_reports r where r.id=inspection_id and r.status='draft' and r.confirmed_at is null))
with check(coalesce(public.current_access_level(),0)>=1 and exists(
 select 1 from public.job_condition_reports r where r.id=inspection_id and r.status='draft' and r.confirmed_at is null));
drop policy if exists "Staff can remove draft inspection marks" on public.job_condition_report_marks;
create policy "Staff can remove draft inspection marks" on public.job_condition_report_marks for delete to authenticated
using(coalesce(public.current_access_level(),0)>=1 and exists(
 select 1 from public.job_condition_reports r where r.id=inspection_id and r.status='draft' and r.confirmed_at is null));

create table if not exists public.job_condition_report_audit(
 id uuid primary key default gen_random_uuid(),
 inspection_id uuid not null references public.job_condition_reports(id) on delete cascade,
 action text not null check(action in ('completed','reopened')),
 reason text,
 performed_by uuid not null default auth.uid(),
 performed_at timestamptz not null default now()
);
create index if not exists job_condition_report_audit_inspection_idx on public.job_condition_report_audit(inspection_id,performed_at desc);
alter table public.job_condition_report_audit enable row level security;
drop policy if exists "Staff can read inspection audit" on public.job_condition_report_audit;
create policy "Staff can read inspection audit" on public.job_condition_report_audit for select to authenticated
using(coalesce(public.current_access_level(),0)>=1);

drop policy if exists "Staff can update vehicle condition reports" on public.job_condition_reports;
create policy "Staff can update vehicle condition reports" on public.job_condition_reports for update to authenticated
using(auth.uid() is not null and coalesce(public.current_access_level(),0)>=1 and status='draft' and confirmed_at is null)
with check(auth.uid() is not null and coalesce(public.current_access_level(),0)>=1 and status='draft' and confirmed_at is null);
drop policy if exists "Staff can delete vehicle condition reports" on public.job_condition_reports;
create policy "Staff can delete vehicle condition reports" on public.job_condition_reports for delete to authenticated
using(auth.uid() is not null and coalesce(public.current_access_level(),0)>=1 and status='draft' and confirmed_at is null);

create or replace function public.complete_vehicle_inspection(p_inspection_id uuid)
returns timestamptz language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.job_condition_reports%rowtype; v_done timestamptz:=now();
begin
 if auth.uid() is null or coalesce(public.current_access_level(),0)<1 then raise exception 'Staff access is required to complete an inspection' using errcode='42501'; end if;
 select * into v_row from public.job_condition_reports where id=p_inspection_id for update;
 if not found then raise exception 'Inspection not found'; end if;
 if v_row.status='completed' or v_row.confirmed_at is not null then raise exception 'This inspection is already completed'; end if;
 if v_row.job_id is null then raise exception 'Link this inspection to a job card before completing it'; end if;
 if nullif(btrim(v_row.customer_name),'') is null or nullif(btrim(v_row.vehicle_registration),'') is null
 or nullif(btrim(v_row.checked_by),'') is null or v_row.fuel_level_in is null or v_row.fuel_level_in not in ('Empty','1/4','1/2','3/4','Full')
 or v_row.odometer_in is null or v_row.odometer_in<0 then
 raise exception 'Enter the customer, registration, inspector, fuel level and mileage before completing'; end if;
 if not exists(select 1 from public.repair_jobs j where j.id=v_row.job_id and j.customer_id=v_row.customer_id and j.vehicle_id=v_row.vehicle_id) then
 raise exception 'The linked job card must match this customer and vehicle'; end if;
 update public.job_condition_reports set status='completed',completed_by=auth.uid(),completed_at=v_done,
 confirmed_by=auth.uid(),confirmed_at=v_done,updated_at=v_done where id=p_inspection_id;
 insert into public.job_condition_report_audit(inspection_id,action,performed_by,performed_at)
 values(p_inspection_id,'completed',auth.uid(),v_done);
 return v_done;
end $$;

create or replace function public.reopen_vehicle_inspection(p_inspection_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_row public.job_condition_reports%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid()
 and coalesce(p.is_active,true) and lower(coalesce(p.role,'')) in ('super_admin','superadmin')) then
 raise exception 'Only an active super admin can reopen a completed inspection' using errcode='42501'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'Enter a reason for reopening this inspection'; end if;
 select * into v_row from public.job_condition_reports where id=p_inspection_id for update;
 if not found then raise exception 'Inspection not found'; end if;
 if v_row.status<>'completed' then raise exception 'Only completed inspections can be reopened'; end if;
 update public.job_condition_reports set status='draft',completed_by=null,completed_at=null,
 confirmed_by=null,confirmed_at=null,updated_at=now() where id=p_inspection_id;
 insert into public.job_condition_report_audit(inspection_id,action,reason,performed_by)
 values(p_inspection_id,'reopened',btrim(p_reason),auth.uid());
end $$;
grant execute on function public.complete_vehicle_inspection(uuid) to authenticated;
grant execute on function public.reopen_vehicle_inspection(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('vehicle-inspections','vehicle-inspections',false,12582912,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=12582912,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "Staff can view vehicle inspection photos" on storage.objects;
create policy "Staff can view vehicle inspection photos" on storage.objects for select to authenticated
using(bucket_id='vehicle-inspections' and coalesce(public.current_access_level(),0)>=1);
drop policy if exists "Staff can upload vehicle inspection photos" on storage.objects;
create policy "Staff can upload vehicle inspection photos" on storage.objects for insert to authenticated
with check(bucket_id='vehicle-inspections' and coalesce(public.current_access_level(),0)>=1);
drop policy if exists "Staff can update vehicle inspection photos" on storage.objects;
create policy "Staff can update vehicle inspection photos" on storage.objects for update to authenticated
using(bucket_id='vehicle-inspections' and coalesce(public.current_access_level(),0)>=1)
with check(bucket_id='vehicle-inspections' and coalesce(public.current_access_level(),0)>=1);
drop policy if exists "Staff can delete vehicle inspection photos" on storage.objects;
create policy "Staff can delete vehicle inspection photos" on storage.objects for delete to authenticated
using(bucket_id='vehicle-inspections' and coalesce(public.current_access_level(),0)>=1);