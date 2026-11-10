-- Resolve unused expired voucher balances through a posted refund or income journal entry.

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

create or replace function public.resolve_expired_credit_voucher(
  p_voucher_id uuid,p_decision text,p_amount numeric,p_account_id uuid,p_reason text
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  uid uuid:=auth.uid(); v public.customer_credit_vouchers%rowtype;
  account_row public.accounts%rowtype; balance_value numeric(12,2);
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
  values(entry_id,(select id from public.accounts where code='2300' and is_active and type='liability'),amount_value,0,
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

