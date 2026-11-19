-- Store ordinary user-entered free text in lowercase at database write time.
-- The browser input remains untouched. Email addresses, identifiers, controlled
-- statuses, payment methods, vehicle registrations, serials and security tokens
-- are intentionally excluded.

create or replace function public.normalize_user_text_for_storage()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  row_data jsonb;
  field_name text;
  field_value jsonb;
begin
  row_data := to_jsonb(new);

  for field_name, field_value in
    select e.key, e.value
    from jsonb_each(row_data) as e
  loop
    if field_name = any (array[
      'full_name','company_name','business_name','tagline','address',
      'home_address','hours','notes','reason','description','fault_reported',
      'diagnosis','work_done','work_missing','daily_update_note','driver_name',
      'picked_up_by','tested_by','prepared_by','checked_by','contact_person',
      'name','part_name','make','model','intake_condition',
      'accessories_included','collection_notes','memo','note','supplier_name',
      'employee_name','staff_name','job_title','rank','deductions_notes',
      'customer_name','holder_note','void_reason','reversal_reason',
      'work_location','walk_in_name','terms'
    ])
    and jsonb_typeof(field_value) = 'string'
    then
      row_data := jsonb_set(
        row_data,
        array[field_name],
        to_jsonb(pg_catalog.lower(field_value #>> '{}')),
        false
      );
    end if;
  end loop;

  new := jsonb_populate_record(new, row_data);
  return new;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name = c.table_name
     and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.data_type in ('text', 'character varying', 'character')
      and c.column_name = any (array[
        'full_name','company_name','business_name','tagline','address',
        'home_address','hours','notes','reason','description','fault_reported',
        'diagnosis','work_done','work_missing','daily_update_note','driver_name',
        'picked_up_by','tested_by','prepared_by','checked_by','contact_person',
        'name','part_name','make','model','intake_condition',
        'accessories_included','collection_notes','memo','note','supplier_name',
        'employee_name','staff_name','job_title','rank','deductions_notes',
        'customer_name','holder_note','void_reason','reversal_reason',
        'work_location','walk_in_name','terms'
      ])
    group by c.table_schema, c.table_name
  loop
    execute format(
      'drop trigger if exists normalize_user_text_for_storage on %I.%I',
      target.table_schema, target.table_name
    );
    execute format(
      'create trigger normalize_user_text_for_storage
       before insert or update on %I.%I
       for each row execute function public.normalize_user_text_for_storage()',
      target.table_schema, target.table_name
    );
  end loop;
end;
$$;

comment on function public.normalize_user_text_for_storage() is
  'Lowercases selected ordinary free-text input columns at database write time. Email, identifiers and controlled values are excluded.';
