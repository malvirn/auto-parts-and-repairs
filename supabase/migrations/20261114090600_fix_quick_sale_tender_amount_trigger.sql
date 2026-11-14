-- Keep legacy Quick Sale payment writers compatible with the required tender amount.
-- The USD ledger amount is the tender amount for legacy USD-only Quick Sales.
create or replace function public.ensure_quick_sale_tender_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tender_amount is null then
    new.tender_amount := new.amount;
  end if;

  if new.currency_code is null or btrim(new.currency_code) = '' then
    new.currency_code := 'USD';
  end if;

  if new.exchange_rate_to_usd is null then
    new.exchange_rate_to_usd := 1;
  end if;

  return new;
end;
$$;

drop trigger if exists quick_sale_payments_ensure_tender_amount
  on public.quick_sale_payments;

create trigger quick_sale_payments_ensure_tender_amount
before insert or update on public.quick_sale_payments
for each row
execute function public.ensure_quick_sale_tender_amount();
