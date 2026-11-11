-- Voided invoice payments must not remain in the invoice's paid total.
-- Preserve the original payment and reversal journals for audit history.
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef('public.sync_repair_job_invoice(uuid)'::regprocedure);

  if position('where payment.invoice_id = invoice_row.id and payment.voided_at is null' in function_definition) = 0 then
    if position('where payment.invoice_id = invoice_row.id' in function_definition) = 0 then
      raise exception 'Could not find invoice payment calculation in sync_repair_job_invoice';
    end if;

    function_definition := replace(
      function_definition,
      'where payment.invoice_id = invoice_row.id',
      'where payment.invoice_id = invoice_row.id and payment.voided_at is null'
    );

    execute function_definition;
  end if;
end
$$;
