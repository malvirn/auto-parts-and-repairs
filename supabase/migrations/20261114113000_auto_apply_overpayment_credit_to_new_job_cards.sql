-- Automatically apply carried-forward invoice overpayment credit to matching future job cards.\nbegin;
create or replace function public.link_overpayment_credit_to_job(p_credit_note_id uuid, p_repair_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  note_row public.customer_overpayment_credit_notes%rowtype;
  credit_row public.customer_overpayment_credits%rowtype;
  job_row public.repair_jobs%rowtype;
  customer_row public.customers%rowtype;
  original_invoice public.invoices%rowtype;
  link_row public.customer_overpayment_credit_job_links%rowtype;
  cash_liability public.accounts%rowtype;
  receivable public.accounts%rowtype;
  paid_amount numeric(12,2) := 0;
  previously_applied numeric(12,2) := 0;
  amount_to_apply numeric(12,2) := 0;
  journal_id uuid;
begin
  -- Internal-only function. Execution is revoked from application roles below.

  select * into note_row from public.customer_overpayment_credit_notes where id = p_credit_note_id for update;
  if not found then raise exception 'Credit note not found'; end if;
  select * into credit_row from public.customer_overpayment_credits where id = note_row.overpayment_credit_id for update;
  if not found then raise exception 'Customer credit balance not found'; end if;
  select * into job_row from public.repair_jobs where id = p_repair_job_id for update;
  if not found then raise exception 'Job card not found'; end if;
  select * into customer_row from public.customers where id = job_row.customer_id;
  if not found then raise exception 'The job card customer could not be found'; end if;
  select * into original_invoice from public.invoices where id = note_row.invoice_id;
  if job_row.checklist_number is null then raise exception 'This job card has no checklist number yet'; end if;
  if job_row.customer_id is distinct from note_row.customer_id
    or lower(trim(coalesce(customer_row.full_name,''))) <> lower(trim(coalesce(note_row.customer_name,'')))
    or regexp_replace(coalesce(customer_row.phone,''),'[^0-9]','','g') <> regexp_replace(coalesce(note_row.customer_phone,''),'[^0-9]','','g')
    or lower(trim(coalesce(customer_row.email,''))) <> lower(trim(coalesce(original_invoice.customer_email,''))) then
    raise exception 'Customer details do not match the original credit note';
  end if;

  select * into link_row from public.customer_overpayment_credit_job_links
  where credit_note_id = note_row.id and repair_job_id = job_row.id for update;
  if found then
    if link_row.repair_job_id <> job_row.id then
      raise exception 'This credit note is already linked to another job card';
    end if;
    if link_row.applied_amount > 0 then
      return link_row.id;
    end if;
  else
    insert into public.customer_overpayment_credit_job_links(credit_note_id,repair_job_id,linked_by)
    values(note_row.id,job_row.id,auth.uid())
    on conflict (credit_note_id,repair_job_id) do nothing
    returning * into link_row;
    if not found then
      select * into link_row from public.customer_overpayment_credit_job_links
      where credit_note_id=note_row.id and repair_job_id=job_row.id for update;
    end if;
  end if;

  if coalesce(credit_row.available_amount,0) <= 0.005 then
    raise exception 'This credit note has no remaining balance';
  end if;

  select coalesce(sum(payment.amount),0) into paid_amount
  from public.repair_job_payments payment
  where payment.repair_job_id = job_row.id and payment.voided_at is null;
  paid_amount := paid_amount + coalesce((
    select sum(payment.amount)
    from public.invoices invoice
    join public.invoice_payments payment on payment.invoice_id = invoice.id
    where invoice.repair_job_id = job_row.id
  ),0);
  select coalesce(sum(amount),0) into previously_applied
  from public.customer_credit_movements
  where target_type='repair_job' and target_id=job_row.id
    and movement_type='application' and reversed_at is null;
  previously_applied := previously_applied + coalesce((
    select sum(applied_amount) from public.customer_overpayment_credit_job_links
    where repair_job_id=job_row.id and id<>link_row.id
  ),0);

  amount_to_apply := least(
    round(credit_row.available_amount,2),
    greatest(round(coalesce(job_row.total_cost,0)-coalesce(paid_amount,0)-coalesce(previously_applied,0),2),0)
  );
  if amount_to_apply <= 0.005 then
    raise exception 'This job card has no outstanding balance for this credit note';
  end if;

  select * into cash_liability from public.accounts where code='2300' and is_active and type='liability';
  select * into receivable from public.accounts where code='1100' and is_active and type='asset';
  if cash_liability.id is null or receivable.id is null then
    raise exception 'Customer Credit Liability (2300) or Accounts Receivable (1100) is missing or inactive';
  end if;

  insert into public.journal_entries(entry_date,reference,description,source_type,source_id,created_by)
  values((now() at time zone 'Africa/Harare')::date,
    'OCAPP-'||lpad(note_row.note_number::text,5,'0'),
    'Customer overpayment credit applied to repair job '||coalesce(job_row.cro_number,job_row.job_number::text),
    'customer_overpayment_credit_application',note_row.id,auth.uid())
  returning id into journal_id;
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo)
  values(journal_id,cash_liability.id,amount_to_apply,0,'Release customer credit liability'),
        (journal_id,receivable.id,0,amount_to_apply,'Apply customer credit to repair job');

  update public.customer_overpayment_credits
  set available_amount=round(available_amount-amount_to_apply,2)
  where id=credit_row.id;
  update public.customer_overpayment_credit_job_links
  set applied_amount=amount_to_apply,journal_entry_id=journal_id,linked_by=auth.uid(),linked_at=now()
  where id=link_row.id;
  return link_row.id;
end;
$$;

create or replace function public.auto_apply_customer_overpayment_credit_to_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  note_record record;
begin
  if new.customer_id is null or new.checklist_number is null
     or coalesce(new.total_cost,0) <= 0 then
    return new;
  end if;

  for note_record in
    select note.id
    from public.customer_overpayment_credit_notes note
    join public.customer_overpayment_credits credit
      on credit.id = note.overpayment_credit_id
    join public.invoices original_invoice
      on original_invoice.id = note.invoice_id
    join public.customers customer
      on customer.id = new.customer_id
    where note.customer_id = new.customer_id
      and coalesce(credit.available_amount,0) > 0.005
      and lower(trim(coalesce(customer.full_name,''))) = lower(trim(coalesce(note.customer_name,'')))
      and regexp_replace(coalesce(customer.phone,''),'[^0-9]','','g') =
          regexp_replace(coalesce(note.customer_phone,''),'[^0-9]','','g')
      and lower(trim(coalesce(customer.email,''))) =
          lower(trim(coalesce(original_invoice.customer_email,'')))
    order by note.issued_at asc, note.note_number asc
  loop
    begin
      perform public.link_overpayment_credit_to_job(note_record.id, new.id);
    exception
      when raise_exception then
        if sqlerrm = 'This job card has no outstanding balance for this credit note' then
          exit;
        end if;
        raise;
    end;
  end loop;

  return new;
end;
$$;

revoke all on function public.link_overpayment_credit_to_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.auto_apply_customer_overpayment_credit_to_job() from public, anon, authenticated;

drop trigger if exists trg_auto_apply_customer_overpayment_credit_to_job on public.repair_jobs;
create trigger trg_auto_apply_customer_overpayment_credit_to_job
after insert or update of customer_id, checklist_number, total_cost
on public.repair_jobs
for each row
when (new.customer_id is not null and new.checklist_number is not null and coalesce(new.total_cost,0) > 0)
execute function public.auto_apply_customer_overpayment_credit_to_job();

commit;

do $$
declare
  view_sql text;
  cte_start integer;
  select_start integer;
  replacement_cte text := $cte$
invoice_credit_totals AS (
  SELECT applied.invoice_id, sum(applied.applied_amount) AS applied_amount
  FROM (
    SELECT movement.target_id AS invoice_id, movement.amount AS applied_amount
    FROM public.customer_credit_movements movement
    WHERE movement.movement_type = 'application'
      AND movement.target_type = 'invoice'
      AND movement.reversed_at IS NULL
    UNION ALL
    SELECT invoice.id AS invoice_id, movement.amount AS applied_amount
    FROM public.invoices invoice
    JOIN public.customer_credit_movements movement
      ON movement.target_type = 'repair_job'
     AND movement.target_id = invoice.repair_job_id
    WHERE movement.movement_type = 'application'
      AND movement.reversed_at IS NULL
    UNION ALL
    SELECT invoice.id AS invoice_id, link.applied_amount
    FROM public.invoices invoice
    JOIN public.customer_overpayment_credit_job_links link
      ON link.repair_job_id = invoice.repair_job_id
    WHERE link.applied_amount > 0
  ) applied
  GROUP BY applied.invoice_id
)
$cte$;
begin
  view_sql := pg_get_viewdef('public.customer_account_statement'::regclass, true);
  cte_start := strpos(view_sql, 'invoice_credit_totals AS (');
  if cte_start = 0 then
    raise exception 'Could not safely locate invoice credit totals in customer_account_statement';
  end if;
  select_start := cte_start + position('SELECT c.id AS customer_id' in substring(view_sql from cte_start)) - 1;
  if select_start < cte_start then
    raise exception 'Could not safely locate customer statement SELECT';
  end if;
  view_sql := left(view_sql, cte_start - 1)
    || replacement_cte || E'\n'
    || substring(view_sql from select_start);
  execute 'create or replace view public.customer_account_statement with (security_invoker = true) as ' || view_sql;
end;
$$;
