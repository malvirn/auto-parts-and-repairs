-- Multi-currency tender support. USD remains Centric's functional ledger currency.
-- Each payment retains the original tender, tender currency, conversion snapshot and receiving account.
alter table public.accounts
  add column if not exists currency_code text not null default 'USD',
  add column if not exists payment_channel text;

update public.accounts set currency_code='USD' where currency_code is null or currency_code='';
update public.accounts set payment_channel=case code when '1000' then 'cash' when '1010' then 'bank' when '1020' then 'ecocash' when '1050' then 'cash' else payment_channel end
where code in ('1000','1010','1020','1050');

insert into public.accounts(code,name,type,normal_balance,currency_code,payment_channel,is_active)
values
 ('1001','Cash on Hand (USD)','asset','debit','USD','cash',true),
 ('1002','Cash on Hand (ZiG)','asset','debit','ZiG','cash',true),
 ('1011','Bank Account (USD)','asset','debit','USD','bank',true),
 ('1012','Bank Account (ZiG)','asset','debit','ZiG','bank',true),
 ('1021','EcoCash (USD)','asset','debit','USD','ecocash',true),
 ('1022','EcoCash (ZiG)','asset','debit','ZiG','ecocash',true),
 ('1031','Card / POS (USD)','asset','debit','USD','card',true),
 ('1032','Card / POS (ZiG)','asset','debit','ZiG','card',true)
on conflict(code) do update set name=excluded.name,type='asset',normal_balance='debit',
  currency_code=excluded.currency_code,payment_channel=excluded.payment_channel,is_active=true;

alter table public.invoice_payments
  add column if not exists currency_code text not null default 'USD',
  add column if not exists tender_amount numeric(14,2),
  add column if not exists exchange_rate_to_usd numeric(20,12) not null default 1,
  add column if not exists payment_account_id uuid references public.accounts(id);
alter table public.repair_job_payments
  add column if not exists currency_code text not null default 'USD',
  add column if not exists tender_amount numeric(14,2),
  add column if not exists exchange_rate_to_usd numeric(20,12) not null default 1,
  add column if not exists payment_account_id uuid references public.accounts(id);
alter table public.quick_sale_payments
  add column if not exists currency_code text not null default 'USD',
  add column if not exists tender_amount numeric(14,2),
  add column if not exists exchange_rate_to_usd numeric(20,12) not null default 1,
  add column if not exists payment_account_id uuid references public.accounts(id);
alter table public.payable_payments
  add column if not exists currency_code text not null default 'USD',
  add column if not exists tender_amount numeric(14,2),
  add column if not exists exchange_rate_to_usd numeric(20,12) not null default 1,
  add column if not exists payment_account_id uuid references public.accounts(id);
alter table public.quotation_deposit_receipts
  add column if not exists currency_code text not null default 'USD',
  add column if not exists tender_amount numeric(14,2),
  add column if not exists exchange_rate_to_usd numeric(20,12) not null default 1,
  add column if not exists payment_account_id uuid references public.accounts(id);

update public.invoice_payments set tender_amount=amount where tender_amount is null;
update public.repair_job_payments set tender_amount=amount where tender_amount is null;
update public.quick_sale_payments set tender_amount=amount where tender_amount is null;
update public.payable_payments set tender_amount=amount where tender_amount is null;
update public.quotation_deposit_receipts set tender_amount=amount where tender_amount is null;

alter table public.invoice_payments alter column tender_amount set not null;
alter table public.repair_job_payments alter column tender_amount set not null;
alter table public.quick_sale_payments alter column tender_amount set not null;
alter table public.payable_payments alter column tender_amount set not null;
alter table public.quotation_deposit_receipts alter column tender_amount set not null;

create or replace function public.normalize_payment_exchange_rate_snapshot()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  -- The Settings rate is ZiG per USD; this column stores USD per one unit of tender currency.
  if new.currency_code='ZiG' and new.exchange_rate_to_usd is not null and new.exchange_rate_to_usd>1 then
    new.exchange_rate_to_usd:=round(1/new.exchange_rate_to_usd,12);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
 foreach t in array array['invoice_payments','repair_job_payments','quick_sale_payments','payable_payments','quotation_deposit_receipts'] loop
  execute format('drop trigger if exists %I on public.%I',t||'_normalize_rate',t);
  execute format('drop trigger if exists %I on public.%I',t||'_normalize_rate_insert',t);
  execute format('create trigger %I before update of currency_code,exchange_rate_to_usd on public.%I for each row execute function public.normalize_payment_exchange_rate_snapshot()',t||'_normalize_rate',t);
  execute format('create trigger %I before insert on public.%I for each row execute function public.normalize_payment_exchange_rate_snapshot()',t||'_normalize_rate_insert',t);
 end loop;
end $$;

create or replace function public.get_manual_usd_zig_rate()
returns numeric language plpgsql stable security definer set search_path=public,pg_temp as $$
declare rate_value numeric;
begin
  select usd_to_zig_bank_rate into rate_value from public.business_settings where id=1;
  if rate_value is null or rate_value<=0 then
    raise exception 'The Super Admin must enter the current bank rate in Settings before ZiG payments can be recorded';
  end if;
  return rate_value;
end $$;

create or replace function public.record_customer_invoice_payment_multicurrency(
  p_invoice_id uuid,p_tender_amount numeric,p_account_id uuid,p_payment_date date,p_currency_code text,p_exchange_rate_to_usd numeric default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare rate_value numeric(20,8); usd_amount numeric(14,2); account_row public.accounts%rowtype; entry_id uuid;
begin
  if p_currency_code not in ('USD','ZiG') then raise exception 'Choose USD or ZiG'; end if;
  if p_tender_amount is null or p_tender_amount<=0 then raise exception 'Enter a positive payment amount'; end if;
  rate_value:=case when p_currency_code='USD' then 1 else coalesce(p_exchange_rate_to_usd,public.get_manual_usd_zig_rate()) end;
  if rate_value<=0 then raise exception 'Invalid exchange rate'; end if;
  select * into account_row from public.accounts where id=p_account_id and is_active and type='asset';
  if not found or account_row.currency_code<>p_currency_code then raise exception 'Choose a cash, bank, EcoCash or POS account in the same currency as this payment'; end if;
  usd_amount:=round(p_tender_amount/rate_value,2);
  entry_id:=public.record_customer_invoice_payment(p_invoice_id,usd_amount,p_account_id,p_payment_date);
  update public.invoice_payments set currency_code=p_currency_code,tender_amount=round(p_tender_amount,2),
    exchange_rate_to_usd=rate_value,payment_account_id=p_account_id
  where journal_entry_id=entry_id;
  return entry_id;
end $$;

create or replace function public.record_supplier_payable_payment_multicurrency(
  p_payable_id uuid,p_tender_amount numeric,p_payment_date date,p_account_id uuid,p_currency_code text,p_exchange_rate_to_usd numeric default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare rate_value numeric(20,8); usd_amount numeric(14,2); account_row public.accounts%rowtype; payment_id uuid;
begin
  if p_currency_code not in ('USD','ZiG') then raise exception 'Choose USD or ZiG'; end if;
  if p_tender_amount is null or p_tender_amount<=0 then raise exception 'Enter a positive payment amount'; end if;
  rate_value:=case when p_currency_code='USD' then 1 else coalesce(p_exchange_rate_to_usd,public.get_manual_usd_zig_rate()) end;
  if rate_value<=0 then raise exception 'Invalid exchange rate'; end if;
  select * into account_row from public.accounts where id=p_account_id and is_active and type='asset';
  if not found or account_row.currency_code<>p_currency_code then raise exception 'Choose a payment account in the same currency as this payment'; end if;
  usd_amount:=round(p_tender_amount/rate_value,2);
  payment_id:=public.record_supplier_payable_payment(p_payable_id,usd_amount,p_payment_date,p_account_id);
  update public.payable_payments set currency_code=p_currency_code,tender_amount=round(p_tender_amount,2),
    exchange_rate_to_usd=rate_value,payment_account_id=p_account_id where id=payment_id;
  return payment_id;
end $$;

create or replace function public.record_quick_sale_payment_multicurrency(
  p_sales_order_id uuid,p_tender_amount numeric,p_payment_method text,p_payment_date date,p_currency_code text,p_exchange_rate_to_usd numeric default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare rate_value numeric(20,8); usd_amount numeric(14,2); channel_value text; account_row public.accounts%rowtype; entry_id uuid;
begin
  if p_currency_code not in ('USD','ZiG') then raise exception 'Choose USD or ZiG'; end if;
  channel_value:=case p_payment_method when 'Cash' then 'cash' when 'EcoCash' then 'ecocash' when 'Bank' then 'bank' when 'Swipe' then 'card' else null end;
  if channel_value is null then raise exception 'Choose a valid payment method'; end if;
  rate_value:=case when p_currency_code='USD' then 1 else coalesce(p_exchange_rate_to_usd,public.get_manual_usd_zig_rate()) end;
  if p_tender_amount is null or p_tender_amount<=0 or rate_value<=0 then raise exception 'Enter a valid payment amount and exchange rate'; end if;
  select * into account_row from public.accounts where currency_code=p_currency_code and payment_channel=channel_value and is_active and type='asset' order by code limit 1;
  if not found then raise exception 'The chart of accounts is missing the selected currency and payment channel'; end if;
  usd_amount:=round(p_tender_amount/rate_value,2);
  entry_id:=public.record_quick_sale_payment(p_sales_order_id,usd_amount,p_payment_method,p_payment_date);
  update public.journal_lines set account_id=account_row.id where journal_entry_id=entry_id and debit>0;
  update public.quick_sale_payments set currency_code=p_currency_code,tender_amount=round(p_tender_amount,2),
    exchange_rate_to_usd=rate_value,payment_account_id=account_row.id where journal_entry_id=entry_id;
  return entry_id;
end $$;

create or replace function public.record_quotation_deposit_multicurrency(
  p_quotation_id uuid,p_tender_amount numeric,p_payment_method text,p_payment_date date,p_reference text,p_idempotency_key uuid,
  p_currency_code text,p_exchange_rate_to_usd numeric default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare rate_value numeric(20,8); usd_amount numeric(14,2); channel_value text; account_row public.accounts%rowtype; result_row jsonb; receipt_id uuid; entry_id uuid;
begin
  if p_currency_code not in ('USD','ZiG') then raise exception 'Choose USD or ZiG'; end if;
  channel_value:=case p_payment_method when 'Cash' then 'cash' when 'EcoCash' then 'ecocash' when 'Bank' then 'bank' when 'Swipe' then 'card' else null end;
  if channel_value is null then raise exception 'Choose a valid payment method'; end if;
  rate_value:=case when p_currency_code='USD' then 1 else coalesce(p_exchange_rate_to_usd,public.get_manual_usd_zig_rate()) end;
  if p_tender_amount is null or p_tender_amount<=0 or rate_value<=0 then raise exception 'Enter a valid deposit amount and exchange rate'; end if;
  select * into account_row from public.accounts where currency_code=p_currency_code and payment_channel=channel_value and is_active and type='asset' order by code limit 1;
  if not found then raise exception 'The chart of accounts is missing the selected currency and payment channel'; end if;
  usd_amount:=round(p_tender_amount/rate_value,2);
  result_row:=public.record_quotation_deposit(p_quotation_id,usd_amount,p_payment_method,p_payment_date,p_reference,p_idempotency_key);
  receipt_id:=(result_row->>'id')::uuid;
  select journal_entry_id into entry_id from public.quotation_deposit_receipts where id=receipt_id;
  update public.journal_lines set account_id=account_row.id where journal_entry_id=entry_id and debit>0;
  update public.quotation_deposit_receipts set currency_code=p_currency_code,tender_amount=round(p_tender_amount,2),
    exchange_rate_to_usd=rate_value,payment_account_id=account_row.id where id=receipt_id;
  return result_row;
end $$;

revoke all on function public.record_customer_invoice_payment_multicurrency(uuid,numeric,uuid,date,text,numeric) from public,anon;
revoke all on function public.record_supplier_payable_payment_multicurrency(uuid,numeric,date,uuid,text,numeric) from public,anon;
revoke all on function public.record_quick_sale_payment_multicurrency(uuid,numeric,text,date,text,numeric) from public,anon;
revoke all on function public.record_quotation_deposit_multicurrency(uuid,numeric,text,date,text,uuid,text,numeric) from public,anon;
grant execute on function public.record_customer_invoice_payment_multicurrency(uuid,numeric,uuid,date,text,numeric) to authenticated;
grant execute on function public.record_supplier_payable_payment_multicurrency(uuid,numeric,date,uuid,text,numeric) to authenticated;
grant execute on function public.record_quick_sale_payment_multicurrency(uuid,numeric,text,date,text,numeric) to authenticated;
grant execute on function public.record_quotation_deposit_multicurrency(uuid,numeric,text,date,text,uuid,text,numeric) to authenticated;
