-- Preserve purchase history while allowing parts to be deleted.
-- Historical rows keep the part name even after the inventory record is removed.
begin;

alter table public.restocks
  add column if not exists part_name text;

update public.restocks r
set part_name = p.name
from public.parts p
where r.part_id = p.id
  and r.part_name is null;

alter table public.restocks
  alter column part_id drop not null;

alter table public.restocks
  drop constraint if exists restocks_part_id_fkey;

alter table public.restocks
  add constraint restocks_part_id_fkey
  foreign key (part_id) references public.parts(id) on delete set null;

alter table public.purchase_shipment_items
  add column if not exists part_name text;

update public.purchase_shipment_items i
set part_name = p.name
from public.parts p
where i.part_id = p.id
  and i.part_name is null;

alter table public.purchase_shipment_items
  alter column part_id drop not null;

alter table public.purchase_shipment_items
  drop constraint if exists purchase_shipment_items_part_id_fkey;

alter table public.purchase_shipment_items
  add constraint purchase_shipment_items_part_id_fkey
  foreign key (part_id) references public.parts(id) on delete set null;

-- Add fields used by the Shop part form.
alter table public.parts
  add column if not exists description text,
  add column if not exists category text default 'Other',
  add column if not exists vat_rate numeric(5, 2) default 5;

-- Remove any older VAT/category checks before normalizing existing rows.
do $$
declare
  check_constraint record;
begin
  for check_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.parts'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%vat_rate%'
        or pg_get_constraintdef(oid) ilike '%category%')
  loop
    execute format('alter table public.parts drop constraint %I', check_constraint.conname);
  end loop;
end $$;

update public.parts
set vat_rate = 5
where vat_rate is distinct from 5;

update public.parts
set category = 'Other'
where category is null
   or category not in (
     'Suspension', 'Body Parts', 'Engine Parts', 'Interior',
     'Auto Electrical Parts', 'Air Bags', 'Other'
   );

alter table public.parts
  alter column vat_rate set default 5,
  alter column vat_rate set not null,
  alter column category set default 'Other',
  alter column category set not null;

alter table public.parts
  add constraint parts_vat_rate_check
  check (vat_rate = 5),
  add constraint parts_category_check
  check (category in (
    'Suspension', 'Body Parts', 'Engine Parts', 'Interior',
    'Auto Electrical Parts', 'Air Bags', 'Other'
  ));

commit;