-- Keep repair invoices in step with quotation-credit applications and reversals.
CREATE OR REPLACE FUNCTION public.sync_repair_job_invoice(p_repair_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  customer_row public.customers%rowtype;
  invoice_exists boolean := false;
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
  invoice_exists := found;

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

  if invoice_exists then
    v_discount := coalesce(invoice_row.discount, 0);
    v_vat_rate := coalesce(invoice_row.vat_rate, 0);
  else
    v_discount := 0;
    v_vat_rate := coalesce(job_row.vat_rate, 0);
  end if;
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
    ), 0)
    + coalesce((
      select sum(movement.amount)
      from public.customer_credit_movements movement
      where movement.target_type = 'repair_job'
        and movement.target_id = job_row.id
        and movement.movement_type = 'application'
        and movement.reversed_at is null
    ), 0)
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

  if invoice_exists then
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
  else
    select * into customer_row
    from public.customers
    where id = job_row.customer_id;
    if not found then
      raise exception 'The job card customer could not be loaded for invoice creation';
    end if;

    insert into public.invoices (
      repair_job_id, customer_id, customer_name, customer_phone, customer_email,
      reference, items, discount, vat_rate, subtotal, total, notes, due_date,
      status, amount_paid, vat_base
    ) values (
      job_row.id, job_row.customer_id, customer_row.full_name, customer_row.phone, customer_row.email,
      coalesce(nullif(btrim(job_row.cro_number), ''), 'JC-' || lpad(job_row.job_number::text, 5, '0')),
      v_invoice_items, v_discount, v_vat_rate, v_subtotal, v_invoice_total,
      'Automatically created when the vehicle checklist was confirmed',
      current_date + 7,
      case
        when v_paid_total >= v_invoice_total - 0.005 then 'paid'
        when v_paid_total > 0 then 'partially_paid'
        else 'unpaid'
      end,
      v_paid_total, v_parts_subtotal
    )
    returning * into invoice_row;
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_repair_job_invoice_paid_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  affected_job_id uuid;
  affected_job_ids uuid[];
begin
  if tg_op = 'INSERT' then
    affected_job_ids := array[new.repair_job_id];
  elsif tg_op = 'DELETE' then
    affected_job_ids := array[old.repair_job_id];
  else
    affected_job_ids := array[old.repair_job_id, new.repair_job_id];
  end if;

  foreach affected_job_id in array affected_job_ids
  loop
    if affected_job_id is not null then
      with payment_totals as (
        select invoice.id,
          invoice.total,
          least(invoice.total, round(
            coalesce((
              select sum(payment.amount)
              from public.repair_job_payments payment
              where payment.repair_job_id = affected_job_id
                and payment.voided_at is null
            ), 0)
            + coalesce((
              select sum(payment.amount)
              from public.invoice_payments payment
              where payment.invoice_id = invoice.id
            ), 0)
            + coalesce((
              select sum(movement.amount)
              from public.customer_credit_movements movement
              where movement.target_type = 'repair_job'
                and movement.target_id = affected_job_id
                and movement.movement_type = 'application'
                and movement.reversed_at is null
            ), 0)
            + coalesce((
              select sum(movement.amount)
              from public.customer_credit_movements movement
              where movement.target_type = 'invoice'
                and movement.target_id = invoice.id
                and movement.movement_type = 'application'
                and movement.reversed_at is null
            ), 0),
            2
          )) as amount_paid
        from public.invoices invoice
        where invoice.repair_job_id = affected_job_id
      )
      update public.invoices invoice
      set amount_paid = payment_totals.amount_paid,
          status = case
            when payment_totals.amount_paid >= payment_totals.total - 0.005 then 'paid'
            when payment_totals.amount_paid > 0 then 'partially_paid'
            else 'unpaid'
          end
      from payment_totals
      where invoice.id = payment_totals.id;
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$
;
create or replace function public.sync_repair_invoice_after_customer_credit_movement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  affected_job_id uuid;
  affected_invoice_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.target_type = 'repair_job' then
      affected_job_id := old.target_id;
    elsif old.target_type = 'invoice' then
      affected_invoice_id := old.target_id;
    end if;
  else
    if new.target_type = 'repair_job' then
      affected_job_id := new.target_id;
    elsif new.target_type = 'invoice' then
      affected_invoice_id := new.target_id;
    end if;
  end if;

  if affected_job_id is null and affected_invoice_id is not null then
    select repair_job_id into affected_job_id
    from public.invoices
    where id = affected_invoice_id;
  end if;

  if affected_job_id is not null
    and auth.uid() is not null
    and exists (select 1 from public.invoices where repair_job_id = affected_job_id) then
    perform public.sync_repair_job_invoice(affected_job_id);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists sync_repair_invoice_after_customer_credit_movement on public.customer_credit_movements;
create trigger sync_repair_invoice_after_customer_credit_movement
  after insert or update of amount, target_type, target_id, reversed_at or delete
  on public.customer_credit_movements
  for each row execute function public.sync_repair_invoice_after_customer_credit_movement();

revoke all on function public.sync_repair_invoice_after_customer_credit_movement() from public, anon;
grant execute on function public.sync_repair_invoice_after_customer_credit_movement() to authenticated;
