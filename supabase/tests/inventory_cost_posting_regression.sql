-- Read-only regression checks for inventory cost and COGS posting.
-- Run against a configured Supabase database after applying migrations.
-- This file performs assertions only and does not modify business records.

do $$
declare
  pricing_definition text;
  job_inventory_definition text;
begin
  pricing_definition := pg_get_functiondef(
    'public.price_job_card_parts(uuid,jsonb)'::regprocedure
  );

  if position('insert into public.journal_entries' in lower(pricing_definition)) > 0 then
    raise exception 'Pricing an unlisted job part must not create a second purchase/COGS journal entry';
  end if;

  if position('part_id is null' in lower(pricing_definition)) = 0 then
    raise exception 'Job-part pricing must be limited to unlisted parts awaiting receipt';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'job_parts'
      and p.proname = 'post_job_part_inventory_movement'
      and t.tgenabled <> 'D'
  ) then
    raise exception 'Job-part inventory movement trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'quick_sale_order_postings'
      and p.proname = 'post_quick_sale_inventory_cogs'
      and t.tgenabled <> 'D'
  ) then
    raise exception 'Quick Sale COGS trigger is missing or disabled';
  end if;

  job_inventory_definition := pg_get_functiondef(
    'public.write_job_part_inventory_entry(uuid,uuid,numeric,numeric,boolean,date)'::regprocedure
  );
  if position('1200' in job_inventory_definition) = 0
     or position('5000' in job_inventory_definition) = 0 then
    raise exception 'Job-part inventory posting must use Parts Inventory (1200) and Cost of Parts Sold (5000)';
  end if;

  if not exists (
    select 1 from public.accounts
    where code = '1200' and type = 'asset' and is_active
  ) or not exists (
    select 1 from public.accounts
    where code = '5000' and type = 'expense' and is_active
  ) then
    raise exception 'Active inventory and COGS accounts are required';
  end if;

  if exists (
    select 1
    from public.quick_sale_order_postings posting
    join public.sales_order_items item
      on item.sales_order_id = posting.sales_order_id
    where coalesce(item.item_type, 'part') = 'part'
      and (item.cost_price_usd is null or item.cost_price_usd <= 0)
  ) then
    raise exception 'A posted Quick Sale contains a part without a valid cost snapshot';
  end if;

  if exists (
    select 1
    from public.quick_sale_order_postings posting
    where not exists (
      select 1
      from public.journal_lines line
      join public.accounts account on account.id = line.account_id
      where line.journal_entry_id = posting.journal_entry_id
        and account.code = '5000'
        and line.debit > 0
    ) or not exists (
      select 1
      from public.journal_lines line
      join public.accounts account on account.id = line.account_id
      where line.journal_entry_id = posting.journal_entry_id
        and account.code = '1200'
        and line.credit > 0
    )
  ) then
    raise exception 'A posted Quick Sale is missing its COGS or inventory-relief journal lines';
  end if;

  if exists (
    select 1
    from public.journal_entries entry
    where round((
      select coalesce(sum(line.debit), 0)
      from public.journal_lines line
      where line.journal_entry_id = entry.id
    ), 2) <> round((
      select coalesce(sum(line.credit), 0)
      from public.journal_lines line
      where line.journal_entry_id = entry.id
    ), 2)
  ) then
    raise exception 'The general ledger contains an unbalanced journal entry';
  end if;

  if exists (
    select 1 from public.parts where quantity_in_stock < 0
  ) then
    raise exception 'Parts inventory contains a negative stock balance';
  end if;
end;
$$;
