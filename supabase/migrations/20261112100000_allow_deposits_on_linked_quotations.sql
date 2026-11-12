-- Keep quotation deposits open while a quotation is linked to an active repair job.
-- The seven-day expiry still applies to quotations that have not been converted.
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
    $pattern$if quote_row[.]created_at \+ interval '7 days' < now\(\) then$pattern$,
    $replacement$if quote_row.repair_job_id is null and quote_row.created_at + interval '7 days' < now() then$replacement$,
    'g'
  );

  if definition = original_definition
     or position('quote_row.repair_job_id is null and quote_row.created_at + interval' in definition) = 0 then
    raise exception 'Could not safely extend the deposit window for linked quotations';
  end if;

  execute definition;
end;
$$;

commit;
