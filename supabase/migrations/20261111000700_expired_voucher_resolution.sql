alter table public.customer_credit_movements drop constraint if exists customer_credit_movement_target_check;
alter table public.customer_credit_movements add constraint customer_credit_movement_target_check check (
  ((movement_type='application') and target_type in ('repair_job','sales_order','invoice') and target_id is not null and payment_account_id is null)
  or ((movement_type='application') and target_type='income_transfer' and target_id is not null and payment_account_id is null)
  or ((movement_type='refund') and target_type is null and target_id is null and payment_account_id is not null)
);


create or replace function public.resolve_expired_credit_voucher(
  p_voucher_id uuid,p_decision text,p_amount numeric,p_account_id uuid,p_reason text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $
declare
  uid uuid:=auth.uid(); v public.customer_credit_vouchers%rowtype;
  account_row public.accounts%rowtype; balance_value numeric(12,2); liability_account_id uuid;
  amount_value numeric(12,2); entry_id uuid; resolution_id uuid; movement_key uuid:=gen_random_uuid();
begin
  if uid is null or public.current_access_level()<1 then
    raise exception 'Authorised staff access is required' using errcode='42501';
  end if;
  if p_decision not in ('refund','move_to_income') then raise exception 'Choose refund or move to income'; end if;
  if p_amount is null or p_amount<=0 or p_account_id is null or nullif(btrim(p_reason),'') is null then
    raise exception 'Enter an amount, account and reason';
  end if;
  select * into v from public.customer_credit_vouchers where id=p_voucher_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if v.status not in ('expired','active') or v.expires_at>=current_date then
    raise exception 'Only expired vouchers can be resolved';
  end if;
  select * into account_row from public.accounts where id=p_account_id and is_active;
  if not found then raise exception 'Choose an active account'; end if;
  if p_decision='refund' and not (account_row.type='asset' and account_row.code like '10%') then
    raise exception 'Refunds must use an active cash or bank account';
  end if;
  if p_decision='move_to_income' and account_row.type<>'income' then
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
$;

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
