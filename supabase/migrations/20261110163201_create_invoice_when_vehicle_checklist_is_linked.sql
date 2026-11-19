do $migration$
declare
  definition text;
  changed_definition text;
begin
  definition := pg_get_functiondef('public.link_vehicle_condition_checklist(uuid,uuid)'::regprocedure);
  if position('perform public.sync_repair_job_invoice(p_job_id)' in definition) > 0 then
    raise notice 'Checklist linking already synchronizes the job invoice';
    return;
  end if;
  changed_definition := regexp_replace(
    definition,
    'where id = p_job_id;[[:space:]]*end;',
    E'where id = p_job_id;\n\nperform public.sync_repair_job_invoice(p_job_id);\nend;'
  );
  if changed_definition = definition then
    raise exception 'Could not safely locate the end of checklist linking; no change was made';
  end if;
  if position('perform public.sync_repair_job_invoice(p_job_id)' in changed_definition) = 0 then
    raise exception 'Could not add invoice synchronization to checklist linking';
  end if;
  execute changed_definition;
end;
$migration$;