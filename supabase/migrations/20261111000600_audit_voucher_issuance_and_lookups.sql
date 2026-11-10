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
