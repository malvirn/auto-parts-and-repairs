do $$
declare
  fk_record record;
  column_list text;
  table_name text;
  index_name text;
begin
  for fk_record in
    with foreign_keys as (
      select distinct con.conrelid, con.conkey
      from pg_constraint con
      join pg_namespace ns on ns.oid = con.connamespace
      where con.contype = 'f'
        and ns.nspname = 'public'
    )
    select f.conrelid, f.conkey
    from foreign_keys f
    where not exists (
      select 1
      from pg_index i
      where i.indrelid = f.conrelid
        and i.indisvalid
        and i.indpred is null
        and i.indnkeyatts >= cardinality(f.conkey)
        and (
          select array_agg(ix.attnum::smallint order by ix.ord)
          from unnest(i.indkey) with ordinality ix(attnum, ord)
          where ix.ord <= cardinality(f.conkey)
        ) = f.conkey
    )
  loop
    select string_agg(format('%I', a.attname), ', ' order by key_column.ord)
    into column_list
    from unnest(fk_record.conkey) with ordinality key_column(attnum, ord)
    join pg_attribute a
      on a.attrelid = fk_record.conrelid
     and a.attnum = key_column.attnum;

    select format('%I.%I', ns.nspname, cls.relname)
    into table_name
    from pg_class cls
    join pg_namespace ns on ns.oid = cls.relnamespace
    where cls.oid = fk_record.conrelid;

    index_name := 'idx_fk_' || substr(md5(fk_record.conrelid::text || ':' || array_to_string(fk_record.conkey, ',')), 1, 20);

    execute format('create index if not exists %I on %s (%s)', index_name, table_name, column_list);
  end loop;
end;
$$;