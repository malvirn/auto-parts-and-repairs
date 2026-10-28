begin;

alter table public.parts
  add column if not exists description text,
  add column if not exists category text default 'Other',
  add column if not exists vat_rate numeric(5, 2) default 5;

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
