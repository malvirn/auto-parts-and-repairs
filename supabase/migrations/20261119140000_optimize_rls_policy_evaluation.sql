do $$
declare
  policy_row record;
  using_expression text;
  check_expression text;
  alter_statement text;
begin
  for policy_row in
    select
      ns.nspname as schema_name,
      cls.relname as table_name,
      pol.polname as policy_name,
      pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
      pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expression
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'public'
      and (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ~* 'auth\.[a-z_]+\(\)|current_setting\('
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~* 'auth\.[a-z_]+\(\)|current_setting\('
      )
  loop
    using_expression := policy_row.using_expression;
    check_expression := policy_row.check_expression;

    if using_expression is not null then
      using_expression := regexp_replace(using_expression, 'auth\.([a-z_]+)\(\)', '(select auth.\1())', 'gi');
      using_expression := regexp_replace(using_expression, 'current_setting\(([^)]*)\)', '(select current_setting(\1))', 'gi');
    end if;
    if check_expression is not null then
      check_expression := regexp_replace(check_expression, 'auth\.([a-z_]+)\(\)', '(select auth.\1())', 'gi');
      check_expression := regexp_replace(check_expression, 'current_setting\(([^)]*)\)', '(select current_setting(\1))', 'gi');
    end if;

    alter_statement := format(
      'alter policy %I on %I.%I',
      policy_row.policy_name,
      policy_row.schema_name,
      policy_row.table_name
    );
    if using_expression is not null then
      alter_statement := alter_statement || format(' using (%s)', using_expression);
    end if;
    if check_expression is not null then
      alter_statement := alter_statement || format(' with check (%s)', check_expression);
    end if;
    execute alter_statement;
  end loop;
end;
$$;

-- These two policies are exact duplicates of broader PUBLIC policies. Removing
-- the narrower copies does not change effective access for authenticated users.
drop policy if exists repair_jobs_authenticated_read on public.repair_jobs;
drop policy if exists "Users can read their own profile" on public.profiles;