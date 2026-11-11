-- Regression checks for customer credit confirmation and audit security.
-- Run after customer_id_company_credit_security.sql and the credit-security
-- migrations have been applied. This file is read-only and rolls back.

do $$
declare
  record_definition text;
begin
  if not has_function_privilege(
    'authenticated',
    'public.apply_customer_credit_verified(uuid,numeric,text,uuid,text,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated users must be able to execute verified credit application';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.redeem_credit_voucher_verified(text,numeric,text,uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated users must be able to execute verified voucher redemption';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.apply_quotation_deposits_to_repair_job_verified(uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated users must be able to execute verified quotation-deposit application';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.apply_customer_credit(uuid,numeric,text,uuid,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Legacy apply_customer_credit must not be directly executable by authenticated users';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.redeem_credit_voucher(text,numeric,text,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Legacy redeem_credit_voucher must not be directly executable by authenticated users';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.apply_quotation_deposits_to_repair_job(uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Legacy quotation-deposit helper must not be directly executable by authenticated users';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'customer_credit_redemption_audit'
      and c.relrowsecurity
  ) then
    raise exception 'Customer credit redemption audit must have RLS enabled';
  end if;

  if has_table_privilege('authenticated', 'public.customer_credit_redemption_audit', 'INSERT')
     or has_table_privilege('authenticated', 'public.customer_credit_redemption_audit', 'UPDATE')
     or has_table_privilege('authenticated', 'public.customer_credit_redemption_audit', 'DELETE') then
    raise exception 'Authenticated users must not be able to mutate redemption audit rows directly';
  end if;

  record_definition := pg_get_functiondef(
    'public.record_quotation_deposit(uuid,numeric,text,date,text,uuid)'::regprocedure
  );
  if position('public.apply_quotation_deposits_to_repair_job(' in record_definition) > 0 then
    raise exception 'Recording a quotation deposit must not bypass customer confirmation by auto-applying credit';
  end if;
end;
$$;
