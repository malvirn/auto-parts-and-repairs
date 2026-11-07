begin;

create sequence if not exists public.job_condition_checklist_number_seq
  start with 1000 increment by 1;
revoke all on sequence public.job_condition_checklist_number_seq from public, anon;
grant usage, select on sequence public.job_condition_checklist_number_seq to authenticated;

create table if not exists public.job_condition_reports (
  id uuid primary key default gen_random_uuid(),
  checklist_number bigint not null default nextval('public.job_condition_checklist_number_seq'),
  job_id uuid references public.repair_jobs(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  customer_name text,
  vehicle_registration text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  checked_by text,
  fuel_level_in text,
  odometer_in bigint,
  report jsonb not null default '{"parts":{},"notes":""}'::jsonb
    check (
      jsonb_typeof(report) = 'object'
      and report ? 'parts'
      and jsonb_typeof(report -> 'parts') = 'object'
    ),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.job_condition_reports
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists checklist_number bigint,
  add column if not exists customer_id uuid,
  add column if not exists vehicle_id uuid,
  add column if not exists customer_name text,
  add column if not exists vehicle_registration text,
  add column if not exists vehicle_make text,
  add column if not exists vehicle_model text,
  add column if not exists vehicle_year integer,
  add column if not exists checked_by text,
  add column if not exists fuel_level_in text,
  add column if not exists odometer_in bigint;

do $$
declare
  job_id_type oid;
  job_id_attnum smallint;
  constraint_record record;
begin
  select attribute.atttypid, attribute.attnum
  into job_id_type, job_id_attnum
  from pg_attribute attribute
  where attribute.attrelid = 'public.job_condition_reports'::regclass
    and attribute.attname = 'job_id'
    and not attribute.attisdropped;

  for constraint_record in
    select constraint_name.conname, constraint_name.contype
    from pg_constraint constraint_name
    where constraint_name.conrelid = 'public.job_condition_reports'::regclass
      and (
        (constraint_name.contype = 'p' and job_id_attnum = any(constraint_name.conkey))
        or (
          job_id_type <> 'uuid'::regtype
          and constraint_name.contype = 'f'
          and job_id_attnum = any(constraint_name.conkey)
        )
      )
  loop
    execute format(
      'alter table public.job_condition_reports drop constraint %I',
      constraint_record.conname
    );
  end loop;

  if job_id_type <> 'uuid'::regtype then
    alter table public.job_condition_reports
      alter column job_id type uuid
      using case
        when btrim(job_id::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then btrim(job_id::text)::uuid
        else null
      end;
  end if;
end;
$$;

alter table public.job_condition_reports
  alter column job_id drop not null;

update public.job_condition_reports report
set id = coalesce(report.id, gen_random_uuid()),
    customer_id = coalesce(report.customer_id, job.customer_id),
    vehicle_id = coalesce(report.vehicle_id, job.vehicle_id),
    customer_name = coalesce(nullif(btrim(report.customer_name), ''), customer.full_name),
    vehicle_registration = coalesce(nullif(btrim(report.vehicle_registration), ''), vehicle.license_plate),
    vehicle_make = coalesce(report.vehicle_make, vehicle.make),
    vehicle_model = coalesce(report.vehicle_model, vehicle.model),
    vehicle_year = coalesce(report.vehicle_year, vehicle.year),
    fuel_level_in = coalesce(report.fuel_level_in, job.fuel_level_in),
    odometer_in = coalesce(report.odometer_in, job.odometer_in)
from public.repair_jobs job
left join public.customers customer on customer.id = job.customer_id
left join public.vehicles vehicle on vehicle.id = job.vehicle_id
where report.job_id = job.id;

update public.job_condition_reports report
set customer_name = coalesce(
      nullif(btrim(report.customer_name), ''),
      (select customer.full_name from public.customers customer where customer.id = report.customer_id)
    ),
    vehicle_registration = coalesce(
      nullif(btrim(report.vehicle_registration), ''),
      (select vehicle.license_plate from public.vehicles vehicle where vehicle.id = report.vehicle_id)
    ),
    vehicle_make = coalesce(
      report.vehicle_make,
      (select vehicle.make from public.vehicles vehicle where vehicle.id = report.vehicle_id)
    ),
    vehicle_model = coalesce(
      report.vehicle_model,
      (select vehicle.model from public.vehicles vehicle where vehicle.id = report.vehicle_id)
    ),
    vehicle_year = coalesce(
      report.vehicle_year,
      (select vehicle.year from public.vehicles vehicle where vehicle.id = report.vehicle_id)
    );

update public.job_condition_reports
set id = gen_random_uuid()
where id is null;

with missing_numbers as (
  select id,
         coalesce((select max(checklist_number) from public.job_condition_reports), 999)
           + row_number() over (order by updated_at nulls first, id) as checklist_number
  from public.job_condition_reports
  where checklist_number is null
)
update public.job_condition_reports report
set checklist_number = missing_numbers.checklist_number
from missing_numbers
where report.id = missing_numbers.id;

alter table public.job_condition_reports
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column checklist_number set default nextval('public.job_condition_checklist_number_seq'),
  alter column checklist_number set not null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

do $$
declare
  primary_key_name text;
begin
  select constraint_name.conname
  into primary_key_name
  from pg_constraint constraint_name
  where constraint_name.conrelid = 'public.job_condition_reports'::regclass
    and constraint_name.contype = 'p';
  if primary_key_name is not null then
    execute format('alter table public.job_condition_reports drop constraint %I', primary_key_name);
  end if;
  alter table public.job_condition_reports
    add constraint job_condition_reports_pkey primary key (id);
end;
$$;

create unique index if not exists job_condition_reports_checklist_number_key
  on public.job_condition_reports(checklist_number);

select setval(
  'public.job_condition_checklist_number_seq',
  greatest(coalesce((select max(checklist_number) from public.job_condition_reports), 999), 999),
  true
);

alter table public.repair_jobs
  add column if not exists checklist_number bigint;

update public.repair_jobs job
set checklist_number = report.checklist_number
from public.job_condition_reports report
where report.job_id = job.id
  and job.checklist_number is distinct from report.checklist_number;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_condition_reports_job_id_fkey') then
    alter table public.job_condition_reports
      add constraint job_condition_reports_job_id_fkey
      foreign key (job_id) references public.repair_jobs(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_condition_reports_customer_id_fkey') then
    alter table public.job_condition_reports
      add constraint job_condition_reports_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_condition_reports_vehicle_id_fkey') then
    alter table public.job_condition_reports
      add constraint job_condition_reports_vehicle_id_fkey
      foreign key (vehicle_id) references public.vehicles(id) on delete set null;
  end if;
end;
$$;

create unique index if not exists job_condition_reports_job_id_key
  on public.job_condition_reports(job_id) where job_id is not null;
create index if not exists job_condition_reports_customer_vehicle_idx
  on public.job_condition_reports(customer_id, vehicle_id, confirmed_at desc);

alter table public.job_condition_reports enable row level security;
revoke all on public.job_condition_reports from public, anon, authenticated;
grant select, insert, update, delete on public.job_condition_reports to authenticated;
revoke insert on public.job_condition_reports from authenticated;
grant insert (
  job_id,
  customer_id,
  vehicle_id,
  customer_name,
  vehicle_registration,
  checked_by,
  report,
  fuel_level_in,
  odometer_in,
  updated_at
) on public.job_condition_reports to authenticated;
revoke update on public.job_condition_reports from authenticated;
grant update (
  customer_name,
  vehicle_registration,
  checked_by,
  report,
  fuel_level_in,
  odometer_in,
  updated_at
) on public.job_condition_reports to authenticated;

drop policy if exists "Authenticated staff can read vehicle condition reports"
  on public.job_condition_reports;
create policy "Authenticated staff can read vehicle condition reports"
  on public.job_condition_reports for select
  to authenticated
  using (auth.uid() is not null and public.current_access_level() >= 1);

drop policy if exists "Authenticated staff can save vehicle condition reports"
  on public.job_condition_reports;
create policy "Authenticated staff can save vehicle condition reports"
  on public.job_condition_reports for insert
  to authenticated
  with check (
    auth.uid() is not null
    and public.current_access_level() >= 1
    and confirmed_at is null
  );

drop policy if exists "Authenticated staff can update vehicle condition reports"
  on public.job_condition_reports;
create policy "Authenticated staff can update vehicle condition reports"
  on public.job_condition_reports for update
  to authenticated
  using (
    auth.uid() is not null
    and public.current_access_level() >= 1
  )
  with check (
    auth.uid() is not null
    and public.current_access_level() >= 1
  );

drop policy if exists "Authenticated staff can delete vehicle condition reports"
  on public.job_condition_reports;
create policy "Authenticated staff can delete vehicle condition reports"
  on public.job_condition_reports for delete
  to authenticated
  using (auth.uid() is not null and coalesce(public.current_access_level(), 0) >= 1);

drop function if exists public.confirm_vehicle_condition_checklist(uuid);

create function public.confirm_vehicle_condition_checklist(p_checklist_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_confirmed_at timestamptz;
  v_customer_id uuid;
  v_vehicle_id uuid;
  v_job_id uuid;
  v_vehicle_customer_id uuid;
  v_vehicle_plate text;
  v_job_customer_id uuid;
  v_job_vehicle_id uuid;
  v_job_customer_name text;
  v_customer_name text;
  v_vehicle_registration text;
  v_checked_by text;
  v_fuel_level text;
  v_odometer bigint;
  v_checklist_number bigint;
  v_report jsonb;
  v_condition_parts text[] := array[
    'front-bumper', 'bonnet', 'roof', 'lf-wing', 'rf-wing',
    'lf-door', 'lr-door', 'rf-door', 'rr-door', 'boot', 'rear-bumper',
    'windscreen', 'rear-glass', 'l-headlight', 'r-headlight',
    'l-taillight', 'r-taillight', 'l-mirror', 'r-mirror',
    'wheel-lf', 'wheel-rf', 'wheel-lr', 'wheel-rr', 'seats', 'dashboard'
  ];
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'Staff access is required to confirm a vehicle checklist';
  end if;

  select customer_id, vehicle_id, job_id, customer_name, vehicle_registration, checked_by, fuel_level_in, odometer_in, checklist_number, report
  into v_customer_id, v_vehicle_id, v_job_id, v_customer_name, v_vehicle_registration, v_checked_by, v_fuel_level, v_odometer, v_checklist_number, v_report
  from public.job_condition_reports
  where id = p_checklist_id
  for update;
  if not found then
    raise exception 'Vehicle checklist not found';
  end if;
  if nullif(btrim(v_customer_name), '') is null
    or nullif(btrim(v_vehicle_registration), '') is null then
    raise exception 'Enter the customer name and vehicle registration before confirming the checklist';
  end if;
  if nullif(btrim(v_checked_by), '') is null then
    raise exception 'Enter the name of the person completing the checklist';
  end if;
  if v_fuel_level is null or v_fuel_level not in ('Empty', '1/4', '1/2', '3/4', 'Full') then
    raise exception 'Select a valid fuel level at drop-off';
  end if;
  if v_odometer is null or v_odometer < 0 then
    raise exception 'Enter a valid odometer reading at drop-off';
  end if;
  if exists (
    select 1
    from unnest(v_condition_parts) as condition_part(part_name)
    where jsonb_typeof(v_report -> 'parts' -> condition_part.part_name -> 'dmg') is distinct from 'array'
  ) then
    raise exception 'Choose a condition for every vehicle area before confirming the checklist';
  end if;
  if exists (
    select 1
    from unnest(v_condition_parts) as condition_part(part_name)
    where jsonb_array_length(v_report -> 'parts' -> condition_part.part_name -> 'dmg') > 1
  ) or exists (
    select 1
    from unnest(v_condition_parts) as condition_part(part_name)
    cross join lateral jsonb_array_elements_text(v_report -> 'parts' -> condition_part.part_name -> 'dmg') as damage(value)
    where damage.value not in ('Dent', 'Scratch', 'Crack', 'Broken', 'Missing')
  ) then
    raise exception 'Choose a valid condition for every vehicle area before confirming the checklist';
  end if;
  if v_job_id is not null then
    select job.customer_id, job.vehicle_id, customer.full_name, vehicle.customer_id, vehicle.license_plate
    into v_job_customer_id, v_job_vehicle_id, v_job_customer_name, v_vehicle_customer_id, v_vehicle_plate
    from public.repair_jobs job
    join public.customers customer on customer.id = job.customer_id
    join public.vehicles vehicle on vehicle.id = job.vehicle_id
    where job.id = v_job_id;
    if not found then
      raise exception 'The linked job card, customer, or vehicle could not be found';
    end if;
    if upper(btrim(v_job_customer_name)) <> upper(btrim(v_customer_name))
      or (v_customer_id is not null and v_customer_id is distinct from v_job_customer_id)
      or (v_vehicle_id is not null and v_vehicle_id is distinct from v_job_vehicle_id)
      or v_vehicle_customer_id is distinct from v_job_customer_id then
      raise exception 'The checklist customer and vehicle do not match its linked job card';
    end if;
    if exists (
      select 1 from public.vehicles vehicle
      where vehicle.id <> v_job_vehicle_id
        and upper(btrim(vehicle.license_plate)) = upper(btrim(v_vehicle_registration))
    ) then
      raise exception 'That registration is already assigned to another vehicle';
    end if;
    update public.vehicles
    set license_plate = upper(btrim(v_vehicle_registration))
    where id = v_job_vehicle_id;
    v_customer_id := v_job_customer_id;
    v_vehicle_id := v_job_vehicle_id;
  else
    if v_customer_id is not null and not exists (
      select 1 from public.customers
      where id = v_customer_id
        and upper(btrim(full_name)) = upper(btrim(v_customer_name))
    ) then
      raise exception 'The selected customer does not match the entered customer name';
    end if;
    if v_vehicle_id is not null then
      select customer_id, license_plate into v_vehicle_customer_id, v_vehicle_plate
      from public.vehicles where id = v_vehicle_id;
      if not found or v_vehicle_customer_id is distinct from v_customer_id then
        raise exception 'The selected vehicle does not belong to the selected customer';
      end if;
      if upper(btrim(v_vehicle_plate)) <> upper(btrim(v_vehicle_registration)) then
        raise exception 'The entered registration does not match the selected vehicle';
      end if;
    end if;
  end if;

  update public.job_condition_reports
  set customer_id = coalesce(customer_id, v_customer_id),
      vehicle_id = coalesce(vehicle_id, v_vehicle_id),
      vehicle_registration = upper(btrim(v_vehicle_registration)),
      confirmed_at = coalesce(confirmed_at, now()),
      confirmed_by = coalesce(confirmed_by, auth.uid()),
      updated_at = now()
  where id = p_checklist_id
  returning confirmed_at into v_confirmed_at;

  if v_job_id is not null then
    update public.repair_jobs
    set checklist_number = v_checklist_number,
        fuel_level_in = v_fuel_level,
        odometer_in = v_odometer
    where id = v_job_id;
  end if;

  return v_confirmed_at;
end;
$$;

create or replace function public.link_vehicle_condition_checklist(p_checklist_id uuid, p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_report public.job_condition_reports%rowtype;
  v_job public.repair_jobs%rowtype;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'Staff access is required to link a vehicle checklist';
  end if;
  select * into v_report
  from public.job_condition_reports
  where id = p_checklist_id
  for update;
  if not found then raise exception 'Vehicle checklist not found'; end if;
  select * into v_job
  from public.repair_jobs
  where id = p_job_id;
  if not found then raise exception 'Job card not found'; end if;
  if v_report.confirmed_at is null then raise exception 'Confirm the checklist before linking it'; end if;
  if not exists (
    select 1
    from public.customers customer
    join public.vehicles vehicle on vehicle.id = v_job.vehicle_id
    where customer.id = v_job.customer_id
      and upper(btrim(customer.full_name)) = upper(btrim(v_report.customer_name))
      and upper(btrim(vehicle.license_plate)) = upper(btrim(v_report.vehicle_registration))
      and (v_report.customer_id is null or v_report.customer_id = v_job.customer_id)
      and (v_report.vehicle_id is null or v_report.vehicle_id = v_job.vehicle_id)
  ) then
    raise exception 'The checklist customer and vehicle must match the job card';
  end if;
  if v_report.job_id is not null and v_report.job_id <> p_job_id then
    raise exception 'This checklist is already linked to another job card';
  end if;
  update public.job_condition_reports
  set job_id = p_job_id,
      customer_id = v_job.customer_id,
      vehicle_id = v_job.vehicle_id,
      updated_at = now()
  where id = p_checklist_id;
  update public.repair_jobs
  set checklist_number = v_report.checklist_number,
      fuel_level_in = v_report.fuel_level_in,
      odometer_in = v_report.odometer_in
  where id = p_job_id;
end;
$$;

update public.job_condition_reports report
set customer_id = job.customer_id,
    vehicle_id = job.vehicle_id
from public.repair_jobs job
where report.job_id = job.id
  and (report.customer_id is distinct from job.customer_id
    or report.vehicle_id is distinct from job.vehicle_id);

revoke all on function public.confirm_vehicle_condition_checklist(uuid) from public, anon, authenticated;
revoke all on function public.link_vehicle_condition_checklist(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_vehicle_condition_checklist(uuid) to authenticated;
grant execute on function public.link_vehicle_condition_checklist(uuid, uuid) to authenticated;

commit;
