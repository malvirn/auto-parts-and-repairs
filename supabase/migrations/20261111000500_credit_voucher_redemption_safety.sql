-- Voucher correctness fixes: audit successful lookups, idempotent retries and invoice balance math.
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
  values(v.id,v.voucher_code,'lookup_succeeded',jsonb_build_object('status',status_value,'available_amount',balance_value),uid);
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
  if found then
    balance_value:=public.credit_voucher_available_balance(existing_row.voucher_id);
    return jsonb_build_object('id',existing_row.id,'amount',existing_row.amount,'remaining_balance',balance_value,
      'journal_entry_id',existing_row.journal_entry_id,'replayed',true);
  end if;
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
    select coalesce(sum(amount),0) into target_applied from public.customer_credit_movements
      where target_type='invoice' and target_id=p_target_id and movement_type='application' and reversed_at is null;
    -- invoices.amount_paid may already include credit movements through the invoice sync trigger.
    -- Subtract those credits before adding them separately to avoid double-counting the balance.
    select greatest(coalesce(target_paid,0)-coalesce(target_applied,0),coalesce(sum(amount),0))
      into target_paid from public.invoice_payments where invoice_id=p_target_id;
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
