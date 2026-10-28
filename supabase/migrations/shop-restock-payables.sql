begin;

alter table public.suppliers
  add column if not exists payment_terms_days integer not null default 30
  check (payment_terms_days >= 0);

alter table public.restocks
  add column if not exists invoice_number text,
  add column if not exists payment_status text not null default 'paid',
  add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null;

alter table public.restocks
  drop constraint if exists restocks_payment_status_check;

alter table public.restocks
  add constraint restocks_payment_status_check
  check (payment_status in ('paid', 'on_credit'));

create unique index if not exists restocks_invoice_number_uidx
  on public.restocks (invoice_number)
  where invoice_number is not null;

do $$
declare
  restock_id_type text;
  payable_restock_id_type text;
  has_restock_foreign_key boolean;
  has_linked_rows boolean;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
  into restock_id_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.restocks'::regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  if restock_id_type is null then
    raise exception 'Could not determine the type of public.restocks.id';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
  into payable_restock_id_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.payables'::regclass
    and attribute.attname = 'restock_id'
    and not attribute.attisdropped;

  if payable_restock_id_type is null then
    execute format(
      'alter table public.payables add column restock_id %s',
      restock_id_type
    );
  elsif payable_restock_id_type <> restock_id_type then
    execute 'select exists (select 1 from public.payables where restock_id is not null)'
      into has_linked_rows;
    if has_linked_rows then
      raise exception 'public.payables.restock_id contains values and does not match public.restocks.id type (%)', restock_id_type;
    end if;
    execute format(
      'alter table public.payables alter column restock_id type %s using null::%s',
      restock_id_type,
      restock_id_type
    );
  end if;

  select exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payables'::regclass
      and conname = 'payables_restock_id_fkey'
  )
  into has_restock_foreign_key;

  if not has_restock_foreign_key then
    alter table public.payables
      add constraint payables_restock_id_fkey
      foreign key (restock_id) references public.restocks(id) on delete set null;
  end if;
end $$;

create unique index if not exists payables_restock_id_uidx
  on public.payables (restock_id)
  where restock_id is not null;

commit;