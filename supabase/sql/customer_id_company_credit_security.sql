-- Centric Auto Mobile: Customer IDs, company customers and verified credit use
-- Paste this entire script into Supabase SQL Editor and run once.
-- Existing non-empty customer_code values are preserved. Existing accounting tables
-- and journal posting functions are retained; verified wrappers call the existing RPCs.

begin;

alter table public.customers
  add column if not exists is_company boolean not null default false,
  add column if not exists company_name text;

create table if not exists public.customer_code_registry (
  customer_code text primary key,
  customer_id uuid not null references public.customers(id),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id)
);
create unique index if not exists customer_code_registry_customer_uidx
  on public.customer_code_registry(customer_id, customer_code);
alter table public.customer_code_registry enable row level security;
revoke all on public.customer_code_registry from public, anon, authenticated;
revoke all on function public.generate_customer_code() from public, anon, authenticated;
revoke all on function public.enforce_customer_identity_fields() from public, anon, authenticated;

create or replace function public.generate_customer_code()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  digits integer := 3;
  lower_bound bigint;
  upper_bound bigint;
  range_size bigint;
  candidate bigint;
  code_value text;
  attempt integer;
  offset_value bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('centric-customer-cid-generator', 0));

  loop
    lower_bound := power(10::numeric, digits - 1)::bigint;
    upper_bound := power(10::numeric, digits)::bigint - 1;
    range_size := upper_bound - lower_bound + 1;

    for attempt in 1..50 loop
      candidate := lower_bound + floor(random() * range_size)::bigint;
      code_value := 'CID-' || candidate::text;
      if not exists (select 1 from public.customer_code_registry r where r.customer_code = code_value)
         and not exists (select 1 from public.customers c where c.customer_code = code_value) then
        return code_value;
      end if;
    end loop;

    -- A collision streak is not proof that a range is full. Scan it before
    -- advancing to the next number of digits.
    if (select count(*) from public.customer_code_registry r
        where r.customer_code ~ ('^CID-[0-9]{' || digits || '}$')) < range_size then
      for offset_value in 0..range_size - 1 loop
        candidate := lower_bound + offset_value;
        code_value := 'CID-' || candidate::text;
        if not exists (select 1 from public.customer_code_registry r where r.customer_code = code_value)
           and not exists (select 1 from public.customers c where c.customer_code = code_value) then
          return code_value;
        end if;
      end loop;
    end if;

    digits := digits + 1;
    if digits > 15 then
      raise exception 'No customer ID range remains available';
    end if;
  end loop;
end;
$$;

create or replace function public.enforce_customer_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_override boolean := coalesce(auth.uid() is not null and public.current_access_level() >= 2, false);
begin
  if new.is_company and nullif(btrim(new.company_name), '') is null then
    raise exception 'Company name is required for company customers';
  end if;
  if not new.is_company then
    new.company_name := null;
  end if;

  if tg_op = 'INSERT' then
    if nullif(btrim(new.customer_code), '') is null then
      new.customer_code := public.generate_customer_code();
    elsif not manager_override then
      raise exception 'Customer IDs are generated automatically';
    end if;
  else
    if nullif(btrim(new.customer_code), '') is null then
      if old.customer_code is not null and btrim(old.customer_code) <> '' then
        raise exception 'Customer ID cannot be cleared';
      end if;
      new.customer_code := public.generate_customer_code();
    elsif new.customer_code is distinct from old.customer_code then
      if not manager_override then
        raise exception 'Only a manager can change a Customer ID';
      end if;
    end if;
  end if;

  new.customer_code := btrim(new.customer_code);
  if new.customer_code is null or btrim(new.customer_code) = '' then
    raise exception 'Customer ID could not be generated';
  end if;

  if tg_op = 'INSERT' or new.customer_code is distinct from old.customer_code then
    insert into public.customer_code_registry(customer_code, customer_id, assigned_by)
    values(new.customer_code, new.id, auth.uid());
  end if;
  return new;
end;
$$;

-- Refuse to proceed if legacy non-empty values are duplicated.
do $$
begin
  if exists (
    select 1 from public.customers
    where nullif(btrim(customer_code), '') is not null
    group by customer_code having count(*) > 1
  ) then
    raise exception 'Duplicate existing customer_code values must be resolved before applying this script';
  end if;
end;
$$;

-- Preserve every existing code in the permanent registry.
insert into public.customer_code_registry(customer_code, customer_id, assigned_by)
select customer_code, id, null
from public.customers
where nullif(btrim(customer_code), '') is not null
on conflict (customer_code) do nothing;

drop trigger if exists customers_identity_fields on public.customers;
create trigger customers_identity_fields
before insert or update of customer_code, is_company, company_name
on public.customers
for each row execute function public.enforce_customer_identity_fields();

-- Trigger generates IDs for all existing rows still missing a code.
update public.customers
set customer_code = null
where nullif(btrim(customer_code), '') is null;

do $company_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.customers'::regclass
      and conname='customers_company_name_required'
  ) then
    alter table public.customers
      add constraint customers_company_name_required
      check (not is_company or nullif(btrim(company_name),'') is not null) not valid;
  end if;
end;
$company_check$;
alter table public.customers validate constraint customers_company_name_required;

alter table public.customers alter column customer_code set not null;
do $block$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'public.customers'::regclass
      and i.indisunique
      and i.indnatts = 1
      and a.attname = 'customer_code'
  ) then
    create unique index customers_customer_code_uidx on public.customers(customer_code);
  end if;
end;
$block$;

-- Keep the existing RLS policies and add a manager-only UPDATE path for accounting
-- managers who are not included in the operational staff policy.
drop policy if exists customers_manager_update on public.customers;
create policy customers_manager_update on public.customers
  for update to authenticated
  using (public.current_access_level() >= 2)
  with check (public.current_access_level() >= 2);
-- The trigger enforces manager-only CID changes even for operational staff.

create table if not exists public.customer_credit_confirmation_attempts (
  customer_id uuid primary key references public.customers(id),
  window_started_at timestamptz not null default now(),
  failed_count integer not null default 0,
  blocked_until timestamptz,
  last_failed_at timestamptz
);
alter table public.customer_credit_confirmation_attempts enable row level security;
revoke all on public.customer_credit_confirmation_attempts from public, anon, authenticated;

create table if not exists public.customer_credit_redemption_audit (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers(id),
  customer_code text not null,
  credit_reference text not null,
  target_type text not null,
  target_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  confirmed_as text not null,
  authorised_by text,
  performed_by uuid references auth.users(id),
  source_redemption_id uuid not null unique,
  performed_at timestamptz not null default now()
);
create index if not exists customer_credit_redemption_audit_customer_idx
  on public.customer_credit_redemption_audit(customer_id, performed_at desc);
alter table public.customer_credit_redemption_audit enable row level security;
drop policy if exists customer_credit_redemption_audit_staff_read on public.customer_credit_redemption_audit;
create policy customer_credit_redemption_audit_staff_read
  on public.customer_credit_redemption_audit for select to authenticated
  using (public.current_access_level() >= 1);
revoke insert, update, delete on public.customer_credit_redemption_audit from public, anon, authenticated;
grant select on public.customer_credit_redemption_audit to authenticated;

create or replace function public.verify_customer_credit_confirmation(
  p_customer_id uuid,
  p_confirmation_value text,
  p_authorised_by text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  customer_row public.customers%rowtype;
  attempt_row public.customer_credit_confirmation_attempts%rowtype;
  clean_confirmation text := btrim(coalesce(p_confirmation_value, ''));
  valid_confirmation boolean := false;
  next_failures integer;
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    return jsonb_build_object('allowed', false, 'error', 'Authorised staff access is required');
  end if;

  select * into customer_row from public.customers where id = p_customer_id;
  if not found then
    return jsonb_build_object('allowed', false, 'error', 'Customer record could not be found');
  end if;

  insert into public.customer_credit_confirmation_attempts(customer_id)
  values(p_customer_id) on conflict(customer_id) do nothing;
  select * into attempt_row
  from public.customer_credit_confirmation_attempts
  where customer_id = p_customer_id
  for update;

  if attempt_row.blocked_until is not null and attempt_row.blocked_until > now() then
    return jsonb_build_object('allowed', false,
      'error', 'Credit use for this customer is temporarily locked. Ask a manager for assistance.',
      'blocked_until', attempt_row.blocked_until);
  end if;

  if customer_row.is_company then
    valid_confirmation :=
      nullif(btrim(customer_row.company_name), '') is not null
      and lower(clean_confirmation) = lower(btrim(customer_row.company_name))
      and nullif(btrim(coalesce(p_authorised_by, '')), '') is not null;
  else
    valid_confirmation :=
      (length(regexp_replace(coalesce(customer_row.phone, ''), '[^0-9]', '', 'g')) >= 4
       and clean_confirmation = right(regexp_replace(coalesce(customer_row.phone, ''), '[^0-9]', '', 'g'), 4))
      or lower(clean_confirmation) = lower(btrim(customer_row.full_name));
  end if;

  if not valid_confirmation then
    if attempt_row.window_started_at < now() - interval '10 minutes' then
      next_failures := 1;
      update public.customer_credit_confirmation_attempts
      set window_started_at = now(), failed_count = 1, last_failed_at = now(),
          blocked_until = null
      where customer_id = p_customer_id;
    else
      next_failures := attempt_row.failed_count + 1;
      update public.customer_credit_confirmation_attempts
      set failed_count = next_failures, last_failed_at = now(),
          blocked_until = case when next_failures >= 5 then now() + interval '15 minutes' else blocked_until end
      where customer_id = p_customer_id;
    end if;

    if next_failures >= 5 then
      insert into public.notifications(message, type, link)
      values(
        'Credit use locked for ' || coalesce(customer_row.company_name, customer_row.full_name)
          || ' (' || customer_row.customer_code || ') after five failed identity confirmations. Manager review required.',
        'warning',
        'pages/receipts.html'
      );
      return jsonb_build_object('allowed', false,
        'error', 'Five incorrect confirmations. Credit use is locked for 15 minutes and a manager has been notified.');
    end if;

    return jsonb_build_object('allowed', false,
      'error', 'Customer confirmation did not match. Try the phone last four digits or full name.');
  end if;

  update public.customer_credit_confirmation_attempts
  set failed_count = 0, window_started_at = now(), blocked_until = null, last_failed_at = null
  where customer_id = p_customer_id;

  return jsonb_build_object('allowed', true, 'customer_id', customer_row.id,
    'customer_code', customer_row.customer_code, 'confirmed_as', clean_confirmation);
end;
$$;
revoke all on function public.verify_customer_credit_confirmation(uuid,text,text) from public, anon, authenticated;

-- Verified wrapper for quotation-deposit credit. Existing accounting RPC remains
-- the only function that posts the debit/credit journal lines.
create or replace function public.apply_customer_credit_verified(
  p_deposit_receipt_id uuid,
  p_amount numeric,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_confirmation_value text,
  p_authorised_by text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  note_row public.quotation_deposit_receipts%rowtype;
  customer_row public.customers%rowtype;
  resolved_customer_id uuid;
  match_count integer;
  verified jsonb;
  result jsonb;
  credit_ref text;
begin
  select * into note_row from public.quotation_deposit_receipts where id = p_deposit_receipt_id;
  if not found then
    return jsonb_build_object('error', 'Customer credit note not found');
  end if;
  resolved_customer_id := note_row.customer_id;
  if resolved_customer_id is null then
    select count(*), (array_agg(id))[1] into match_count, resolved_customer_id
    from public.customers
    where lower(btrim(full_name)) = lower(btrim(note_row.customer_name))
      and (nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'') is null
        or regexp_replace(phone,'[^0-9]','','g') = regexp_replace(coalesce(note_row.customer_phone,''),'[^0-9]','','g'));
    if match_count <> 1 then
      return jsonb_build_object('error', 'This credit note cannot be matched to one registered customer. Link the customer before applying credit.');
    end if;
  end if;
  select * into customer_row from public.customers where id = resolved_customer_id;
  verified := public.verify_customer_credit_confirmation(customer_row.id, p_confirmation_value, p_authorised_by);
  if coalesce((verified->>'allowed')::boolean, false) is not true then
    return verified;
  end if;

  result := public.apply_customer_credit(
    p_deposit_receipt_id, p_amount, p_target_type, p_target_id, p_reason, p_idempotency_key
  );
  credit_ref := 'QCN-' || lpad(note_row.credit_note_number::text, 6, '0');

  insert into public.customer_credit_redemption_audit(
    customer_id, customer_code, credit_reference, target_type, target_id,
    amount, confirmed_as, authorised_by, performed_by, source_redemption_id
  ) values (
    customer_row.id, customer_row.customer_code, credit_ref, p_target_type, p_target_id,
    round(p_amount,2), verified->>'confirmed_as', nullif(btrim(p_authorised_by), ''), auth.uid(),
    (result->>'id')::uuid
  ) on conflict(source_redemption_id) do nothing;
  return result || jsonb_build_object('customer_code', customer_row.customer_code, 'credit_reference', credit_ref);
end;
$$;

-- Verified wrapper for portable vouchers. Voucher ownership is customer-based,
-- not vehicle-based, so a different vehicle/job for the same customer is allowed.
create or replace function public.redeem_credit_voucher_verified(
  p_code text,
  p_amount numeric,
  p_target_type text,
  p_target_id uuid,
  p_idempotency_key uuid,
  p_confirmation_value text,
  p_authorised_by text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  voucher_row public.customer_credit_vouchers%rowtype;
  customer_id_value uuid;
  customer_row public.customers%rowtype;
  match_count integer;
  credit_ref text;
  verified jsonb;
  result jsonb;
begin
  select * into voucher_row
  from public.customer_credit_vouchers
  where replace(voucher_code, '-', '') =
    upper(regexp_replace(coalesce(p_code, ''), '[^A-Z0-9]', '', 'g'));
  if not found then
    return jsonb_build_object('error', 'Voucher code not found');
  end if;

  if voucher_row.credit_note_type = 'quotation_deposit' then
    select customer_id, 'QCN-' || lpad(credit_note_number::text, 6, '0')
      into customer_id_value, credit_ref
    from public.quotation_deposit_receipts where id = voucher_row.credit_note_id;
  else
    select customer_id, 'CN-' || lpad(note_number::text, 5, '0')
      into customer_id_value, credit_ref
    from public.customer_overpayment_credit_notes where id = voucher_row.credit_note_id;
  end if;

  if customer_id_value is null then
    if voucher_row.credit_note_type = 'quotation_deposit' then
      select count(*), (array_agg(c.id))[1] into match_count, customer_id_value
      from public.quotation_deposit_receipts n
      join public.customers c on lower(btrim(c.full_name)) = lower(btrim(n.customer_name))
        and (nullif(regexp_replace(coalesce(n.customer_phone,''),'[^0-9]','','g'),'') is null
          or regexp_replace(c.phone,'[^0-9]','','g') = regexp_replace(coalesce(n.customer_phone,''),'[^0-9]','','g'))
      where n.id = voucher_row.credit_note_id;
    else
      select count(*), (array_agg(c.id))[1] into match_count, customer_id_value
      from public.customer_overpayment_credit_notes n
      join public.customers c on lower(btrim(c.full_name)) = lower(btrim(n.customer_name))
        and (nullif(regexp_replace(coalesce(n.customer_phone,''),'[^0-9]','','g'),'') is null
          or regexp_replace(c.phone,'[^0-9]','','g') = regexp_replace(coalesce(n.customer_phone,''),'[^0-9]','','g'))
      where n.id = voucher_row.credit_note_id;
    end if;
    if match_count <> 1 then
      return jsonb_build_object('error', 'This voucher cannot be matched to one registered customer. Link the customer before redeeming it.');
    end if;
  end if;
  select * into customer_row from public.customers where id = customer_id_value;
  verified := public.verify_customer_credit_confirmation(customer_row.id, p_confirmation_value, p_authorised_by);
  if coalesce((verified->>'allowed')::boolean, false) is not true then
    return verified;
  end if;

  result := public.redeem_credit_voucher(p_code, p_amount, p_target_type, p_target_id, p_idempotency_key);

  insert into public.customer_credit_redemption_audit(
    customer_id, customer_code, credit_reference, target_type, target_id,
    amount, confirmed_as, authorised_by, performed_by, source_redemption_id
  ) values (
    customer_row.id, customer_row.customer_code,
    coalesce(credit_ref, voucher_row.voucher_code) || ' / ' || voucher_row.voucher_code,
    p_target_type, p_target_id, round(p_amount,2), verified->>'confirmed_as',
    nullif(btrim(p_authorised_by), ''), auth.uid(), (result->>'id')::uuid
  );
  return result || jsonb_build_object('customer_code', customer_row.customer_code,
    'credit_reference', credit_ref, 'voucher_code', voucher_row.voucher_code);
end;
$$;

-- The older quotation-to-job helper applies every deposit without asking the customer.
-- Keep its accounting logic, but expose it only through this verified wrapper.
create or replace function public.apply_quotation_deposits_to_repair_job_verified(
  p_quotation_id uuid,
  p_repair_job_id uuid,
  p_confirmation_value text,
  p_authorised_by text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $
declare
  quote_row public.quotations%rowtype;
  job_row public.repair_jobs%rowtype;
  verified jsonb;
  result jsonb;
  movement_row record;
begin
  select * into quote_row from public.quotations where id=p_quotation_id;
  if not found then return jsonb_build_object('error','Quotation not found'); end if;
  select * into job_row from public.repair_jobs where id=p_repair_job_id;
  if not found then return jsonb_build_object('error','Job card not found'); end if;
  if quote_row.repair_job_id is distinct from p_repair_job_id
     or quote_row.customer_id is null
     or job_row.customer_id is distinct from quote_row.customer_id then
    return jsonb_build_object('error','The quotation and job card must belong to the same registered customer');
  end if;

  verified := public.verify_customer_credit_confirmation(job_row.customer_id,p_confirmation_value,p_authorised_by);
  if coalesce((verified->>'allowed')::boolean,false) is not true then
    return verified;
  end if;

  result := public.apply_quotation_deposits_to_repair_job(p_quotation_id,p_repair_job_id);

  for movement_row in
    select m.id,m.amount,m.deposit_receipt_id,r.credit_note_number
    from public.customer_credit_movements m
    join public.quotation_deposit_receipts r on r.id=m.deposit_receipt_id
    where m.target_type='repair_job' and m.target_id=p_repair_job_id
      and m.movement_type='application' and m.reversed_at is null
      and m.created_by=auth.uid() and m.created_at=transaction_timestamp()
      and m.reason='Quotation deposit automatically applied to its job card'
  loop
    insert into public.customer_credit_redemption_audit(
      customer_id,customer_code,credit_reference,target_type,target_id,amount,
      confirmed_as,authorised_by,performed_by,source_redemption_id
    ) values (
      job_row.customer_id,verified->>'customer_code',
      'QCN-'||lpad(movement_row.credit_note_number::text,6,'0'),
      'repair_job',p_repair_job_id,movement_row.amount,
      verified->>'confirmed_as',nullif(btrim(p_authorised_by),''),auth.uid(),movement_row.id
    ) on conflict(source_redemption_id) do nothing;
  end loop;

  return result || jsonb_build_object('customer_code',verified->>'customer_code');
end;
$$;

revoke all on function public.apply_quotation_deposits_to_repair_job(uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_quotation_deposits_to_repair_job_verified(uuid,uuid,text,text) to authenticated;

-- Prevent direct calls that would bypass identity confirmation.
revoke all on function public.apply_customer_credit(uuid,numeric,text,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.redeem_credit_voucher(text,numeric,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_customer_credit_verified(uuid,numeric,text,uuid,text,uuid,text,text) to authenticated;
grant execute on function public.redeem_credit_voucher_verified(text,numeric,text,uuid,uuid,text,text) to authenticated;

-- Voucher list with customer identity fields for the wallet, print and WhatsApp.
create or replace function public.list_customer_credit_vouchers_with_identity()
returns table(
  voucher_id uuid, voucher_code text, credit_note_type text, credit_note_id uuid,
  status text, expires_at date, holder_note text, customer_name text, customer_phone text,
  original_amount numeric, available_amount numeric, credit_note_number text,
  customer_code text, is_company boolean, company_name text, customer_id uuid, issued_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Authorised staff access is required' using errcode = '42501';
  end if;
  return query
  select v.id, v.voucher_code, v.credit_note_type, v.credit_note_id,
    case when v.status='active' and v.expires_at<current_date and public.credit_voucher_available_balance(v.id)>0.005 then 'expired'
         when v.status='active' and public.credit_voucher_available_balance(v.id)<=0.005 then 'redeemed'
         else v.status end,
    v.expires_at, v.holder_note,
    coalesce(d.customer_name,o.customer_name),
    coalesce(d.customer_phone,o.customer_phone),
    coalesce(d.amount,o.amount),
    public.credit_voucher_available_balance(v.id),
    case when v.credit_note_type='quotation_deposit' then 'QCN-'||lpad(d.credit_note_number::text,6,'0')
         else 'CN-'||lpad(o.note_number::text,5,'0') end,
    c.customer_code, c.is_company, c.company_name, c.id, v.issued_at
  from public.customer_credit_vouchers v
  left join public.quotation_deposit_receipts d
    on v.credit_note_type='quotation_deposit' and d.id=v.credit_note_id
  left join public.customer_overpayment_credit_notes o
    on v.credit_note_type='invoice_overpayment' and o.id=v.credit_note_id
  left join public.customers c
    on c.id=case when v.credit_note_type='quotation_deposit' then d.customer_id else o.customer_id end
  order by v.issued_at asc;
end;
$$;
revoke all on function public.list_customer_credit_vouchers_with_identity() from public, anon;
grant execute on function public.list_customer_credit_vouchers_with_identity() to authenticated;

-- Expose CID and company identity in the existing customer credit wallet view.
create or replace view public.customer_credit_balances
with (security_invoker = true)
as
select
  receipt.id as deposit_receipt_id,
  receipt.credit_note_number,
  receipt.quotation_id,
  receipt.customer_id,
  receipt.customer_name,
  coalesce(receipt.customer_phone, customer.phone) as phone,
  customer.email,
  receipt.amount as issued_amount,
  receipt.payment_method,
  receipt.payment_date,
  receipt.reference,
  receipt.created_at,
  greatest(receipt.amount - coalesce(sum(movement.amount) filter (where movement.reversed_at is null), 0::numeric), 0::numeric)::numeric(12,2) as available_amount,
  customer.customer_code,
  customer.is_company,
  customer.company_name
from public.quotation_deposit_receipts receipt
left join public.customers customer on customer.id = receipt.customer_id
left join public.customer_credit_movements movement on movement.deposit_receipt_id = receipt.id
group by receipt.id, customer.id;

revoke all on public.customer_credit_balances from public, anon;
grant select on public.customer_credit_balances to authenticated;

commit;
