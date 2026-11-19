-- Job-card voucher redemptions update the linked invoice and create a printable receipt.
alter table public.receipts
 add column if not exists payment_method text,
 add column if not exists credit_voucher_redemption_id uuid;
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.receipts'::regclass and conname='receipts_credit_voucher_redemption_id_fkey') then
  alter table public.receipts add constraint receipts_credit_voucher_redemption_id_fkey
   foreign key(credit_voucher_redemption_id) references public.credit_voucher_redemptions(id) on delete set null;
 end if;
end $$;
create unique index if not exists receipts_credit_voucher_redemption_uidx
 on public.receipts(credit_voucher_redemption_id) where credit_voucher_redemption_id is not null;
CREATE OR REPLACE FUNCTION public.redeem_credit_voucher(p_code text, p_amount numeric, p_target_type text, p_target_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  uid uuid:=auth.uid();
  v public.customer_credit_vouchers%rowtype;
  balance_value numeric(12,2);
  amount_value numeric(12,2);
  target_total numeric(12,2);
  target_paid numeric(12,2):=0;
  target_applied numeric(12,2):=0;
  target_balance numeric(12,2):=0;
  deposit_account_id uuid;
  receivable_account_id uuid;
  entry_id uuid;
  redemption_id uuid;
  receipt_id uuid;
  receipt_number_value integer;
  existing_row public.credit_voucher_redemptions%rowtype;
  target_label text;
  new_status text;
  job_customer_id uuid;
  note_customer_id uuid;
  job_customer_name text;
  job_customer_phone text;
  note_customer_name text;
  note_customer_phone text;
begin
  if uid is null or public.current_access_level()<1 then
    raise exception 'Authorised staff access is required' using errcode='42501';
  end if;
  if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_target_id is null then
    raise exception 'Enter a valid amount and target';
  end if;
  if p_target_type not in ('repair_job','invoice','sales_order') then
    raise exception 'Choose a job card, invoice or sales order';
  end if;

  amount_value:=round(p_amount,2);
  if amount_value<=0 then raise exception 'Enter an amount greater than zero'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));

  select * into existing_row
  from public.credit_voucher_redemptions
  where idempotency_key=p_idempotency_key;
  if found then
    balance_value:=public.credit_voucher_available_balance(existing_row.voucher_id);
    select id,receipt_number into receipt_id,receipt_number_value
    from public.receipts
    where credit_voucher_redemption_id=existing_row.id;
    return jsonb_build_object(
      'id',existing_row.id,'amount',existing_row.amount,
      'remaining_balance',balance_value,'journal_entry_id',existing_row.journal_entry_id,
      'receipt_id',receipt_id,'receipt_number',receipt_number_value,'replayed',true
    );
  end if;

  select * into v
  from public.customer_credit_vouchers
  where replace(voucher_code,'-','')=upper(regexp_replace(coalesce(p_code,''),'[^A-Z0-9]','','g'))
  for update;
  if not found then raise exception 'Voucher code not found'; end if;
  if v.status<>'active' then raise exception 'Voucher is %',v.status; end if;
  if v.expires_at<current_date then
    update public.customer_credit_vouchers set status='expired',updated_at=now() where id=v.id;
    raise exception 'Voucher has expired';
  end if;

  balance_value:=public.credit_voucher_available_balance(v.id);
  if amount_value>balance_value+0.005 then
    raise exception 'Amount exceeds available voucher credit of %',balance_value;
  end if;

  if p_target_type='repair_job' then
    select coalesce(rj.total_cost,0)::numeric(12,2),rj.customer_id,c.full_name,c.phone
      into target_total,job_customer_id,job_customer_name,job_customer_phone
    from public.repair_jobs rj
    join public.customers c on c.id=rj.customer_id
    where rj.id=p_target_id
    for update of rj;
    if not found then raise exception 'Job card not found'; end if;

    if v.credit_note_type='quotation_deposit' then
      select customer_id,customer_name,customer_phone
        into note_customer_id,note_customer_name,note_customer_phone
      from public.quotation_deposit_receipts where id=v.credit_note_id;
    else
      select customer_id,customer_name,customer_phone
        into note_customer_id,note_customer_name,note_customer_phone
      from public.customer_overpayment_credit_notes where id=v.credit_note_id;
    end if;

    if note_customer_id is not null then
      if note_customer_id<>job_customer_id then
        raise exception 'This voucher belongs to a different customer';
      end if;
    elsif nullif(regexp_replace(coalesce(note_customer_phone,''),'[^0-9]','','g'),'') is not null
      and nullif(regexp_replace(coalesce(job_customer_phone,''),'[^0-9]','','g'),'') is not null then
      if regexp_replace(note_customer_phone,'[^0-9]','','g')<>regexp_replace(job_customer_phone,'[^0-9]','','g') then
        raise exception 'This voucher belongs to a different customer';
      end if;
    elsif lower(btrim(coalesce(note_customer_name,'')))<>lower(btrim(coalesce(job_customer_name,''))) then
      raise exception 'This voucher belongs to a different customer';
    end if;

    select coalesce(sum(amount),0) into target_paid
    from public.repair_job_payments
    where repair_job_id=p_target_id and voided_at is null;
    select coalesce(sum(amount),0) into target_applied
    from public.customer_credit_movements
    where target_type='repair_job' and target_id=p_target_id
      and movement_type='application' and reversed_at is null;
    target_label:='Job card '||p_target_id;
  elsif p_target_type='invoice' then
    select coalesce(total,0)::numeric(12,2),coalesce(amount_paid,0)::numeric(12,2)
      into target_total,target_paid
    from public.invoices where id=p_target_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    select greatest(target_paid,coalesce(sum(amount),0)) into target_paid
    from public.invoice_payments where invoice_id=p_target_id and voided_at is null;
    select coalesce(sum(amount),0) into target_applied
    from public.customer_credit_movements
    where target_type='invoice' and target_id=p_target_id
      and movement_type='application' and reversed_at is null;
    target_label:='Invoice '||p_target_id;
  else
    select total_usd::numeric(12,2) into target_total
    from public.sales_orders where id=p_target_id and status='Confirmed' for update;
    if not found then raise exception 'Confirmed sales order not found'; end if;
    select greatest(
      coalesce((select max(amount) from public.receipts where sales_order_id=p_target_id and voided_at is null),0),
      coalesce((select sum(amount) from public.quick_sale_payments where sales_order_id=p_target_id),0)
    ) into target_paid;
    select coalesce(sum(amount),0) into target_applied
    from public.customer_credit_movements
    where target_type='sales_order' and target_id=p_target_id
      and movement_type='application' and reversed_at is null;
    target_label:='Sales order '||p_target_id;
  end if;

  select greatest(coalesce(statement.balance_due,0),0)::numeric(12,2)
    into target_balance
  from public.customer_account_statement statement
  where statement.source_id=p_target_id
    and statement.source_type=case p_target_type
      when 'repair_job' then 'Repair job'
      when 'sales_order' then 'Sales order'
      else 'Invoice' end;
  if not found or target_balance<=0.005 then
    raise exception 'The selected target has no outstanding balance';
  end if;
  if amount_value>target_balance+0.005 then
    raise exception 'Voucher amount exceeds the target balance of %',target_balance;
  end if;

  select id into deposit_account_id from public.accounts
  where code='2300' and is_active and type='liability';
  select id into receivable_account_id from public.accounts
  where code='1100' and is_active and type='asset';
  if deposit_account_id is null or receivable_account_id is null then
    raise exception 'Accounts 2300 and 1100 must both be active';
  end if;

  redemption_id:=gen_random_uuid();
  insert into public.journal_entries(entry_date,reference,description,source_type,source_id,created_by)
  values((now() at time zone 'Africa/Harare')::date,
    'VRED-'||substr(redemption_id::text,1,8),
    'Portable customer credit voucher redeemed · '||target_label,
    'credit_voucher_redemption',redemption_id,uid)
  returning id into entry_id;

  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo)
  values(entry_id,deposit_account_id,amount_value,0,'Redeem customer credit voucher'),
        (entry_id,receivable_account_id,0,amount_value,'Apply voucher to outstanding balance');

  insert into public.credit_voucher_redemptions(
    id,voucher_id,voucher_code,credit_note_type,credit_note_id,amount,target_type,target_id,
    redeemed_by,journal_entry_id,idempotency_key
  )
  values(redemption_id,v.id,v.voucher_code,v.credit_note_type,v.credit_note_id,
    amount_value,p_target_type,p_target_id,uid,entry_id,p_idempotency_key);

  if v.credit_note_type='quotation_deposit' then
    insert into public.customer_credit_movements(
      deposit_receipt_id,movement_type,amount,target_type,target_id,reason,
      journal_entry_id,idempotency_key,created_by
    )
    values(v.credit_note_id,'application',amount_value,p_target_type,p_target_id,
      'Portable voucher redemption',entry_id,p_idempotency_key,uid);
  else
    insert into public.customer_credit_movements(
      deposit_receipt_id,movement_type,amount,target_type,target_id,reason,
      journal_entry_id,idempotency_key,created_by
    )
    values(null,'application',amount_value,p_target_type,p_target_id,
      'Portable invoice-overpayment voucher redemption',entry_id,p_idempotency_key,uid);
    update public.customer_overpayment_credits c
    set available_amount=greatest(0,c.available_amount-amount_value)
    from public.customer_overpayment_credit_notes n
    where n.id=v.credit_note_id and c.id=n.overpayment_credit_id;
  end if;

  if p_target_type='repair_job' then
    perform public.sync_repair_job_invoice(p_target_id);
    insert into public.receipts(repair_job_id,amount,payment_method,credit_voucher_redemption_id)
    values(p_target_id,amount_value,'Credit voucher',redemption_id)
    returning id,receipt_number into receipt_id,receipt_number_value;
  end if;

  balance_value:=public.credit_voucher_available_balance(v.id);
  new_status:=case when balance_value<=0.005 then 'redeemed' else 'active' end;
  update public.customer_credit_vouchers set status=new_status,updated_at=now() where id=v.id;
  if v.credit_note_type='quotation_deposit' then
    update public.quotation_deposit_receipts set voucher_status=new_status where id=v.credit_note_id;
  else
    update public.customer_overpayment_credit_notes set voucher_status=new_status where id=v.credit_note_id;
  end if;

  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(v.id,v.voucher_code,'redeemed',
    jsonb_build_object('amount',amount_value,'target_type',p_target_type,'target_id',p_target_id,
      'journal_entry_id',entry_id,'receipt_id',receipt_id),uid);

  return jsonb_build_object(
    'id',redemption_id,'amount',amount_value,'remaining_balance',balance_value,
    'journal_entry_id',entry_id,'receipt_id',receipt_id,'receipt_number',receipt_number_value
  );
end;
$function$

revoke all on function public.redeem_credit_voucher(text,numeric,text,uuid,uuid) from public,anon;
grant execute on function public.redeem_credit_voucher(text,numeric,text,uuid,uuid) to authenticated;
