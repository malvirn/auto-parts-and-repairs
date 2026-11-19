do $$
declare
  fn record_row;
  function_source text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef
      and p.proname in (
        'record_customer_invoice_payment_multicurrency',
        'record_quick_sale_payment_multicurrency',
        'record_quotation_deposit_multicurrency',
        'record_supplier_payable_payment_multicurrency',
        'price_unlisted_job_part'
      )
  loop
    function_source := pg_get_functiondef(fn.oid);
    if function_source !~* 'auth\.uid\(\)' then
      function_source := regexp_replace(
        function_source,
        E'\nBEGIN\n',
        E'\nBEGIN\n  IF auth.uid() IS NULL THEN RAISE EXCEPTION ''Authentication is required'' USING ERRCODE = ''42501''; END IF;\n',
        'i'
      );
      execute function_source;
    end if;
  end loop;
end;
$$;

-- Trigger-only helper. It must not be callable as a direct RPC.
revoke all on function public.enqueue_job_part_purchase_request() from public, anon, authenticated;