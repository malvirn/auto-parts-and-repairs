-- Keep invoice balances consistent with the existing sync_repair_job_invoice trigger.
-- That trigger writes payment + customer-credit movements into invoices.amount_paid.
do $$
declare
  view_sql text;
  old_amount text := '(GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric)) + COALESCE(credits.applied_amount, 0::numeric))::numeric(12,2) AS amount_paid,';
  new_amount text := 'GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric) + COALESCE(credits.applied_amount, 0::numeric))::numeric(12,2) AS amount_paid,';
  old_balance text := '(COALESCE(invoice.total, 0::numeric) - GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric)) - COALESCE(credits.applied_amount, 0::numeric))::numeric(12,2) AS balance_due,';
  new_balance text := '(COALESCE(invoice.total, 0::numeric) - GREATEST(COALESCE(invoice.amount_paid, 0::numeric), COALESCE(payments.paid_amount, 0::numeric) + COALESCE(credits.applied_amount, 0::numeric)))::numeric(12,2) AS balance_due,';
begin
  select pg_get_viewdef('public.customer_account_statement'::regclass,true) into view_sql;
  if position(old_amount in view_sql)=0 or position(old_balance in view_sql)=0 then
    raise exception 'The customer_account_statement invoice expressions changed; review before applying voucher balance fix';
  end if;
  view_sql:=replace(view_sql,old_amount,new_amount);
  view_sql:=replace(view_sql,old_balance,new_balance);
  execute 'create or replace view public.customer_account_statement as '||view_sql;
end $$;
