-- Automatically issue a customer credit note whenever an invoice overpayment is recorded.
-- The overpayment remains a liability and is not posted as new income.

create or replace function public.auto_issue_overpayment_credit_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.customer_overpayment_credit_notes
    (overpayment_credit_id, customer_id, invoice_id, customer_name, customer_phone, amount, issued_by)
  values
    (new.id, new.customer_id, new.invoice_id,
     coalesce(nullif(new.customer_name, ''), 'Customer'),
     new.customer_phone, new.amount, new.created_by)
  on conflict (overpayment_credit_id) do nothing;

  return new;
end;
$$;

revoke all on function public.auto_issue_overpayment_credit_note() from public, anon, authenticated;

drop trigger if exists trg_auto_issue_overpayment_credit_note
  on public.customer_overpayment_credits;

create trigger trg_auto_issue_overpayment_credit_note
after insert on public.customer_overpayment_credits
for each row
execute function public.auto_issue_overpayment_credit_note();

-- Repair any overpayments already recorded before automatic issuance was enabled.
insert into public.customer_overpayment_credit_notes
  (overpayment_credit_id, customer_id, invoice_id, customer_name, customer_phone, amount, issued_by)
select c.id, c.customer_id, c.invoice_id,
       coalesce(nullif(c.customer_name, ''), 'Customer'),
       c.customer_phone, c.amount, c.created_by
from public.customer_overpayment_credits c
where not exists (
  select 1
  from public.customer_overpayment_credit_notes n
  where n.overpayment_credit_id = c.id
)
on conflict (overpayment_credit_id) do nothing;
