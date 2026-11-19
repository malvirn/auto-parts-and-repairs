begin;

create or replace function public.is_current_user_super_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and (
        lower(replace(replace(coalesce(p.role, ''), '-', '_'), ' ', '_')) in ('super_admin', 'superadmin')
        or coalesce(p.access_level, 0) >= 2
      )
      and coalesce((to_jsonb(p) ->> 'is_active')::boolean, true)
  );
$$;

revoke all on function public.is_current_user_super_admin() from public, anon;
grant execute on function public.is_current_user_super_admin() to authenticated;

create or replace function public.enforce_super_admin_deletes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_current_user_super_admin() then
    raise exception 'Only a Super Admin can permanently delete business records'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.enforce_super_admin_deletes() from public, anon, authenticated;

do $$
declare
  target record;
begin
  for target in
    select table_row.relname
    from pg_class as table_row
    join pg_namespace as namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relkind in ('r', 'p')
      and not table_row.relispartition
      and table_row.relname not in (
        'profiles',
        'webauthn_challenges'
      )
  loop
    execute format('drop trigger if exists require_super_admin_for_delete on public.%I', target.relname);
    execute format(
      'create trigger require_super_admin_for_delete before delete on public.%I for each row execute function public.enforce_super_admin_deletes()',
      target.relname
    );
  end loop;
end;
$$;

create or replace function public.admin_delete_business_document(p_table text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected integer;
  deleted_journal_entries integer := 0;
begin
  if auth.uid() is null or not public.is_current_user_super_admin() then
    raise exception 'Only a Super Admin can delete business documents'
      using errcode = '42501';
  end if;

  if p_id is null or p_table is null or p_table not in ('receipts', 'invoices', 'quotations', 'sales_orders') then
    raise exception 'Choose a supported business document and a valid record';
  end if;

  if p_table = 'invoices' then
    delete from public.journal_entries
    where id in (
      select payment.journal_entry_id
      from public.invoice_payments as payment
      where payment.invoice_id = p_id
        and payment.journal_entry_id is not null
    );
    get diagnostics deleted_journal_entries = row_count;
  elsif p_table = 'sales_orders' then
    delete from public.receipts where sales_order_id = p_id;
  end if;

  execute format('delete from public.%I where id = $1', p_table) using p_id;
  get diagnostics affected = row_count;

  if affected = 0 then
    raise exception 'The selected document no longer exists';
  end if;

  return jsonb_build_object(
    'success', true,
    'table', p_table,
    'deleted_id', p_id,
    'deleted_journal_entries', deleted_journal_entries
  );
end;
$$;

revoke all on function public.admin_delete_business_document(text, uuid) from public, anon;
grant execute on function public.admin_delete_business_document(text, uuid) to authenticated;

commit;
