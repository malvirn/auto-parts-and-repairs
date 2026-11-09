create or replace function public.record_customer_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_payment_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  invoice_row public.invoices%rowtype;
  cash_account public.accounts%rowtype;
  receivable_account public.accounts%rowtype;
  customer_credit_account public.accounts%rowtype;
  entry_id uuid;
  payment_id uuid;
  amount_applied numeric(12,2);
  overpayment numeric(12,2);
  new_amount_paid numeric(12,2);
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can record invoice payments';
  end if;
  if p_amount is null or p_amount <= 0 or p_payment_date is null then
    raise exception 'Enter a positive payment amount and payment date';
  end if;

  select * into invoice_row from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Customer invoice not found'; end if;

  select * into cash_account from public.accounts
  where id = p_account_id and is_active = true and type = 'asset' and code like '10%';
  if not found then raise exception 'Choose an active cash or bank account'; end if;

  select * into receivable_account from public.accounts where code = '1100' and is_active = true;
  if not found then raise exception 'Accounts Receivable (account code 1100) is missing or inactive'; end if;

  select * into customer_credit_account from public.accounts
  where code = '2300' and is_active = true and type = 'liability';
  if not found then raise exception 'Customer credit liability (account code 2300) is missing or inactive'; end if;

  amount_applied := least(round(p_amount, 2), greatest(round(coalesce(invoice_row.total, 0) - coalesce(invoice_row.amount_paid, 0), 2), 0));
  overpayment := greatest(round(p_amount, 2) - amount_applied, 0);
  new_amount_paid := round(coalesce(invoice_row.amount_paid, 0) + amount_applied, 2);

  insert into public.journal_entries (entry_date, reference, description, source_type, source_id)
  values (
    p_payment_date,
    'INV-' || lpad(invoice_row.invoice_number::text, 5, '0'),
    'Customer invoice payment — ' || invoice_row.customer_name,
    'customer_invoice_payment',
    invoice_row.id
  ) returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
  values (entry_id, cash_account.id, round(p_amount, 2), 0, 'Cash received');

  if amount_applied > 0.005 then
    insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    values (entry_id, receivable_account.id, 0, amount_applied, 'Amount applied to invoice');
  end if;
  if overpayment > 0.005 then
    insert into public.journal_lines (journal_entry_id, account_id, debit, credit, memo)
    values (entry_id, customer_credit_account.id, 0, overpayment, 'Customer overpayment held as credit');
  end if;

  insert into public.invoice_payments (invoice_id, amount, payment_date, payment_method, journal_entry_id, created_by)
  values (invoice_row.id, round(p_amount, 2), p_payment_date, cash_account.name, entry_id, auth.uid())
  returning id into payment_id;

  if overpayment > 0.005 then
    insert into public.customer_overpayment_credits (
      invoice_payment_id, invoice_id, customer_id, customer_name, customer_phone,
      amount, available_amount, payment_date, journal_entry_id, created_by
    ) values (
      payment_id, invoice_row.id, invoice_row.customer_id, invoice_row.customer_name,
      invoice_row.customer_phone, overpayment, overpayment, p_payment_date, entry_id, auth.uid()
    );
  end if;

  update public.invoices
  set amount_paid = new_amount_paid,
      status = case when new_amount_paid >= total - 0.005 then 'paid' else 'partially_paid' end
  where id = invoice_row.id;

  return entry_id;
end;
$function$;

revoke all on function public.record_customer_invoice_payment(uuid, numeric, uuid, date) from public, anon;
grant execute on function public.record_customer_invoice_payment(uuid, numeric, uuid, date) to authenticated;
