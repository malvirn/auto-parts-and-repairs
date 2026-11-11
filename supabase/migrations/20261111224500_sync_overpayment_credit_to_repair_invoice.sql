begin;

-- Include customer overpayment credits applied to a repair job when syncing
-- its linked invoice, so invoice status and customer statements stay aligned.
do $$
declare
  definition text;
  old_fragment text := $old$
    + coalesce((
      select sum(movement.amount)
      from public.customer_credit_movements movement
      where movement.target_type = 'invoice'
        and movement.target_id = invoice_row.id
        and movement.movement_type = 'application'
        and movement.reversed_at is null
    ), 0),
    2
  )) into v_paid_total;
$old$;
  new_fragment text := $new$
    + coalesce((
      select sum(movement.amount)
      from public.customer_credit_movements movement
      where movement.target_type = 'invoice'
        and movement.target_id = invoice_row.id
        and movement.movement_type = 'application'
        and movement.reversed_at is null
    ), 0)
    + coalesce((
      select sum(link.applied_amount)
      from public.customer_overpayment_credit_job_links link
      where link.repair_job_id = job_row.id
    ), 0),
    2
  )) into v_paid_total;
$new$;
begin
  definition := pg_get_functiondef('public.sync_repair_job_invoice(uuid)'::regprocedure);
  if position(old_fragment in definition) = 0 then
    if position('customer_overpayment_credit_job_links' in definition) > 0 then
      raise notice 'Repair invoice sync already includes overpayment credit links';
      return;
    end if;
    raise exception 'Could not locate the expected invoice credit calculation in sync_repair_job_invoice';
  end if;
  execute replace(definition, old_fragment, new_fragment);
end;
$$;

commit;