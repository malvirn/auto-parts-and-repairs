alter table public.invoice_payments
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text,
  add column if not exists reversal_journal_entry_id uuid references public.journal_entries(id);

create or replace function public.void_invoice_payment_receipt(
  p_invoice_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  payment_row public.invoice_payments%rowtype;
  invoice_row public.invoices%rowtype;
  reversal_id uuid;
  payment_number text;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only Accounting-level users and Super Admins can void receipts'
      using errcode = '42501';
  end if;
  if p_invoice_payment_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Choose a receipt and enter a reason for voiding it';
  end if;

  select * into payment_row
  from public.invoice_payments
  where id = p_invoice_payment_id
  for update;
  if not found then
    raise exception 'Invoice payment receipt not found';
  end if;
  if payment_row.voided_at is not null then
    raise exception 'This receipt has already been voided';
  end if;

  if exists (
    select 1 from public.customer_overpayment_credits credit
    where credit.invoice_payment_id = payment_row.id
  ) then
    raise exception 'This payment created customer overpayment credit. Resolve that credit note or refund before voiding this receipt.';
  end if;

  select * into invoice_row
  from public.invoices
  where id = payment_row.invoice_id
  for update;
  if not found then
    raise exception 'The invoice linked to this receipt no longer exists';
  end if;

  payment_number := 'PAY-' || upper(substr(payment_row.id::text, 1, 8));

  if payment_row.journal_entry_id is not null then
    if not exists (
      select 1 from public.journal_lines
      where journal_entry_id = payment_row.journal_entry_id
    ) then
      raise exception 'The original payment journal entry has no lines and cannot be safely reversed';
    end if;

    insert into public.journal_entries (
      entry_date, reference, description, source_type, source_id, created_by
    ) values (
      (now() at time zone 'Africa/Harare')::date,
      'REV-' || payment_number,
      'Reversal · Voided invoice payment receipt ' || payment_number,
      'invoice_payment_reversal',
      payment_row.id,
      auth.uid()
    ) returning id into reversal_id;

    insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    select reversal_id, account_id, credit, debit,
      coalesce(memo, 'Reversal of invoice payment receipt ' || payment_number)
    from public.journal_lines
    where journal_entry_id = payment_row.journal_entry_id;
  end if;

  update public.invoice_payments
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = btrim(p_reason),
      reversal_journal_entry_id = reversal_id
  where id = payment_row.id;

  if invoice_row.repair_job_id is not null then
    perform public.sync_repair_job_invoice(invoice_row.repair_job_id);
  else
    update public.invoices
    set amount_paid = least(
          coalesce(total, 0),
          coalesce((
            select sum(payment.amount)
            from public.invoice_payments payment
            where payment.invoice_id = invoice_row.id
              and payment.voided_at is null
          ), 0)
        ),
        status = case
          when least(coalesce(total, 0), coalesce((
            select sum(payment.amount)
            from public.invoice_payments payment
            where payment.invoice_id = invoice_row.id
              and payment.voided_at is null
          ), 0)) >= coalesce(total, 0) - 0.005 then 'paid'
          when coalesce((
            select sum(payment.amount)
            from public.invoice_payments payment
            where payment.invoice_id = invoice_row.id
              and payment.voided_at is null
          ), 0) > 0 then 'partially_paid'
          else 'unpaid'
        end
    where id = invoice_row.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'invoice_payment_id', payment_row.id,
    'reversal_journal_entry_id', reversal_id
  );
end;
$$;

revoke all on function public.void_invoice_payment_receipt(uuid, text) from public, anon;
grant execute on function public.void_invoice_payment_receipt(uuid, text) to authenticated;
