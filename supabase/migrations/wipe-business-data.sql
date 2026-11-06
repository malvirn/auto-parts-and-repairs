begin;

drop function if exists public.wipe_business_data(text);

create or replace function public.wipe_business_data(p_groups text[], p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  profile_row public.profiles%rowtype;
  profile_active boolean;
  group_name text;
  table_name text;
  fk record;
  join_condition text;
  has_dependencies boolean;
  selected_tables text[] := array[]::text[];
  selected_oids oid[] := array[]::oid[];
  business_tables text[] := array[
    'job_parts',
    'repair_job_payments',
    'job_incidentals',
    'credit_note_items',
    'payable_payment_reversals',
    'sales_order_items',
    'quotation_items',
    'purchase_shipment_items',
    'payable_payments',
    'depreciation_entries',
    'payroll_payments',
    'employee_off_days',
    'receipts',
    'credit_notes',
    'invoice_payments',
    'invoices',
    'quotations',
    'sales_orders',
    'restocks',
    'payables',
    'purchase_shipments',
    'commissions',
    'fixed_assets',
    'repair_jobs',
    'vehicles',
    'customers',
    'part_suppliers',
    'parts',
    'suppliers',
    'technicians',
    'payroll_runs',
    'journal_lines',
    'journal_entries'
  ];
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to wipe business data';
  end if;

  select * into profile_row
  from public.profiles
  where id = auth.uid()
  for update;

  if not found
    or (lower(replace(replace(coalesce(profile_row.role, ''), '-', '_'), ' ', '_')) not in ('super_admin', 'superadmin')
      and coalesce(profile_row.access_level, 0) < 2) then
    raise exception 'Only an active super admin can wipe business data';
  end if;

  if exists (
    select 1 from information_schema.columns as profile_columns
    where profile_columns.table_schema = 'public'
      and profile_columns.table_name = 'profiles'
      and profile_columns.column_name = 'is_active'
  ) then
    execute 'select is_active from public.profiles where id = $1'
      into profile_active using auth.uid();
    if profile_active is false then
      raise exception 'Only an active super admin can wipe business data';
    end if;
  end if;

  if p_confirmation is distinct from 'WIPE SELECTED DATA' then
    raise exception 'Type WIPE SELECTED DATA exactly to confirm';
  end if;

  if p_groups is null or cardinality(p_groups) = 0 then
    raise exception 'Select at least one module group';
  end if;

  if exists (
    select 1 from unnest(p_groups) as chosen(group_name)
    where chosen.group_name not in ('customers_jobs', 'parts_stock', 'sales_documents', 'accounting_transactions')
  ) then
    raise exception 'The selection contains an unknown module group';
  end if;

  if cardinality(p_groups) <> (select count(distinct chosen.group_name) from unnest(p_groups) as chosen(group_name)) then
    raise exception 'The selection contains duplicate module groups';
  end if;

  foreach group_name in array p_groups
  loop
    case group_name
      when 'customers_jobs' then
        selected_tables := selected_tables || array[
          'job_parts', 'repair_job_payments', 'job_incidentals', 'repair_jobs', 'vehicles', 'customers'
        ];
      when 'parts_stock' then
        selected_tables := selected_tables || array[
          'purchase_shipment_items', 'restocks', 'part_suppliers', 'parts', 'suppliers', 'purchase_shipments'
        ];
      when 'sales_documents' then
        selected_tables := selected_tables || array[
          'sales_order_items', 'quotation_items', 'credit_note_items', 'invoice_payments',
          'receipts', 'credit_notes', 'invoices', 'quotations', 'sales_orders'
        ];
      when 'accounting_transactions' then
        selected_tables := selected_tables || array[
          'payable_payment_reversals', 'payable_payments', 'depreciation_entries',
          'payroll_payments', 'employee_off_days', 'payables', 'commissions',
          'fixed_assets', 'technicians', 'payroll_runs', 'journal_lines', 'journal_entries'
        ];
    end case;
  end loop;

  foreach table_name in array selected_tables
  loop
    if to_regclass('public.' || table_name) is not null then
      selected_oids := array_append(selected_oids, to_regclass('public.' || table_name));
    end if;
  end loop;

  for fk in
    select constraint_row.conname,
           constraint_row.conrelid,
           constraint_row.confrelid,
           constraint_row.confdeltype,
           constraint_row.conkey,
           constraint_row.confkey,
           child_namespace.nspname as child_schema,
           child_table.relname as child_name,
           parent_namespace.nspname as parent_schema,
           parent_table.relname as parent_name
    from pg_constraint as constraint_row
    join pg_class as child_table on child_table.oid = constraint_row.conrelid
    join pg_namespace as child_namespace on child_namespace.oid = child_table.relnamespace
    join pg_class as parent_table on parent_table.oid = constraint_row.confrelid
    join pg_namespace as parent_namespace on parent_namespace.oid = parent_table.relnamespace
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = any(selected_oids)
      and constraint_row.conrelid <> all(selected_oids)
  loop
    if fk.confdeltype in ('a', 'r', 'c') then
      select string_agg(
        format('c.%I = p.%I', child_attribute.attname, parent_attribute.attname),
        ' AND ' order by child_key.ordinality
      )
      into join_condition
      from unnest(fk.conkey) with ordinality as child_key(attnum, ordinality)
      join unnest(fk.confkey) with ordinality as parent_key(attnum, ordinality)
        using (ordinality)
      join pg_attribute as child_attribute
        on child_attribute.attrelid = fk.conrelid and child_attribute.attnum = child_key.attnum
      join pg_attribute as parent_attribute
        on parent_attribute.attrelid = fk.confrelid and parent_attribute.attnum = parent_key.attnum;

      execute format(
        'select exists (select 1 from %I.%I as c join %I.%I as p on %s)',
        fk.child_schema, fk.child_name, fk.parent_schema, fk.parent_name, join_condition
      ) into has_dependencies;

      if has_dependencies then
        raise exception 'Cannot wipe selected modules: %.% contains records linked to selected data. Select the related module group too, or remove those records first.',
          fk.child_schema, fk.child_name;
      end if;
    end if;
  end loop;

  foreach table_name in array business_tables
  loop
    if table_name = any(selected_tables) and to_regclass('public.' || table_name) is not null then
      execute format('delete from public.%I', table_name);
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'deleted_groups', to_jsonb(p_groups),
    'message', 'Selected business data was wiped. Users, profiles, chart of accounts, and system settings were preserved.'
  );
end;
$$;

revoke all on function public.wipe_business_data(text[], text) from public;
grant execute on function public.wipe_business_data(text[], text) to authenticated;

commit;
