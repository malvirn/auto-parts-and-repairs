begin;

-- Keep invoice line items pre-VAT and apply VAT once, on eligible parts only.
create or replace function public.sync_repair_job_invoice(p_repair_job_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.repair_jobs%rowtype;
  invoice_row public.invoices%rowtype;
  part_row record;
  extra_row record;
  v_invoice_items jsonb := '[]'::jsonb;
  v_item_subtotal numeric(12, 2) := 0;
  v_subtotal numeric(12, 2);
  v_parts_subtotal numeric(12, 2) := 0;
  v_vat_rate numeric(5, 2);
  v_discount numeric(12, 2);
  v_invoice_total numeric(12, 2);
  v_paid_total numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in to synchronize a repair-job invoice'
      using errcode = '42501';
  end if;
  if p_repair_job_id is null then
    raise exception 'Choose a repair job';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_repair_job_id
  for update;
  if not found then
    raise exception 'Repair job not found';
  end if;

  select * into invoice_row
  from public.invoices
  where repair_job_id = job_row.id
  for update;
  if not found then
    return;
  end if;

  for part_row in
    select job_part.part_name, job_part.quantity, job_part.price_at_time, part.description
    from public.job_parts job_part
    left join public.parts part on part.id = job_part.part_id
    where job_part.job_id = job_row.id
    order by job_part.id
  loop
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(part_row.description), ''), nullif(btrim(part_row.part_name), ''), 'Part'),
      'q', part_row.quantity,
      'p', coalesce(part_row.price_at_time, 0)
    ));
    v_item_subtotal := v_item_subtotal + part_row.quantity * coalesce(part_row.price_at_time, 0);
    v_parts_subtotal := v_parts_subtotal + part_row.quantity * coalesce(part_row.price_at_time, 0);
  end loop;

  if coalesce(job_row.labour_cost, 0) > 0 then
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(job_row.job_description), ''), 'Labour'),
      'q', 1,
      'p', job_row.labour_cost
    ));
    v_item_subtotal := v_item_subtotal + job_row.labour_cost;
  end if;

  for extra_row in
    select description, amount
    from public.job_incidentals
    where job_id = job_row.id
    order by created_at, id
  loop
    v_invoice_items := v_invoice_items || jsonb_build_array(jsonb_build_object(
      'd', coalesce(nullif(btrim(extra_row.description), ''), 'Additional job cost'),
      'q', 1,
      'p', extra_row.amount
    ));
    v_item_subtotal := v_item_subtotal + extra_row.amount;
  end loop;

  v_item_subtotal := round(v_item_subtotal, 2);
  v_parts_subtotal := round(v_parts_subtotal, 2);
  -- Job total_cost already includes VAT. Invoice line items remain pre-VAT;
  -- calculate the invoice VAT once from the parts subtotal below.
  v_subtotal := v_item_subtotal;
  if v_subtotal <= 0 then
    raise exception 'A linked invoice requires a positive repair-job subtotal';
  end if;

  v_discount := coalesce(invoice_row.discount, 0);
  v_vat_rate := coalesce(invoice_row.vat_rate, 0);
  if v_discount < 0 or v_discount >= v_subtotal or v_vat_rate < 0 or v_vat_rate > 100
    or v_parts_subtotal < 0 or v_parts_subtotal > v_subtotal then
    raise exception 'The repair-job total is incompatible with the linked invoice discount or VAT values';
  end if;

  v_invoice_total := round(
    v_subtotal - v_discount + greatest(0, v_parts_subtotal - v_discount) * v_vat_rate / 100,
    2
  );
  select least(v_invoice_total, round(
    coalesce((
      select sum(payment.amount)
      from public.repair_job_payments payment
      where payment.repair_job_id = job_row.id
        and payment.voided_at is null
    ), 0)
    + coalesce((
      select sum(payment.amount)
      from public.invoice_payments payment
      where payment.invoice_id = invoice_row.id
    ), 0),
    2
  )) into v_paid_total;

  update public.invoices
  set items = v_invoice_items,
      subtotal = v_subtotal,
      vat_base = v_parts_subtotal,
      vat_rate = v_vat_rate,
      total = v_invoice_total,
      amount_paid = v_paid_total,
      status = case
        when v_paid_total >= v_invoice_total - 0.005 then 'paid'
        when v_paid_total > 0 then 'partially_paid'
        else 'unpaid'
      end
  where id = invoice_row.id;
end;
$$;

revoke all on function public.sync_repair_job_invoice(uuid) from public, anon;
grant execute on function public.sync_repair_job_invoice(uuid) to authenticated;

commit;
