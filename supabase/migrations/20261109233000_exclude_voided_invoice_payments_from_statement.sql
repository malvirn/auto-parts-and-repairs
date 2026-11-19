do $$
declare
  view_sql text;
begin
  select pg_get_viewdef('public.customer_account_statement'::regclass, true)
    into view_sql;
  if view_sql is null then
    raise exception 'customer_account_statement view was not found';
  end if;
  view_sql := regexp_replace(
    view_sql,
    'FROM invoice_payments[[:space:]]+GROUP BY invoice_id',
    'FROM invoice_payments WHERE voided_at IS NULL GROUP BY invoice_id',
    'i'
  );
  if view_sql not like '%voided_at IS NULL%' then
    raise exception 'Could not safely add the voided-payment filter to customer_account_statement';
  end if;
  execute 'create or replace view public.customer_account_statement with (security_invoker = true) as ' || view_sql;
end;
$$;