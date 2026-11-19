-- Customer ID / company / credit-confirmation QA
-- Run only after customer_id_company_credit_security.sql has been applied.
-- All data changes are rolled back at the end. Journal and audit rows created
-- by the different-vehicle test are also rolled back.

begin;

do $qa$
declare
  actor_id uuid;
  registry_owner uuid;
  individual_id uuid;
  company_id uuid;
  collision_customer_id uuid;
  next_range_customer_id uuid;
  free_number integer;
  generated_code text;
  result jsonb;
  i integer;
  scenario record;
  amount_to_apply numeric(12,2);
begin
  select id into actor_id
  from public.profiles
  where lower(coalesce(role,'')) in ('super_admin','superadmin')
  order by id
  limit 1;

  if actor_id is null then
    raise exception 'QA needs an existing super_admin profile so the confirmation RPC can be tested';
  end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select id into registry_owner from public.customers order by created_at limit 1;
  if registry_owner is null then
    raise exception 'Create at least one customer before running the QA script';
  end if;

  -- Backfill and existing uniqueness checks.
  if exists (select 1 from public.customers where nullif(btrim(customer_code),'') is null) then
    raise exception 'Backfill check failed: a customer has no Customer ID';
  end if;
  if exists (select 1 from public.customers group by customer_code having count(*)>1) then
    raise exception 'Uniqueness check failed: duplicate Customer IDs exist';
  end if;

  -- Individual identity flow: phone last four digits and full name are both valid.
  insert into public.customers(full_name,phone,is_company)
  values('CID QA Individual','+263779991234',false)
  returning id into individual_id;

  result := public.verify_customer_credit_confirmation(individual_id,'1234',null);
  if coalesce((result->>'allowed')::boolean,false) is not true then
    raise exception 'Individual phone-last-four confirmation failed: %',result;
  end if;
  result := public.verify_customer_credit_confirmation(individual_id,'CID QA Individual',null);
  if coalesce((result->>'allowed')::boolean,false) is not true then
    raise exception 'Individual full-name confirmation failed: %',result;
  end if;

  -- Company flow: wrong name fails; exact name succeeds, with an authoriser.
  insert into public.customers(full_name,phone,is_company,company_name)
  values('CID QA Accounts Contact','+263779991235',true,'CID QA Transport (Pvt) Ltd')
  returning id into company_id;

  result := public.verify_customer_credit_confirmation(company_id,'Wrong Company','Driver One');
  if coalesce((result->>'allowed')::boolean,false) is true then
    raise exception 'Company confirmation incorrectly accepted a wrong company name';
  end if;
  result := public.verify_customer_credit_confirmation(company_id,'CID QA Transport (PVT) LTD','Driver One');
  if coalesce((result->>'allowed')::boolean,false) is not true then
    raise exception 'Company confirmation did not accept a case-insensitive exact name: %',result;
  end if;

  -- Five failures in one 10-minute window must lock this customer's credit use.
  for i in 1..5 loop
    result := public.verify_customer_credit_confirmation(individual_id,'wrong-value',null);
  end loop;
  if coalesce((result->>'allowed')::boolean,true) is true
     or not exists (
       select 1 from public.customer_credit_confirmation_attempts
       where customer_id=individual_id and failed_count>=5 and blocked_until>now()
     ) then
    raise exception 'Five-failure lockout test failed: %',result;
  end if;

  -- Collision fallback: reserve every 3-digit CID except one. The generator
  -- must find the remaining value even if its first 50 random picks collide.
  select g into free_number
  from generate_series(100,999) g
  where not exists(select 1 from public.customer_code_registry r where r.customer_code='CID-'||g::text)
    and not exists(select 1 from public.customers c where c.customer_code='CID-'||g::text)
  order by random()
  limit 1;

  if free_number is not null then
    insert into public.customer_code_registry(customer_code,customer_id,assigned_by)
    select 'CID-'||g::text,registry_owner,actor_id
    from generate_series(100,999) g
    where g<>free_number
    on conflict(customer_code) do nothing;

    insert into public.customers(full_name,phone)
    values('CID QA Collision Retry','+26377'||substr(replace(gen_random_uuid()::text,'-',''),1,7))
    returning id,customer_code into collision_customer_id,generated_code;

    if generated_code <> 'CID-'||free_number::text then
      raise exception 'Collision retry expected CID-% but generated %',free_number,generated_code;
    end if;

    -- The 3-digit range is now full, so the next generated code must be 4+ digits.
    insert into public.customers(full_name,phone)
    values('CID QA Range Expansion','+26377'||substr(replace(gen_random_uuid()::text,'-',''),1,7))
    returning id,customer_code into next_range_customer_id,generated_code;

    if generated_code !~ '^CID-[0-9]{4,}$' then
      raise exception 'Full 3-digit range did not advance to a longer CID: %',generated_code;
    end if;
  else
    raise notice 'All 3-digit CIDs were already allocated; range-expansion test skipped.';
  end if;

  -- Many inserts: every generated code must be present and unique.
  insert into public.customers(full_name,phone)
  select 'CID QA Bulk '||g::text,
         '+26377'||substr(replace(gen_random_uuid()::text,'-',''),1,7)
  from generate_series(1,1000) g;

  if exists (
    select 1 from public.customers
    where full_name like 'CID QA Bulk %' and nullif(btrim(customer_code),'') is null
  ) then
    raise exception 'Bulk insert left a customer without a CID';
  end if;
  if exists (
    select customer_code from public.customers
    where full_name like 'CID QA Bulk %'
    group by customer_code having count(*)>1
  ) then
    raise exception 'Bulk insert generated duplicate CIDs';
  end if;

  -- Different-vehicle credit test. If the live data contains an available
  -- deposit and another outstanding job for the same customer but a different
  -- vehicle, apply it inside this transaction and roll it back at the end.
  select b.deposit_receipt_id,b.customer_id,b.available_amount,
         target.source_id as target_job_id,target.balance_due,
         c.is_company,c.company_name,c.full_name,c.phone
  into scenario
  from public.customer_credit_balances b
  join public.quotations q on q.id=b.quotation_id
  join public.repair_jobs original_job on original_job.id=q.repair_job_id
  join public.customer_account_statement target
    on target.customer_id=b.customer_id and target.source_type='Repair job' and target.balance_due>0.005
  join public.repair_jobs target_job on target_job.id=target.source_id
  join public.customers c on c.id=b.customer_id
  where b.available_amount>0.005
    and target_job.vehicle_id is not null
    and original_job.vehicle_id is not null
    and target_job.vehicle_id is distinct from original_job.vehicle_id
  order by b.created_at
  limit 1;

  if found then
    amount_to_apply := least(scenario.available_amount,scenario.balance_due);
    result := public.apply_customer_credit_verified(
      scenario.deposit_receipt_id,amount_to_apply,'repair_job',scenario.target_job_id,
      'CID QA different-vehicle customer ownership test',gen_random_uuid(),
      case when scenario.is_company then scenario.company_name
           else scenario.full_name end,
      case when scenario.is_company then 'CID QA Accounts Authoriser' else null end
    );
    if result ? 'error' then
      raise exception 'Different-vehicle credit application failed: %',result->>'error';
    end if;
    raise notice 'Different-vehicle credit application passed for the same customer ID.';
  else
    raise notice 'Different-vehicle redemption test skipped: no live customer has both an available deposit and a due job on another vehicle.';
  end if;
end;
$qa$;

rollback;
