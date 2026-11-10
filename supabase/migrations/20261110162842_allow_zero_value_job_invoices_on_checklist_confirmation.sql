do $migration$
declare
  definition text;
  old_guard text := E'  if v_subtotal <= 0 then\n    raise exception ''A linked invoice requires a positive repair-job subtotal'';\n  end if;';
  old_validation text := 'if v_discount < 0 or v_discount >= v_subtotal or';
  new_validation text := 'if v_subtotal <= 0 then v_discount := 0; end if; if v_discount < 0 or (v_subtotal > 0 and v_discount >= v_subtotal) or';
begin
  definition := pg_get_functiondef('public.sync_repair_job_invoice(uuid)'::regprocedure);
  if position(old_guard in definition) = 0 then
    raise exception 'Expected positive-subtotal guard was not found; no function change was made';
  end if;
  if position(old_validation in definition) = 0 then
    raise exception 'Expected invoice discount validation was not found; no function change was made';
  end if;
  definition := replace(definition, old_guard,
    '  -- A confirmed checklist always receives an invoice, including a zero-value invoice when pricing is not yet available.');
  definition := replace(definition, old_validation, new_validation);
  if position(new_validation in definition) = 0 then
    raise exception 'Could not safely update zero-value invoice validation';
  end if;
  execute definition;
end;
$migration$;