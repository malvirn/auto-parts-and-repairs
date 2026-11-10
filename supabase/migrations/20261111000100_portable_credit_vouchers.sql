-- Portable customer credit vouchers
-- Safe to re-run. Run in the Supabase SQL editor after reviewing the account codes.
-- Uses the confirmed liability account 2300 and receivables account 1100.

-- Keep invoice balances consistent with the existing sync_repair_job_invoice trigger.
-- That trigger writes payment + customer-credit movements into invoices.amount_paid.
do $
declare
  view_sql text;
  old_amount text := '(GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric)) + COALESCE(credits.applied_amount, 0::numeric))::numeric(12,2) AS amount_paid,';
  new_amount text := 'GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric) + COALESCE(credits.applied_amount, 0::numeric))::numeric(12,2) AS amount_paid,';
  old_balance text := '(COALESCE(invoice.total, 0::numeric) - GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric)) - COALESCE(credits.applied_amount, 0::numeric))::numeric(12,2) AS balance_due,';
  new_balance text := '(COALESCE(invoice.total, 0::numeric) - GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric) + COALESCE(credits.applied_amount, 0::numeric)))::numeric(12,2) AS balance_due,';
begin
  select pg_get_viewdef('public.customer_account_statement'::regclass,true) into view_sql;
  if position(old_amount in view_sql)=0 or position(old_balance in view_sql)=0 then
    raise exception 'The customer_account_statement invoice expressions changed; review before applying voucher balance fix';
  end if;
  view_sql:=replace(view_sql,old_amount,new_amount);
  view_sql:=replace(view_sql,old_balance,new_balance);
  execute 'create or replace view public.customer_account_statement as '||view_sql;
end $;

create table if not exists public.credit_voucher_settings (
  id boolean primary key default true check (id),
  default_expiry_days integer not null default 90 check (default_expiry_days between 1 and 3650),
  terms text not null default 'Redeemable against eligible Centric Auto Mobile job cards, invoices and sales orders. Not redeemable for cash. Subject to available balance and expiry date.',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.credit_voucher_settings (id) values (true) on conflict (id) do nothing;

alter table public.quotation_deposit_receipts
  add column if not exists voucher_code text,
  add column if not exists voucher_status text not null default 'active',
  add column if not exists expires_at date,
  add column if not exists holder_note text;

alter table public.customer_overpayment_credit_notes
  add column if not exists voucher_code text,
  add column if not exists voucher_status text not null default 'active',
  add column if not exists expires_at date,
  add column if not exists holder_note text;

create table if not exists public.customer_credit_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_code text not null unique,
  credit_note_type text not null check (credit_note_type in ('quotation_deposit','invoice_overpayment')),
  credit_note_id uuid not null,
  status text not null default 'active' check (status in ('active','redeemed','expired','cancelled')),
  issued_at timestamptz not null default now(),
  expires_at date not null,
  holder_note text not null default '',
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (credit_note_type, credit_note_id),
  check (voucher_code ~ '^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$')
);
create index if not exists customer_credit_vouchers_status_expiry_idx
  on public.customer_credit_vouchers(status, expires_at);
create index if not exists customer_credit_vouchers_note_idx
  on public.customer_credit_vouchers(credit_note_type, credit_note_id);

create table if not exists public.credit_voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.customer_credit_vouchers(id),
  voucher_code text not null,
  credit_note_type text not null check (credit_note_type in ('quotation_deposit','invoice_overpayment')),
  credit_note_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  target_type text not null check (target_type in ('repair_job','invoice','sales_order')),
  target_id uuid not null,
  redeemed_by uuid not null references auth.users(id),
  redeemed_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  journal_entry_id uuid references public.journal_entries(id),
  reversal_journal_entry_id uuid references public.journal_entries(id),
  idempotency_key uuid not null unique
);
create index if not exists credit_voucher_redemptions_voucher_idx
  on public.credit_voucher_redemptions(voucher_id, redeemed_at desc);
create index if not exists credit_voucher_redemptions_target_idx
  on public.credit_voucher_redemptions(target_type, target_id) where reversed_at is null;

create table if not exists public.credit_voucher_audit (
  id bigint generated always as identity primary key,
  voucher_id uuid references public.customer_credit_vouchers(id),
  voucher_code text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  performed_by uuid references auth.users(id),
  performed_at timestamptz not null default now()
);
create index if not exists credit_voucher_audit_voucher_idx
  on public.credit_voucher_audit(voucher_id, performed_at desc);

create table if not exists public.credit_voucher_lookup_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  failed_count integer not null default 0,
  blocked_until timestamptz
);

alter table public.customer_credit_vouchers enable row level security;
alter table public.credit_voucher_redemptions enable row level security;
alter table public.credit_voucher_audit enable row level security;
alter table public.credit_voucher_settings enable row level security;
alter table public.credit_voucher_lookup_limits enable row level security;

drop policy if exists credit_vouchers_staff_read on public.customer_credit_vouchers;
create policy credit_vouchers_staff_read on public.customer_credit_vouchers
  for select to authenticated using (public.current_access_level() >= 1);
drop policy if exists credit_voucher_redemptions_staff_read on public.credit_voucher_redemptions;
create policy credit_voucher_redemptions_staff_read on public.credit_voucher_redemptions
  for select to authenticated using (public.current_access_level() >= 1);
drop policy if exists credit_voucher_audit_staff_read on public.credit_voucher_audit;
create policy credit_voucher_audit_staff_read on public.credit_voucher_audit
  for select to authenticated using (public.current_access_level() >= 1);
drop policy if exists credit_voucher_settings_staff_read on public.credit_voucher_settings;
create policy credit_voucher_settings_staff_read on public.credit_voucher_settings
  for select to authenticated using (public.current_access_level() >= 1);

grant select on public.customer_credit_vouchers, public.credit_voucher_redemptions,
  public.credit_voucher_audit, public.credit_voucher_settings to authenticated;
revoke insert, update, delete on public.customer_credit_vouchers,
  public.credit_voucher_redemptions, public.credit_voucher_audit,
  public.credit_voucher_settings, public.credit_voucher_lookup_limits from anon, authenticated;

create or replace function public.generate_credit_voucher_code()
returns text language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw_code text := '';
  i integer;
begin
  for i in 1..10 loop
    raw_code := raw_code || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return substr(raw_code,1,5) || '-' || substr(raw_code,6,5);
end;
$$;

create or replace function public.issue_credit_voucher_for_note()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  voucher_id_value uuid;
  code_value text;
  days_value integer;
  expiry_value date;
  source_kind text;
begin
  source_kind := case when tg_table_name = 'quotation_deposit_receipts'
    then 'quotation_deposit' else 'invoice_overpayment' end;
  select default_expiry_days into days_value from public.credit_voucher_settings where id = true;
  days_value := coalesce(days_value,90);
  if tg_table_name = 'quotation_deposit_receipts' then
    expiry_value := coalesce(new.expires_at, coalesce(new.created_at,now())::date + days_value);
  else
    expiry_value := coalesce(new.expires_at, coalesce(new.issued_at,now())::date + days_value);
  end if;
  if new.voucher_code is not null then
    code_value := upper(regexp_replace(new.voucher_code,'[^A-Za-z0-9]','','g'));
    if length(code_value) <> 10 then raise exception 'Voucher code must contain 10 valid characters'; end if;
    code_value := substr(code_value,1,5)||'-'||substr(code_value,6,5);
  else
    code_value := public.generate_credit_voucher_code();
  end if;
  insert into public.customer_credit_vouchers(voucher_code,credit_note_type,credit_note_id,status,expires_at,holder_note,created_by)
  values(code_value,source_kind,new.id,
    case when coalesce(new.voucher_status,'active') in ('active','redeemed','expired','cancelled') then new.voucher_status else 'active' end,
    expiry_value,coalesce(new.holder_note,''),auth.uid())
  on conflict (credit_note_type,credit_note_id) do update
    set expires_at=excluded.expires_at, holder_note=excluded.holder_note
  returning id,voucher_code into voucher_id_value,code_value;
  new.voucher_code := code_value;
  new.expires_at := expiry_value;
  new.voucher_status := (select status from public.customer_credit_vouchers where id=voucher_id_value);
  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(voucher_id_value,code_value,case when tg_op='INSERT' then 'issued' else 'voucher_details_updated' end,
    jsonb_build_object('credit_note_type',source_kind,'credit_note_id',new.id,'expires_at',expiry_value),auth.uid());
  return new;
end;
$$;

drop trigger if exists issue_quotation_deposit_voucher on public.quotation_deposit_receipts;
create trigger issue_quotation_deposit_voucher
  before insert or update of voucher_code, expires_at, holder_note on public.quotation_deposit_receipts
  for each row execute function public.issue_credit_voucher_for_note();
drop trigger if exists issue_invoice_overpayment_voucher on public.customer_overpayment_credit_notes;
create trigger issue_invoice_overpayment_voucher
  before insert or update of voucher_code, expires_at, holder_note on public.customer_overpayment_credit_notes
  for each row execute function public.issue_credit_voucher_for_note();

-- Backfill every historical credit note with a globally unique voucher.
do $$
declare r record; code_value text; expiry_value date; days_value integer;
begin
  select default_expiry_days into days_value from public.credit_voucher_settings where id=true;
  days_value := coalesce(days_value,90);
  for r in select id,created_at,amount from public.quotation_deposit_receipts where voucher_code is null loop
    loop
      code_value := public.generate_credit_voucher_code();
      begin
        insert into public.customer_credit_vouchers(voucher_code,credit_note_type,credit_note_id,status,expires_at)
        values(code_value,'quotation_deposit',r.id,
          case when r.amount - coalesce((select sum(m.amount) from public.customer_credit_movements m where m.deposit_receipt_id=r.id and m.reversed_at is null),0) <= 0.005 then 'redeemed' else 'active' end,
          coalesce(r.created_at::date,current_date)+days_value);
        exit;
      exception when unique_violation then
        -- Generate another code if the random code already exists.
      end;
    end loop;
    update public.quotation_deposit_receipts set
      voucher_code=code_value, expires_at=coalesce(r.created_at::date,current_date)+days_value,
      voucher_status=(select status from public.customer_credit_vouchers where credit_note_type='quotation_deposit' and credit_note_id=r.id)
    where id=r.id;
  end loop;
  for r in select n.id,n.issued_at,c.available_amount from public.customer_overpayment_credit_notes n
    join public.customer_overpayment_credits c on c.id=n.overpayment_credit_id where n.voucher_code is null loop
    loop
      code_value := public.generate_credit_voucher_code();
      begin
        insert into public.customer_credit_vouchers(voucher_code,credit_note_type,credit_note_id,status,expires_at)
        values(code_value,'invoice_overpayment',r.id,
          case when coalesce(r.available_amount,0)<=0.005 then 'redeemed' else 'active' end,
          coalesce(r.issued_at::date,current_date)+days_value);
        exit;
      exception when unique_violation then
      end;
    end loop;
    update public.customer_overpayment_credit_notes set
      voucher_code=code_value, expires_at=coalesce(r.issued_at::date,current_date)+days_value,
      voucher_status=(select status from public.customer_credit_vouchers where credit_note_type='invoice_overpayment' and credit_note_id=r.id)
    where id=r.id;
  end loop;
end $$;

create or replace function public.credit_voucher_available_balance(p_voucher_id uuid)
returns numeric language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v public.customer_credit_vouchers%rowtype; balance_value numeric(12,2);
begin
  select * into v from public.customer_credit_vouchers where id=p_voucher_id;
  if not found then return 0; end if;
  if v.credit_note_type='quotation_deposit' then
    select greatest(0, r.amount-coalesce(sum(m.amount) filter(where m.reversed_at is null),0))
      into balance_value
    from public.quotation_deposit_receipts r
    left join public.customer_credit_movements m on m.deposit_receipt_id=r.id
    where r.id=v.credit_note_id group by r.id,r.amount;
  else
    select coalesce(c.available_amount,0) into balance_value
    from public.customer_overpayment_credit_notes n
    join public.customer_overpayment_credits c on c.id=n.overpayment_credit_id
    where n.id=v.credit_note_id;
  end if;
  return round(coalesce(balance_value,0),2);
end;
$$;


alter table public.customer_credit_movements drop constraint if exists customer_credit_movement_target_check;
alter table public.customer_credit_movements add constraint customer_credit_movement_target_check check (
  ((movement_type='application') and target_type in ('repair_job','sales_order','invoice') and target_id is not null and payment_account_id is null)
  or ((movement_type='application') and target_type='income_transfer' and target_id is not null and payment_account_id is null)
  or ((movement_type='refund') and target_type is null and target_id is null and payment_account_id is not null)
);

create table if not exists public.credit_voucher_expiry_resolutions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.customer_credit_vouchers(id),
  credit_note_type text not null check (credit_note_type in ('quotation_deposit','invoice_overpayment')),
  credit_note_id uuid not null,
  decision text not null check (decision in ('refund','move_to_income')),
  amount numeric(12,2) not null check (amount>0),
  account_id uuid not null references public.accounts(id),
  journal_entry_id uuid not null references public.journal_entries(id),
  reason text not null,
  performed_by uuid not null references auth.users(id),
  performed_at timestamptz not null default now()
);
create index if not exists credit_voucher_expiry_resolutions_voucher_idx
  on public.credit_voucher_expiry_resolutions(voucher_id,performed_at desc);
alter table public.credit_voucher_expiry_resolutions enable row level security;
drop policy if exists credit_voucher_expiry_resolutions_staff_read on public.credit_voucher_expiry_resolutions;
create policy credit_voucher_expiry_resolutions_staff_read on public.credit_voucher_expiry_resolutions
  for select to authenticated using (public.current_access_level()>=1);
grant select on public.credit_voucher_expiry_resolutions to authenticated;
revoke insert,update,delete on public.credit_voucher_expiry_resolutions from anon,authenticated;


create or replace function public.log_credit_voucher_event(p_voucher_id uuid,p_action text)
returns void language plpgsql security definer
set search_path=public,pg_temp
as $
declare v public.customer_credit_vouchers%rowtype; uid uuid:=auth.uid();
begin
  if uid is null or public.current_access_level()<1 then raise exception 'Authorised staff access is required' using errcode='42501'; end if;
  if p_action not in ('printed','whatsapp_shared') then raise exception 'Unsupported voucher event'; end if;
  select * into v from public.customer_credit_vouchers where id=p_voucher_id;
  if not found then raise exception 'Voucher not found'; end if;
  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(v.id,v.voucher_code,p_action,jsonb_build_object('status',v.status),uid);
end;
$;

create or replace function public.resolve_expired_credit_voucher(
  p_voucher_id uuid,p_decision text,p_amount numeric,p_account_id uuid,p_reason text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  uid uuid:=auth.uid(); v public.customer_credit_vouchers%rowtype;
  account_row public.accounts%rowtype; balance_value numeric(12,2); liability_account_id uuid;
  amount_value numeric(12,2); entry_id uuid; resolution_id uuid; movement_key uuid:=gen_random_uuid();
begin
  if uid is null or public.current_access_level()<1 then
    raise exception 'Authorised staff access is required' using errcode='42501';
  end if;
  if p_decision is null or p_decision not in ('refund','move_to_income') then raise exception 'Choose refund or move to income'; end if;
  if p_amount is null or p_amount<=0 or p_account_id is null or nullif(btrim(p_reason),'') is null then
    raise exception 'Enter an amount, account and reason';
  end if;
  select * into v from public.customer_credit_vouchers where id=p_voucher_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if v.status not in ('expired','active') or v.expires_at>=current_date then
    raise exception 'Only expired vouchers can be resolved';
  end if;
  update public.customer_credit_vouchers set status='expired',updated_at=now() where id=v.id and status='active';
  if v.credit_note_type='quotation_deposit' then update public.quotation_deposit_receipts set voucher_status='expired' where id=v.credit_note_id;
  else update public.customer_overpayment_credit_notes set voucher_status='expired' where id=v.credit_note_id; end if;
  select * into account_row from public.accounts where id=p_account_id and is_active;
  if not found then raise exception 'Choose an active account'; end if;
  if p_decision='refund' and not (account_row.type='asset' and account_row.code like '10%') then
    raise exception 'Refunds must use an active cash or bank account';
  end if;
  if p_decision='move_to_income' and account_row.type<>'revenue' then
    raise exception 'Choose an active income account';
  end if;
  select id into liability_account_id from public.accounts where code='2300' and is_active and type='liability';
  if liability_account_id is null then raise exception 'Customer Deposits liability account 2300 is missing or inactive'; end if;
  balance_value:=public.credit_voucher_available_balance(v.id);
  amount_value:=round(p_amount,2);
  if amount_value<=0 or amount_value>balance_value+0.005 then
    raise exception 'Amount exceeds the remaining expired credit of %',balance_value;
  end if;
  insert into public.journal_entries(entry_date,reference,description,source_type,source_id,created_by)
  values((now() at time zone 'Africa/Harare')::date,
    case when p_decision='refund' then 'VREF-' else 'VINC-' end||substr(gen_random_uuid()::text,1,8),
    case when p_decision='refund' then 'Refund expired customer credit voucher' else 'Move expired customer credit to income' end,
    'credit_voucher_expiry_resolution',v.id,uid)
  returning id into entry_id;
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo)
  values(entry_id,liability_account_id,amount_value,0,
    'Release expired customer credit liability'),
    (entry_id,account_row.id,0,amount_value,
    case when p_decision='refund' then 'Refund expired customer credit' else 'Recognise expired customer credit as income' end);
  if p_decision='refund' then
    if v.credit_note_type='quotation_deposit' then
      insert into public.customer_credit_movements(deposit_receipt_id,movement_type,amount,payment_account_id,
        reason,journal_entry_id,idempotency_key,created_by)
      values(v.credit_note_id,'refund',amount_value,account_row.id,btrim(p_reason),entry_id,movement_key,uid);
    else
      update public.customer_overpayment_credits c set available_amount=greatest(0,c.available_amount-amount_value)
      from public.customer_overpayment_credit_notes n
      where n.id=v.credit_note_id and c.id=n.overpayment_credit_id;
      insert into public.customer_overpayment_credit_refunds(credit_note_id,overpayment_credit_id,amount,
        payment_date,payment_method,account_id,journal_entry_id,created_by)
      select n.id,n.overpayment_credit_id,amount_value,(now() at time zone 'Africa/Harare')::date,
        'Voucher expiry refund',account_row.id,entry_id,uid
      from public.customer_overpayment_credit_notes n where n.id=v.credit_note_id;
    end if;
  else
    if v.credit_note_type='quotation_deposit' then
      insert into public.customer_credit_movements(deposit_receipt_id,movement_type,amount,target_type,target_id,
        reason,journal_entry_id,idempotency_key,created_by)
      values(v.credit_note_id,'application',amount_value,'income_transfer',account_row.id,
        'Expired voucher moved to income: '||btrim(p_reason),entry_id,movement_key,uid);
    else
      update public.customer_overpayment_credits c set available_amount=greatest(0,c.available_amount-amount_value)
      from public.customer_overpayment_credit_notes n
      where n.id=v.credit_note_id and c.id=n.overpayment_credit_id;
    end if;
  end if;
  insert into public.credit_voucher_expiry_resolutions(voucher_id,credit_note_type,credit_note_id,decision,
    amount,account_id,journal_entry_id,reason,performed_by)
  values(v.id,v.credit_note_type,v.credit_note_id,p_decision,amount_value,account_row.id,entry_id,btrim(p_reason),uid)
  returning id into resolution_id;
  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(v.id,v.voucher_code,case when p_decision='refund' then 'expired_credit_refunded' else 'expired_credit_moved_to_income' end,
    jsonb_build_object('amount',amount_value,'account_code',account_row.code,'account_name',account_row.name,
      'reason',btrim(p_reason),'journal_entry_id',entry_id),uid);
  balance_value:=public.credit_voucher_available_balance(v.id);
  return jsonb_build_object('resolution_id',resolution_id,'amount',amount_value,'remaining_balance',balance_value,'journal_entry_id',entry_id);
end;
$$;

create or replace function public.lookup_credit_voucher(p_code text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid:=auth.uid(); v public.customer_credit_vouchers%rowtype;
  note_name text; note_phone text; balance_value numeric(12,2); status_value text;
  limit_row public.credit_voucher_lookup_limits%rowtype; clean_code text;
begin
  if uid is null or public.current_access_level()<1 then
    raise exception 'Authorised staff access is required' using errcode='42501';
  end if;
  insert into public.credit_voucher_lookup_limits(user_id) values(uid) on conflict(user_id) do nothing;
  select * into limit_row from public.credit_voucher_lookup_limits where user_id=uid for update;
  if limit_row.blocked_until is not null and limit_row.blocked_until>now() then
    return jsonb_build_object('error','Too many incorrect voucher codes. Try again after '||to_char(limit_row.blocked_until at time zone 'Africa/Harare','HH24:MI'),'blocked_until',limit_row.blocked_until);
  end if;
  clean_code := upper(regexp_replace(coalesce(p_code,''),'[^A-Z0-9]','','g'));
  select * into v from public.customer_credit_vouchers
    where replace(voucher_code,'-','')=clean_code;
  if not found then
    if limit_row.window_started_at < now()-interval '10 minutes' then
      update public.credit_voucher_lookup_limits set window_started_at=now(),failed_count=1 where user_id=uid;
    else
      update public.credit_voucher_lookup_limits set failed_count=failed_count+1,
        blocked_until=case when failed_count+1>=5 then now()+interval '15 minutes' else blocked_until end
      where user_id=uid;
    end if;
    insert into public.credit_voucher_audit(voucher_code,action,details,performed_by)
    values(null,'lookup_failed',jsonb_build_object('code_suffix',right(clean_code,2)),uid);
    return jsonb_build_object('error','Voucher code not found');
  end if;
  balance_value:=public.credit_voucher_available_balance(v.id);
  status_value:=case when v.status='active' and v.expires_at<current_date and balance_value>0.005 then 'expired'
    when balance_value<=0.005 and v.status='active' then 'redeemed' else v.status end;
  if status_value<>v.status then
    update public.customer_credit_vouchers set status=status_value,updated_at=now() where id=v.id;
    if v.credit_note_type='quotation_deposit' then
      update public.quotation_deposit_receipts set voucher_status=status_value where id=v.credit_note_id;
    else
      update public.customer_overpayment_credit_notes set voucher_status=status_value where id=v.credit_note_id;
    end if;
  end if;
  if v.credit_note_type='quotation_deposit' then
    select customer_name,customer_phone into note_name,note_phone from public.quotation_deposit_receipts where id=v.credit_note_id;
  else
    select customer_name,customer_phone into note_name,note_phone from public.customer_overpayment_credit_notes where id=v.credit_note_id;
  end if;
  update public.credit_voucher_lookup_limits set failed_count=0,window_started_at=now(),blocked_until=null where user_id=uid;
  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(v.id,v.voucher_code,'lookup',jsonb_build_object('status',status_value),uid);
  return jsonb_build_object(
    'voucher_id',v.id,'voucher_code',v.voucher_code,'status',status_value,
    'available_amount',balance_value,'expires_at',v.expires_at,
    'customer_first_name',split_part(coalesce(note_name,'Customer'),' ',1),
    'phone_last4',right(regexp_replace(coalesce(note_phone,''),'\D','','g'),4),
    'credit_note_type',v.credit_note_type,'credit_note_id',v.credit_note_id
  );
end;
$$;

create or replace function public.redeem_credit_voucher(
  p_code text,p_amount numeric,p_target_type text,p_target_id uuid,p_idempotency_key uuid
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid:=auth.uid(); v public.customer_credit_vouchers%rowtype;
  balance_value numeric(12,2); amount_value numeric(12,2);
  target_total numeric(12,2); target_paid numeric(12,2):=0; target_applied numeric(12,2):=0; target_balance numeric(12,2):=0;
  deposit_account_id uuid; receivable_account_id uuid; entry_id uuid; redemption_id uuid;
  existing_row public.credit_voucher_redemptions%rowtype; target_label text; new_status text;
begin
  if uid is null or public.current_access_level()<1 then raise exception 'Authorised staff access is required' using errcode='42501'; end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_target_id is null then raise exception 'Enter a valid amount and target'; end if;
  if p_target_type not in ('repair_job','invoice','sales_order') then raise exception 'Choose a job card, invoice or sales order'; end if;
  amount_value:=round(p_amount,2);
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into existing_row from public.credit_voucher_redemptions where idempotency_key=p_idempotency_key;
  if found then return jsonb_build_object('id',existing_row.id,'amount',existing_row.amount,'replayed',true); end if;
  select * into v from public.customer_credit_vouchers
    where replace(voucher_code,'-','')=upper(regexp_replace(coalesce(p_code,''),'[^A-Z0-9]','','g'))
    for update;
  if not found then raise exception 'Voucher code not found'; end if;
  if v.status<>'active' then raise exception 'Voucher is %',v.status; end if;
  if v.expires_at<current_date then
    update public.customer_credit_vouchers set status='expired',updated_at=now() where id=v.id;
    raise exception 'Voucher has expired';
  end if;
  balance_value:=public.credit_voucher_available_balance(v.id);
  if amount_value>balance_value+0.005 then raise exception 'Amount exceeds available voucher credit of %',balance_value; end if;

  if p_target_type='repair_job' then
    select coalesce(total_cost,0)::numeric(12,2) into target_total from public.repair_jobs where id=p_target_id for update;
    if not found then raise exception 'Job card not found'; end if;
    select coalesce(sum(amount),0) into target_paid from public.repair_job_payments where repair_job_id=p_target_id and voided_at is null;
    select coalesce(sum(amount),0) into target_applied from public.customer_credit_movements
      where target_type='repair_job' and target_id=p_target_id and movement_type='application' and reversed_at is null;
    target_label:='Job card '||p_target_id;
  elsif p_target_type='invoice' then
    select coalesce(total,0)::numeric(12,2),coalesce(amount_paid,0)::numeric(12,2) into target_total,target_paid
      from public.invoices where id=p_target_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    select greatest(target_paid,coalesce(sum(amount),0)) into target_paid from public.invoice_payments where invoice_id=p_target_id;
    select coalesce(sum(amount),0) into target_applied from public.customer_credit_movements
      where target_type='invoice' and target_id=p_target_id and movement_type='application' and reversed_at is null;
    target_label:='Invoice '||p_target_id;
  else
    select total_usd::numeric(12,2) into target_total from public.sales_orders where id=p_target_id and status='Confirmed' for update;
    if not found then raise exception 'Confirmed sales order not found'; end if;
    select greatest(
      coalesce((select max(amount) from public.receipts where sales_order_id=p_target_id and voided_at is null),0),
      coalesce((select sum(amount) from public.quick_sale_payments where sales_order_id=p_target_id),0)
    ) into target_paid;
    select coalesce(sum(amount),0) into target_applied from public.customer_credit_movements
      where target_type='sales_order' and target_id=p_target_id and movement_type='application' and reversed_at is null;
    target_label:='Sales order '||p_target_id;
  end if;
  -- All voucher redemptions are mirrored into customer_credit_movements so existing balance views stay in sync.
  -- The SELECT above adds only invoice-overpayment voucher rows to existing applications.
  select greatest(coalesce(statement.balance_due,0),0)::numeric(12,2) into target_balance
  from public.customer_account_statement statement
  where statement.source_id=p_target_id
    and statement.source_type=case p_target_type when 'repair_job' then 'Repair job' when 'sales_order' then 'Sales order' else 'Invoice' end;
  if not found or target_balance<=0.005 then raise exception 'The selected target has no outstanding balance'; end if;
  if amount_value>target_balance+0.005 then
    raise exception 'Voucher amount exceeds the target balance of %',target_balance;
  end if;

  select id into deposit_account_id from public.accounts where code='2300' and is_active and type='liability';
  select id into receivable_account_id from public.accounts where code='1100' and is_active and type='asset';
  if deposit_account_id is null or receivable_account_id is null then raise exception 'Accounts 2300 and 1100 must both be active'; end if;
  redemption_id:=gen_random_uuid();
  insert into public.journal_entries(entry_date,reference,description,source_type,source_id,created_by)
  values((now() at time zone 'Africa/Harare')::date,'VRED-'||substr(redemption_id::text,1,8),
    'Portable customer credit voucher redeemed · '||target_label,'credit_voucher_redemption',redemption_id,uid)
  returning id into entry_id;
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo)
  values(entry_id,deposit_account_id,amount_value,0,'Redeem customer credit voucher'),
        (entry_id,receivable_account_id,0,amount_value,'Apply voucher to outstanding balance');
  insert into public.credit_voucher_redemptions(id,voucher_id,voucher_code,credit_note_type,credit_note_id,
    amount,target_type,target_id,redeemed_by,journal_entry_id,idempotency_key)
  values(redemption_id,v.id,v.voucher_code,v.credit_note_type,v.credit_note_id,amount_value,
    p_target_type,p_target_id,uid,entry_id,p_idempotency_key);
  if v.credit_note_type='quotation_deposit' then
    insert into public.customer_credit_movements(deposit_receipt_id,movement_type,amount,target_type,target_id,
      reason,journal_entry_id,idempotency_key,created_by)
    values(v.credit_note_id,'application',amount_value,p_target_type,p_target_id,
      'Portable voucher redemption',entry_id,p_idempotency_key,uid);
  else
    insert into public.customer_credit_movements(deposit_receipt_id,movement_type,amount,target_type,target_id,
      reason,journal_entry_id,idempotency_key,created_by)
    values(null,'application',amount_value,p_target_type,p_target_id,
      'Portable invoice-overpayment voucher redemption',entry_id,p_idempotency_key,uid);
    update public.customer_overpayment_credits c set available_amount=greatest(0,c.available_amount-amount_value)
    from public.customer_overpayment_credit_notes n
    where n.id=v.credit_note_id and c.id=n.overpayment_credit_id;
  end if;
  balance_value:=public.credit_voucher_available_balance(v.id);
  new_status:=case when balance_value<=0.005 then 'redeemed' else 'active' end;
  update public.customer_credit_vouchers set status=new_status,updated_at=now() where id=v.id;
  if v.credit_note_type='quotation_deposit' then update public.quotation_deposit_receipts set voucher_status=new_status where id=v.credit_note_id;
  else update public.customer_overpayment_credit_notes set voucher_status=new_status where id=v.credit_note_id; end if;
  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(v.id,v.voucher_code,'redeemed',jsonb_build_object('amount',amount_value,'target_type',p_target_type,'target_id',p_target_id,'journal_entry_id',entry_id),uid);
  return jsonb_build_object('id',redemption_id,'amount',amount_value,'remaining_balance',balance_value,'journal_entry_id',entry_id);
end;
$$;

create or replace function public.manage_credit_voucher(
  p_voucher_id uuid,p_action text,p_reason text,p_new_expiry date default null,p_redemption_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid:=auth.uid(); v public.customer_credit_vouchers%rowtype;
  r public.credit_voucher_redemptions%rowtype; entry_id uuid; reversal_id uuid;
  deposit_account_id uuid; receivable_account_id uuid; balance_value numeric(12,2); new_status text;
begin
  if uid is null or public.current_access_level()<1 then raise exception 'Authorised staff access is required' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'A reason is required for this change'; end if;
  select * into v from public.customer_credit_vouchers where id=p_voucher_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if p_action='cancel' then
    if v.status='redeemed' then raise exception 'A fully redeemed voucher cannot be cancelled'; end if;
    update public.customer_credit_vouchers set status='cancelled',updated_at=now() where id=v.id;
    if v.credit_note_type='quotation_deposit' then update public.quotation_deposit_receipts set voucher_status='cancelled' where id=v.credit_note_id;
    else update public.customer_overpayment_credit_notes set voucher_status='cancelled' where id=v.credit_note_id; end if;
  elsif p_action='set_expiry' then
    if p_new_expiry is null then raise exception 'Choose a new expiry date'; end if;
    balance_value:=public.credit_voucher_available_balance(v.id);
    new_status:=case when balance_value<=0.005 then 'redeemed' when p_new_expiry<current_date then 'expired' else 'active' end;
    update public.customer_credit_vouchers set expires_at=p_new_expiry,status=new_status,updated_at=now() where id=v.id;
    if v.credit_note_type='quotation_deposit' then
      update public.quotation_deposit_receipts set expires_at=p_new_expiry,voucher_status=new_status where id=v.credit_note_id;
    else
      update public.customer_overpayment_credit_notes set expires_at=p_new_expiry,voucher_status=new_status where id=v.credit_note_id;
    end if;
  elsif p_action='reverse' then
    select * into r from public.credit_voucher_redemptions where id=p_redemption_id and voucher_id=v.id for update;
    if not found then raise exception 'Voucher redemption not found'; end if;
    if r.reversed_at is not null then raise exception 'This redemption has already been reversed'; end if;
    select id into deposit_account_id from public.accounts where code='2300' and is_active and type='liability';
    select id into receivable_account_id from public.accounts where code='1100' and is_active and type='asset';
    reversal_id:=gen_random_uuid();
    insert into public.journal_entries(entry_date,reference,description,source_type,source_id,created_by)
    values((now() at time zone 'Africa/Harare')::date,'VREV-'||substr(reversal_id::text,1,8),
      'Reverse portable credit voucher redemption · '||p_reason,'credit_voucher_reversal',r.id,uid)
    returning id into entry_id;
    insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo)
    values(entry_id,deposit_account_id,0,r.amount,'Reverse voucher liability reduction'),
          (entry_id,receivable_account_id,r.amount,0,'Restore receivable balance');
    update public.credit_voucher_redemptions set reversed_at=now(),reversed_by=uid,
      reversal_reason=btrim(p_reason),reversal_journal_entry_id=entry_id where id=r.id;
    update public.customer_credit_movements set reversed_at=now(),reversed_by=uid,
      reversal_reason=btrim(p_reason),reversal_journal_entry_id=entry_id
    where journal_entry_id=r.journal_entry_id;
    if r.credit_note_type='invoice_overpayment' then
      update public.customer_overpayment_credits c set available_amount=c.available_amount+r.amount
      from public.customer_overpayment_credit_notes n
      where n.id=r.credit_note_id and c.id=n.overpayment_credit_id;
    end if;
    balance_value:=public.credit_voucher_available_balance(v.id);
    new_status:=case when balance_value<=0.005 then 'redeemed' when v.expires_at<current_date then 'expired' else 'active' end;
    update public.customer_credit_vouchers set status=new_status,updated_at=now() where id=v.id;
    if v.credit_note_type='quotation_deposit' then update public.quotation_deposit_receipts set voucher_status=new_status where id=v.credit_note_id;
    else update public.customer_overpayment_credit_notes set voucher_status=new_status where id=v.credit_note_id; end if;
  else
    raise exception 'Unsupported voucher action';
  end if;
  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(v.id,v.voucher_code,p_action,jsonb_build_object('reason',btrim(p_reason),'new_expiry',p_new_expiry,'redemption_id',p_redemption_id),uid);
  return jsonb_build_object('voucher_id',v.id,'action',p_action);
end;
$$;

create or replace function public.update_credit_voucher_settings(p_default_expiry_days integer,p_terms text)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.current_access_level()<1 then raise exception 'Authorised staff access is required' using errcode='42501'; end if;
  if p_default_expiry_days is null or p_default_expiry_days not between 1 and 3650 then raise exception 'Expiry must be between 1 and 3650 days'; end if;
  update public.credit_voucher_settings set default_expiry_days=p_default_expiry_days,
    terms=coalesce(nullif(btrim(p_terms),''),terms),updated_at=now(),updated_by=auth.uid() where id=true;
  insert into public.credit_voucher_audit(action,details,performed_by)
  values('settings_updated',jsonb_build_object('default_expiry_days',p_default_expiry_days),auth.uid());
end;
$$;


create or replace function public.list_customer_credit_vouchers()
returns table(
  voucher_id uuid,voucher_code text,credit_note_type text,credit_note_id uuid,
  status text,expires_at date,holder_note text,customer_name text,customer_phone text,
  original_amount numeric,available_amount numeric,credit_note_number text
) language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.current_access_level()<1 then
    raise exception 'Authorised staff access is required' using errcode='42501';
  end if;
  return query
  select v.id,v.voucher_code,v.credit_note_type,v.credit_note_id,
    case when v.status='active' and v.expires_at<current_date and public.credit_voucher_available_balance(v.id)>0.005 then 'expired'
         when v.status='active' and public.credit_voucher_available_balance(v.id)<=0.005 then 'redeemed'
         else v.status end,
    v.expires_at,v.holder_note,
    case when v.credit_note_type='quotation_deposit' then d.customer_name else o.customer_name end,
    case when v.credit_note_type='quotation_deposit' then d.customer_phone else o.customer_phone end,
    case when v.credit_note_type='quotation_deposit' then d.amount else o.amount end,
    public.credit_voucher_available_balance(v.id),
    case when v.credit_note_type='quotation_deposit' then 'QCN-'||lpad(d.credit_note_number::text,6,'0')
         else 'CN-'||lpad(o.note_number::text,5,'0') end
  from public.customer_credit_vouchers v
  left join public.quotation_deposit_receipts d on v.credit_note_type='quotation_deposit' and d.id=v.credit_note_id
  left join public.customer_overpayment_credit_notes o on v.credit_note_type='invoice_overpayment' and o.id=v.credit_note_id
  order by v.issued_at desc;
end;
$$;

revoke all on function public.list_customer_credit_vouchers() from public, anon;
revoke all on function public.log_credit_voucher_event(uuid,text) from public, anon;
grant execute on function public.log_credit_voucher_event(uuid,text) to authenticated;
revoke all on function public.resolve_expired_credit_voucher(uuid,text,numeric,uuid,text) from public, anon;
grant execute on function public.resolve_expired_credit_voucher(uuid,text,numeric,uuid,text) to authenticated;
revoke all on function public.lookup_credit_voucher(text) from public, anon;
revoke all on function public.redeem_credit_voucher(text,numeric,text,uuid,uuid) from public, anon;
revoke all on function public.manage_credit_voucher(uuid,text,text,date,uuid) from public, anon;
revoke all on function public.update_credit_voucher_settings(integer,text) from public, anon;
grant execute on function public.list_customer_credit_vouchers() to authenticated;
grant execute on function public.lookup_credit_voucher(text) to authenticated;
grant execute on function public.redeem_credit_voucher(text,numeric,text,uuid,uuid) to authenticated;
grant execute on function public.manage_credit_voucher(uuid,text,text,date,uuid) to authenticated;
grant execute on function public.update_credit_voucher_settings(integer,text) to authenticated;
revoke all on function public.generate_credit_voucher_code() from public, anon, authenticated;
revoke all on function public.issue_credit_voucher_for_note() from public, anon, authenticated;
revoke all on function public.credit_voucher_available_balance(uuid) from public, anon, authenticated;
