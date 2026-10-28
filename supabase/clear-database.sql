-- DESTRUCTIVE: clears every table in the public schema and restarts identity
-- sequences. It does not target auth.users or tables outside public.
-- Review your public tables before running this in the Supabase SQL Editor.
-- This script is intentionally not run by the application.

do $$
declare
  public_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename)
    into public_tables
  from pg_tables
  where schemaname = 'public';

  if public_tables is not null then
    raise notice 'Truncating public tables only: %', public_tables;
    execute 'truncate table ' || public_tables || ' restart identity';
  else
    raise notice 'No public tables found; nothing was cleared.';
  end if;
end
$$;
