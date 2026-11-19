alter table public.customer_overpayment_credit_refunds
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text,
  add column if not exists reversal_journal_entry_id uuid references public.journal_entries(id);

create or replace function public.void_customer_credit_refund_receipt(
  p_refund_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  refund_row public.customer_overpayment_credit_refunds%rowtype;
  credit_row public.customer_overpayment_credits%rowtype;
  note_row public.customer_overpayment_credit_notes%rowtype;
  reversal_id uuid;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only Accounting-level users and Super Admins can void refund receipts'
      using errcode = '42501';
  end if;
  if p_refund_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Choose a refund receipt and enter a reason for voiding it';
  end if;

  select * into refund_row
  from public.customer_overpayment_credit_refunds
  where id = p_refund_id
  for update;
  if not found then
    raise exception 'Customer refund receipt not found';
  end if;
  if refund_row.voided_at is not null then
    raise exception 'This refund receipt has already been voided';
  end if;

  select * into credit_row
  from public.customer_overpayment_credits
  where id = refund_row.overpayment_credit_id
  for update;
  if not found then
    raise exception 'The original customer credit balance no longer exists';
  end if;

  select * into note_row
  from public.customer_overpayment_credit_notes
  where id = refund_row.credit_note_id
  for update;
  if not found then
    raise exception 'The original customer credit note no longer exists';
  end if;

  if coalesce(credit_row.available_amount, 0) + refund_row.amount > credit_row.amount + 0.005 then
    raise exception 'This credit has since been used. Reverse the later credit application before voiding this refund.';
  end if;

  if refund_row.journal_entry_id is not null then
    if not exists (
      select 1 from public.journal_lines
      where journal_entry_id = refund_row.journal_entry_id
    ) then
      raise exception 'The original refund journal entry has no lines and cannot be safely reversed';
    end if;

    insert into public.journal_entries (
      entry_date, reference, description, source_type, source_id, created_by
    ) values (
      (now() at time zone 'Africa/Harare')::date,
      'REV-CN-' || lpad(note_row.note_number::text, 5, '0') || '-' || substr(refund_row.id::text, 1, 8),
      'Reversal · Voided customer credit refund CN-' || lpad(note_row.note_number::text, 5, '0'),
      'customer_credit_refund_reversal',
      refund_row.id,
      auth.uid()
    ) returning id into reversal_id;

    insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    select reversal_id, account_id, credit, debit,
      coalesce(memo, 'Reversal of customer credit refund receipt')
    from public.journal_lines
    where journal_entry_id = refund_row.journal_entry_id;
  end if;

  update public.customer_overpayment_credits
  set available_amount = round(available_amount + refund_row.amount, 2)
  where id = credit_row.id;

  update public.customer_overpayment_credit_refunds
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = btrim(p_reason),
      reversal_journal_entry_id = reversal_id
  where id = refund_row.id;

  return jsonb_build_object(
    'success', true,
    'refund_id', refund_row.id,
    'reversal_journal_entry_id', reversal_id,
    'restored_credit', refund_row.amount
  );
end;
$$;

revoke all on function public.void_customer_credit_refund_receipt(uuid, text) from public, anon;
grant execute on function public.void_customer_credit_refund_receipt(uuid, text) to authenticated;
