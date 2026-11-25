begin;

-- Workshop can see only confirmed, unlinked checklists that are eligible
-- for job-card creation. Draft and voided checklists remain staff-only.
drop policy if exists job_condition_reports_workshop_ready_select
  on public.job_condition_reports;
create policy job_condition_reports_workshop_ready_select
on public.job_condition_reports
for select
to authenticated
using (
  public.is_workshop()
  and confirmed_at is not null
  and status = 'completed'
  and voided_at is null
  and job_id is null
);

-- Private idempotency ledger. The browser cannot read or write this table.
create table if not exists public.workshop_job_creation_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  checklist_id uuid not null references public.job_condition_reports(id) on delete cascade,
  request_payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

alter table public.workshop_job_creation_requests enable row level security;
revoke all on public.workshop_job_creation_requests from public, anon, authenticated;

-- Create a job only from a completed, unlinked checklist whose registered
-- customer and vehicle identities match. Labour and parts remain unpriced;
-- workshop adds catalogue parts through append_workshop_job_parts and staff
-- can set labour pricing through the existing controlled workflow.
create or replace function public.create_workshop_job_from_checklist(
  p_request_id uuid,
  p_checklist_id uuid,
  p_fault_reported text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_checklist public.job_condition_reports%rowtype;
  v_customer public.customers%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_job public.repair_jobs%rowtype;
  v_payload jsonb;
  v_existing_payload jsonb;
  v_existing_result jsonb;
  v_result jsonb;
  v_customer_name text;
begin
  if v_user_id is null or not public.is_workshop() then
    raise exception 'Active workshop access is required to create this job card'
      using errcode = '42501';
  end if;

  if p_request_id is null or p_checklist_id is null
     or nullif(btrim(p_fault_reported), '') is null
     or length(btrim(p_fault_reported)) > 2000 then
    raise exception 'Choose a checklist and enter the reported fault (maximum 2,000 characters)';
  end if;

  v_payload := jsonb_build_object(
    'checklist_id', p_checklist_id,
    'fault_reported', btrim(p_fault_reported)
  );

  -- Repeated requests with the same key return the original job card.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_request_id::text, 0)
  );

  select request_payload, result
    into v_existing_payload, v_existing_result
  from public.workshop_job_creation_requests
  where user_id = v_user_id and request_id = p_request_id;

  if found then
    if v_existing_payload is distinct from v_payload then
      raise exception 'This request key was already used for a different job-card request';
    end if;
    return v_existing_result;
  end if;

  select * into v_checklist
  from public.job_condition_reports
  where id = p_checklist_id
  for update;

  if not found then
    raise exception 'Confirmed checklist not found or you do not have access to it';
  end if;

  if v_checklist.status <> 'completed'
     or v_checklist.confirmed_at is null
     or v_checklist.voided_at is not null
     or v_checklist.job_id is not null then
    raise exception 'Only a completed, active checklist that is not already linked can create a job card';
  end if;

  if v_checklist.customer_id is null or v_checklist.vehicle_id is null then
    raise exception 'This checklist is not linked to a registered customer and vehicle. Ask staff to link those records first';
  end if;

  select * into v_customer
  from public.customers
  where id = v_checklist.customer_id;

  if not found or v_customer.deleted_at is not null then
    raise exception 'The checklist customer is unavailable or deleted';
  end if;

  select * into v_vehicle
  from public.vehicles
  where id = v_checklist.vehicle_id
  for update;

  if not found or v_vehicle.customer_id is distinct from v_customer.id then
    raise exception 'The selected vehicle does not belong to the checklist customer';
  end if;

  v_customer_name := case
    when v_customer.is_company then coalesce(nullif(btrim(v_customer.company_name), ''), v_customer.full_name)
    else v_customer.full_name
  end;

  if upper(btrim(coalesce(v_checklist.customer_name, ''))) <> upper(btrim(coalesce(v_customer_name, '')))
     or upper(btrim(coalesce(v_checklist.vehicle_registration, ''))) <>
        upper(btrim(coalesce(v_vehicle.license_plate, ''))) then
    raise exception 'The checklist customer and registration do not match the registered customer and vehicle';
  end if;

  if exists (
    select 1
    from public.repair_jobs
    where checklist_number = v_checklist.checklist_number
  ) then
    raise exception 'A job card is already linked to this checklist';
  end if;

  insert into public.repair_jobs (
    status,
    customer_id,
    vehicle_id,
    fault_reported,
    fuel_level_in,
    odometer_in,
    checklist_number,
    labour_cost,
    parts_cost,
    incidentals_cost
  ) values (
    'Draft',
    v_customer.id,
    v_vehicle.id,
    btrim(p_fault_reported),
    v_checklist.fuel_level_in,
    v_checklist.odometer_in,
    v_checklist.checklist_number,
    0,
    0,
    0
  )
  returning * into v_job;

  -- Link the checklist before moving the job to Received. The existing
  -- completed-inspection trigger verifies this relationship on the status change.
  update public.job_condition_reports
  set job_id = v_job.id,
      customer_id = v_customer.id,
      vehicle_id = v_vehicle.id,
      updated_at = now()
  where id = v_checklist.id;

  update public.repair_jobs
  set status = 'Received'
  where id = v_job.id
  returning * into v_job;

  -- Keep the established invoice calculation as the single source of truth.
  -- This creates the same zero-value/unpriced invoice as the normal checklist flow.
  perform public.sync_repair_job_invoice(v_job.id);

  v_result := jsonb_build_object(
    'success', true,
    'job_id', v_job.id,
    'job_number', v_job.job_number,
    'cro_number', v_job.cro_number,
    'checklist_number', v_checklist.checklist_number,
    'status', v_job.status
  );

  insert into public.workshop_job_creation_requests (
    user_id, request_id, checklist_id, request_payload, result
  ) values (
    v_user_id, p_request_id, v_checklist.id, v_payload, v_result
  );

  return v_result;
end;
$function$;

revoke all on function public.create_workshop_job_from_checklist(uuid, uuid, text)
  from public, anon;
grant execute on function public.create_workshop_job_from_checklist(uuid, uuid, text)
  to authenticated;

comment on function public.create_workshop_job_from_checklist(uuid, uuid, text) is
  'Creates a Received repair job from a completed, unlinked checklist for an active workshop user. Customer, vehicle, checklist and invoice are validated and linked in one transaction.';

commit;
