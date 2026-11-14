-- Keep legacy payment RPCs compatible with required multicurrency tender columns.
-- Older RPCs insert amount but do not know about tender_amount. For those rows,
-- the original amount is the tender amount (USD). Multicurrency RPCs overwrite
-- it with the actual tender and exchange-rate snapshot immediately afterwards.
create or replace function public.normalize_payment_exchange_rate_snapshot()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='INSERT' then
    new.tender_amount:=coalesce(new.tender_amount,new.amount);
  end if;

  -- Settings stores ZiG per USD; payment rows store USD per tender unit.
  if new.currency_code='ZiG'
     and new.exchange_rate_to_usd is not null
     and new.exchange_rate_to_usd>1 then
    new.exchange_rate_to_usd:=round(1/new.exchange_rate_to_usd,12);
  end if;
  return new;
end;
$$;
