-- Stop quotation-deposit recording from silently applying customer credit.
-- Deposits remain available in the credit wallet until staff use the verified
-- apply_quotation_deposits_to_repair_job_verified RPC with customer confirmation.
begin;

do $$
declare
  definition text;
  original_definition text;
begin
  if to_regprocedure('public.record_quotation_deposit(uuid,numeric,text,date,text,uuid)') is null then
    raise exception 'record_quotation_deposit(uuid,numeric,text,date,text,uuid) was not found';
  end if;

  definition := pg_get_functiondef(
    'public.record_quotation_deposit(uuid,numeric,text,date,text,uuid)'::regprocedure
  );
  original_definition := definition;

  definition := regexp_replace(
    definition,
    'application_result := public[.]apply_quotation_deposits_to_repair_job\(p_quotation_id, quote_row[.]repair_job_id\);',
    'application_result := jsonb_build_object(''applied_amount'', 0);',
    'g'
  );

  if definition = original_definition
     or position('public.apply_quotation_deposits_to_repair_job(' in definition) > 0 then
    raise exception 'Could not safely remove automatic credit application from record_quotation_deposit';
  end if;

  execute definition;
end;
$$;

-- The legacy helper is an internal implementation detail. The verified wrapper
-- remains the authenticated entry point and invokes this helper as its owner.
revoke all on function public.apply_quotation_deposits_to_repair_job(uuid,uuid)
  from public, anon, authenticated;

commit;
