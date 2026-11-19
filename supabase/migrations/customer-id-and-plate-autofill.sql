begin;

alter table public.customers
  add column if not exists customer_code text;

with numbered as (
  select id, 'CUS-' || lpad(row_number() over (order by created_at nulls last, id)::text, 5, '0') as new_code
  from public.customers
  order by created_at nulls last, id
)
update public.customers customer
set customer_code = numbered.new_code
from numbered
where customer.id = numbered.id
  and nullif(btrim(customer.customer_code), '') is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customers_customer_code_key'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_customer_code_key unique (customer_code);
  end if;
end $$;

create or replace function public.generate_customer_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  next_number bigint;
begin
  if nullif(btrim(coalesce(new.customer_code, '')), '') is not null then
    return new;
  end if;
  select coalesce(max((substring(customer_code from '[0-9]+$')::bigint)), 0) + 1
  into next_number
  from public.customers
  where customer_code ~ '^CUS-[0-9]+$';
  new.customer_code := 'CUS-' || lpad(next_number::text, 5, '0');
  return new;
end;
$$;

drop trigger if exists customers_generate_customer_code on public.customers;
create trigger customers_generate_customer_code
before insert on public.customers
for each row execute function public.generate_customer_code();

grant select(customer_code) on public.customers to authenticated;
commit;
