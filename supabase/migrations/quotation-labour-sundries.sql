begin;

alter table public.quotation_items
  add column if not exists item_type text not null default 'part';

alter table public.sales_order_items
  add column if not exists item_type text not null default 'part';

update public.quotation_items
set item_type = case
  when part_id is not null then 'part'
  when part_name ilike 'Labour%' then 'labour'
  when right(lower(rtrim(part_name)), 12) = '(incidental)' then 'sundry'
  else 'other'
end
where item_type = 'part'
  and part_id is null;

update public.sales_order_items
set item_type = case
  when part_id is not null then 'part'
  when part_name ilike 'Labour%' then 'labour'
  when right(lower(rtrim(part_name)), 12) = '(incidental)' then 'sundry'
  else 'other'
end
where item_type = 'part'
  and part_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quotation_items_item_type_check'
      and conrelid = 'public.quotation_items'::regclass
  ) then
    alter table public.quotation_items
      add constraint quotation_items_item_type_check
      check (item_type in ('part', 'labour', 'sundry', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_order_items_item_type_check'
      and conrelid = 'public.sales_order_items'::regclass
  ) then
    alter table public.sales_order_items
      add constraint sales_order_items_item_type_check
      check (item_type in ('part', 'labour', 'sundry', 'other'));
  end if;
end $$;

commit;
