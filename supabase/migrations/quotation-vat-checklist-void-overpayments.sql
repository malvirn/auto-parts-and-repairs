begin;

alter table public.quotations
  add column if not exists vat_rate numeric(5, 2) not null default 5,
  add column if not exists prepared_by text;
alter table public.quotations alter column customer_id drop not null;

alter table public.repair_jobs
  add column if not exists vat_rate numeric(5, 2) not null default 0;
alter table public.repair_jobs
  drop constraint if exists repair_jobs_vat_rate_check;
alter table public.repair_jobs
  add constraint repair_jobs_vat_rate_check check (vat_rate >= 0 and vat_rate <= 100);

do $$
declare
  generated_state text;
begin
  select is_generated into generated_state
  from information_schema.columns
  where table_schema = 'public' and table_name = 'repair_jobs' and column_name = 'total_cost';
  if generated_state = 'ALWAYS' then
    alter table public.repair_jobs alter column total_cost drop expression;
  end if;
end;
$$;

create or replace function public.sync_repair_job_total_cost()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.total_cost := round(
    coalesce(new.labour_cost, 0)
    + coalesce(new.parts_cost, 0)
    + coalesce(new.incidentals_cost, 0)
    + round(coalesce(new.parts_cost, 0) * coalesce(new.vat_rate, 0) / 100, 2),
    2
  );
  return new;
end;
$$;

drop trigger if exists sync_repair_job_total_cost_trigger on public.repair_jobs;
create trigger sync_repair_job_total_cost_trigger
before insert or update of labour_cost, parts_cost, incidentals_cost, vat_rate
on public.repair_jobs
for each row execute function public.sync_repair_job_total_cost();

update public.repair_jobs
set total_cost = coalesce(labour_cost, 0)
               + coalesce(parts_cost, 0)
               + coalesce(incidentals_cost, 0)
               + round(coalesce(parts_cost, 0) * coalesce(vat_rate, 0) / 100, 2);

create or replace function public.amend_customer_quotation_with_vat(
  p_quotation_id uuid,
  p_items jsonb,
  p_vat_rate numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  quotation_row public.quotations%rowtype;
  subtotal numeric(12, 2);
  parts_subtotal numeric(12, 2);
  revised_total numeric(12, 2);
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in to amend quotations' using errcode = '42501';
  end if;
  if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
    raise exception 'VAT rate must be between 0 and 100 percent';
  end if;
  select * into quotation_row from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'Quotation not found'; end if;

  perform public.amend_customer_quotation(p_quotation_id, p_items);
  select coalesce(sum(total_usd), 0),
         coalesce(sum(total_usd) filter (where item_type = 'part'), 0)
  into subtotal, parts_subtotal
  from public.quotation_items where quotation_id = p_quotation_id;
  revised_total := round(subtotal + round(parts_subtotal * p_vat_rate / 100, 2), 2);
  update public.quotations
  set vat_rate = round(p_vat_rate, 2),
      total_usd = revised_total,
      total_zig = round(revised_total * quotation_row.usd_to_zig_rate, 2),
      updated_at = now()
  where id = p_quotation_id;
end;
$$;
revoke all on function public.amend_customer_quotation_with_vat(uuid, jsonb, numeric) from public, anon;
grant execute on function public.amend_customer_quotation_with_vat(uuid, jsonb, numeric) to authenticated;

create or replace function public.record_customer_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_account_id uuid,
  p_payment_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  invoice_row public.invoices%rowtype;
  cash_account public.accounts%rowtype;
  receivable_account public.accounts%rowtype;
  entry_id uuid;
  new_amount_paid numeric(12, 2);
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

  new_amount_paid := round(coalesce(invoice_row.amount_paid, 0) + p_amount, 2);
  insert into public.journal_entries (entry_date, reference, description, source_type)
  values (
    p_payment_date,
    'INV-' || lpad(invoice_row.invoice_number::text, 5, '0'),
    'Customer invoice payment — ' || invoice_row.customer_name,
    'customer_invoice_payment'
  ) returning id into entry_id;
  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  values (entry_id, cash_account.id, p_amount, 0), (entry_id, receivable_account.id, 0, p_amount);
  insert into public.invoice_payments (invoice_id, amount, payment_date, payment_method, journal_entry_id, created_by)
  values (invoice_row.id, p_amount, p_payment_date, cash_account.name, entry_id, auth.uid());
  update public.invoices
  set amount_paid = new_amount_paid,
      status = case when new_amount_paid >= total - 0.005 then 'paid' else 'partially_paid' end
  where id = invoice_row.id;
  return entry_id;
end;
$$;
revoke all on function public.record_customer_invoice_payment(uuid, numeric, uuid, date) from public;
grant execute on function public.record_customer_invoice_payment(uuid, numeric, uuid, date) to authenticated;

alter table public.job_condition_reports
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

create or replace function public.protect_voided_vehicle_checklist()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.voided_at is not null then
    raise exception 'Voided checklists are read-only and cannot be deleted';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_voided_vehicle_checklist_trigger on public.job_condition_reports;
create trigger protect_voided_vehicle_checklist_trigger
before update or delete on public.job_condition_reports
for each row execute function public.protect_voided_vehicle_checklist();

create or replace function public.void_vehicle_condition_checklist(
  p_checklist_id uuid,
  p_reason text
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  checklist_row public.job_condition_reports%rowtype;
  void_time timestamptz := now();
begin
  if auth.uid() is null or public.current_access_level() < 1 then
    raise exception 'Sign in with staff access to void a checklist' using errcode = '42501';
  end if;
  if p_checklist_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Select a checklist and enter a reason for voiding';
  end if;
  select * into checklist_row from public.job_condition_reports where id = p_checklist_id for update;
  if not found then raise exception 'Checklist not found'; end if;
  if checklist_row.voided_at is not null then raise exception 'This checklist has already been voided'; end if;
  update public.job_condition_reports
  set voided_at = void_time, voided_by = auth.uid(), void_reason = btrim(p_reason), updated_at = void_time
  where id = checklist_row.id;
  return void_time;
end;
$$;
revoke all on function public.void_vehicle_condition_checklist(uuid, text) from public, anon;
grant execute on function public.void_vehicle_condition_checklist(uuid, text) to authenticated;

commit;
