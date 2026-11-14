-- Company customer contact fields and server-enforced job-card closing checks.
-- Apply to the Centric Auto Mobile Supabase project.

alter table public.customers
  add column if not exists supervisor_name text,
  add column if not exists company_email text,
  add column if not exists supervisor_personal_phone text,
  add column if not exists landline text;

alter table public.quotations
  add column if not exists walk_in_landline text;

alter table public.repair_jobs
  add column if not exists qc_signed_by text,
  add column if not exists qc_signed_at timestamptz,
  add column if not exists customer_signed_by text,
  add column if not exists customer_signed_at timestamptz;

create table if not exists public.repair_job_close_overrides (
  id uuid primary key default gen_random_uuid(),
  repair_job_id uuid not null references public.repair_jobs(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  actor_role text not null,
  reason text not null check (length(trim(reason)) >= 8),
  unmet_conditions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.repair_job_close_overrides enable row level security;
grant select, insert on public.repair_job_close_overrides to authenticated;
drop policy if exists "Admins can read job close overrides" on public.repair_job_close_overrides;
create policy "Admins can read job close overrides"
  on public.repair_job_close_overrides for select to authenticated
  using (public.is_admin());
drop policy if exists "Admins can write job close overrides" on public.repair_job_close_overrides;
create policy "Admins can write job close overrides"
  on public.repair_job_close_overrides for insert to authenticated
  with check (public.is_admin() and actor_id = (select auth.uid()));

create or replace function public.get_repair_job_close_readiness(
  p_job_id uuid,
  p_work_complete boolean default false,
  p_qc_signed_by text default null,
  p_customer_signed_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  j public.repair_jobs%rowtype;
  v_work boolean;
  v_checklist boolean;
  v_parts boolean;
  v_no_pending boolean;
  v_invoice_paid boolean;
  v_qc boolean;
  v_customer boolean;
  v_checks jsonb;
begin
  select * into j from public.repair_jobs where id = p_job_id;
  if not found then raise exception 'Job card not found'; end if;
  v_work := coalesce(p_work_complete, false)
    and nullif(trim(coalesce(j.work_done,'')), '') is not null
    and nullif(trim(coalesce(j.work_missing,'')), '') is null;
  v_checklist := exists (
    select 1 from public.job_condition_reports c
    where c.job_id = p_job_id and c.voided_at is null
      and (c.confirmed_at is not null or (c.status = 'completed' and c.completed_at is not null))
  );
  v_parts := not exists (
    select 1 from public.job_parts jp
    left join public.job_part_purchase_requests r on r.job_part_id = jp.id
    where jp.job_id = p_job_id
      and (jp.awaiting_accounting_price or jp.price_at_time is null or jp.price_at_time <= 0
        or (jp.part_id is null and (r.id is null or r.status <> 'received' or r.released_at is null)))
  );
  v_no_pending := not exists (
    select 1 from public.job_part_purchase_requests r
    join public.job_parts jp on jp.id = r.job_part_id
    where jp.job_id = p_job_id and r.status in ('requested','awaiting_accounting')
  );
  v_invoice_paid := exists (select 1 from public.invoices i where i.repair_job_id = p_job_id)
    and (
      coalesce((select sum(rp.amount) from public.repair_job_payments rp
        where rp.repair_job_id = p_job_id and rp.voided_at is null),0)
      + greatest(0, coalesce((select sum(ip.amount) from public.invoice_payments ip
        join public.invoices i on i.id=ip.invoice_id
        where i.repair_job_id=p_job_id and ip.voided_at is null),0)
        - coalesce((select sum(oc.amount) from public.customer_overpayment_credits oc
          join public.invoice_payments ip on ip.id=oc.invoice_payment_id
          join public.invoices i on i.id=ip.invoice_id
          where i.repair_job_id=p_job_id and ip.voided_at is null),0))
      + coalesce((select sum(cm.amount) from public.customer_credit_movements cm
        where cm.target_type='repair_job' and cm.target_id=p_job_id
          and cm.movement_type='application' and cm.reversed_at is null),0)
      + coalesce((select sum(cm.amount) from public.customer_credit_movements cm
        join public.invoices i on i.id=cm.target_id
        where i.repair_job_id=p_job_id and cm.target_type='invoice'
          and cm.movement_type='application' and cm.reversed_at is null),0)
      + coalesce((select sum(l.applied_amount) from public.customer_overpayment_credit_job_links l
        where l.repair_job_id=p_job_id and l.applied_amount>0),0)
    ) >= coalesce(j.total_cost, (select sum(i.total) from public.invoices i where i.repair_job_id=p_job_id),0);
  v_qc := nullif(trim(coalesce(p_qc_signed_by,'')), '') is not null
    or (j.qc_signed_at is not null and nullif(trim(coalesce(j.qc_signed_by,'')), '') is not null);
  v_customer := nullif(trim(coalesce(p_customer_signed_by,'')), '') is not null
    or (j.customer_signed_at is not null and nullif(trim(coalesce(j.customer_signed_by,'')), '') is not null);
  v_checks := jsonb_build_array(
    jsonb_build_object('key','work_complete','label','All work/tasks completed and no outstanding work remains','ok',v_work),
    jsonb_build_object('key','checklist','label','Vehicle checklist completed and confirmed','ok',v_checklist),
    jsonb_build_object('key','parts_issued','label','All parts priced, funded and issued/received','ok',v_parts),
    jsonb_build_object('key','no_pending_parts','label','No pending or unapproved parts requests','ok',v_no_pending),
    jsonb_build_object('key','invoice_paid','label','Invoice generated and fully paid, or approved customer credit applied','ok',v_invoice_paid),
    jsonb_build_object('key','qc_signoff','label','Final inspection / QC signed off','ok',v_qc),
    jsonb_build_object('key','customer_signoff','label','Customer sign-off recorded','ok',v_customer)
  );
  return jsonb_build_object('can_close',v_work and v_checklist and v_parts and v_no_pending and v_invoice_paid and v_qc and v_customer,'checks',v_checks);
end;
$$;

create or replace function public.close_repair_job_with_checks(
  p_job_id uuid,
  p_tested_by text,
  p_next_service_mileage integer,
  p_work_complete boolean,
  p_customer_signed_by text,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  j public.repair_jobs%rowtype;
  readiness jsonb;
  actor_role text;
  reason text := nullif(trim(coalesce(p_override_reason,'')), '');
  now_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Sign in before closing a job card'; end if;
  select * into j from public.repair_jobs where id=p_job_id for update;
  if not found then raise exception 'Job card not found'; end if;
  if j.closed_at is not null then return jsonb_build_object('closed',true,'already_closed',true); end if;
  if nullif(trim(coalesce(p_tested_by,'')), '') is null then raise exception 'Enter the QC / final inspector name'; end if;
  if p_next_service_mileage is null or p_next_service_mileage < 0 then raise exception 'Enter a valid next service mileage'; end if;
  if p_work_complete is distinct from true and reason is null then raise exception 'Confirm that all work tasks are complete'; end if;
  if nullif(trim(coalesce(p_customer_signed_by,'')), '') is null and reason is null then raise exception 'Record the customer sign-off name'; end if;
  readiness := public.get_repair_job_close_readiness(p_job_id,p_work_complete,p_tested_by,p_customer_signed_by);
  if coalesce((readiness->>'can_close')::boolean,false) is false then
    if reason is null then raise exception 'Job card cannot close. Unmet conditions: %',readiness->'checks'; end if;
    select role into actor_role from public.profiles
      where id=(select auth.uid()) and coalesce(is_active,true);
    if not public.is_admin() and lower(coalesce(actor_role,'')) not in ('admin','supervisor','super_admin') then
      raise exception 'Only an authorised supervisor or administrator can override job-card closing';
    end if;
    insert into public.repair_job_close_overrides(repair_job_id,actor_id,actor_role,reason,unmet_conditions)
    values(p_job_id,(select auth.uid()),coalesce(actor_role,'unknown'),reason,readiness->'checks');
  end if;
  perform set_config('app.repair_job_close','authorised',true);
  update public.repair_jobs set
    status='Ready for Pickup',work_ready=coalesce(p_work_complete,false),
    tested_by=trim(p_tested_by),qc_signed_by=trim(p_tested_by),qc_signed_at=now_at,
    customer_signed_by=nullif(trim(coalesce(p_customer_signed_by,'')), ''),
    customer_signed_at=case when nullif(trim(coalesce(p_customer_signed_by,'')), '') is not null then now_at else null end,
    next_service_mileage=p_next_service_mileage,closed_at=now_at,ready_at=now_at
  where id=p_job_id;
  return jsonb_build_object('closed',true,'overridden',reason is not null,'readiness',readiness);
end;
$$;

create or replace function public.guard_repair_job_close()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status::text='Ready for Pickup' and coalesce(old.status::text,'') <> 'Ready for Pickup'
    and current_setting('app.repair_job_close',true) is distinct from 'authorised' then
    raise exception 'Use the verified Close Job Card action. Direct status changes cannot close a job card.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_repair_job_close on public.repair_jobs;
create trigger guard_repair_job_close before update of status,closed_at on public.repair_jobs
for each row execute function public.guard_repair_job_close();

revoke execute on function public.get_repair_job_close_readiness(uuid,boolean,text,text) from public,anon;
revoke execute on function public.close_repair_job_with_checks(uuid,text,integer,boolean,text,text) from public,anon;
grant execute on function public.get_repair_job_close_readiness(uuid,boolean,text,text) to authenticated;
grant execute on function public.close_repair_job_with_checks(uuid,text,integer,boolean,text,text) to authenticated;
