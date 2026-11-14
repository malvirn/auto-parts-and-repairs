create or replace function public.process_payroll_transaction(
  p_year integer,
  p_month integer,
  p_pay_date date
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_run_id uuid;
  v_entry_id uuid;
  v_wages_account uuid;
  v_bank_account uuid;
  v_tax_account uuid;
  v_employee record;
  v_commission numeric;
  v_net numeric;
  v_total_gross numeric := 0;
  v_total_deductions numeric := 0;
  v_total_net numeric := 0;
  v_count integer := 0;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 2 then
    raise exception 'You are not authorised to process payroll.';
  end if;
  if p_year is null or p_month is null or p_month < 1 or p_month > 12 or p_pay_date is null then
    raise exception 'A valid payroll year, month and pay date are required.';
  end if;
  perform 1 from public.payroll_runs where year = p_year and month = p_month;
  if found then raise exception 'Payroll for this month has already been processed.'; end if;

  select id into v_wages_account from public.accounts where code = '5100' and is_active = true limit 1;
  select id into v_bank_account from public.accounts where code = '1010' and is_active = true limit 1;
  select id into v_tax_account from public.accounts where code = '2200' and is_active = true limit 1;
  if v_wages_account is null or v_bank_account is null or v_tax_account is null then
    raise exception 'Required active payroll accounts 5100, 1010 or 2200 are missing.';
  end if;

  perform 1 from public.commissions c
  join public.technicians t on t.id = c.employee_id and coalesce(t.is_active, true)
  where c.status = 'unpaid'
  for update of c;

  for v_employee in
    select t.id, t.full_name, t.department,
           coalesce(t.salary, 0)::numeric as gross_salary,
           coalesce(t.deductions, 0)::numeric as deductions
    from public.technicians t where coalesce(t.is_active, true) order by t.id
  loop
    select coalesce(sum(c.commission_amount), 0) into v_commission
    from public.commissions c where c.employee_id = v_employee.id and c.status = 'unpaid';
    if v_employee.gross_salary < 0 or v_employee.deductions < 0 or v_commission < 0 then
      raise exception 'Payroll contains a negative salary, deduction or commission for %.', v_employee.full_name;
    end if;
    if v_employee.deductions > v_employee.gross_salary + v_commission then
      raise exception 'Deductions exceed earnings for %. Correct the employee payroll details first.', v_employee.full_name;
    end if;
    v_net := v_employee.gross_salary + v_commission - v_employee.deductions;
    v_total_gross := v_total_gross + v_employee.gross_salary + v_commission;
    v_total_deductions := v_total_deductions + v_employee.deductions;
    v_total_net := v_total_net + v_net;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'There are no active employees to pay.'; end if;

  insert into public.journal_entries(entry_date, description, source_type, created_by)
  values (p_pay_date, format('Payroll for %s', to_char(make_date(p_year, p_month, 1), 'FMMonth YYYY')), 'payroll', auth.uid())
  returning id into v_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
  values (v_entry_id, v_wages_account, v_total_gross, 0, 'Gross salaries and commissions');
  if v_total_deductions > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
    values (v_entry_id, v_tax_account, 0, v_total_deductions, 'Payroll deductions payable');
  end if;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
  values (v_entry_id, v_bank_account, 0, v_total_net, 'Net payroll payable');

  insert into public.payroll_runs(year, month, pay_date, total_amount, journal_entry_id)
  values (p_year, p_month, p_pay_date, v_total_net, v_entry_id)
  returning id into v_run_id;

  insert into public.payroll_payments(
    payroll_run_id, employee_id, employee_name, department, gross_salary, deductions, commission_amount, net_pay
  )
  select v_run_id, t.id, t.full_name, t.department, coalesce(t.salary, 0), coalesce(t.deductions, 0),
         coalesce(c.commission_amount, 0),
         coalesce(t.salary, 0) + coalesce(c.commission_amount, 0) - coalesce(t.deductions, 0)
  from public.technicians t
  left join lateral (
    select sum(cm.commission_amount) as commission_amount
    from public.commissions cm where cm.employee_id = t.id and cm.status = 'unpaid'
  ) c on true
  where coalesce(t.is_active, true);

  update public.commissions c
  set status = 'paid', payroll_run_id = v_run_id
  from public.technicians t
  where t.id = c.employee_id and coalesce(t.is_active, true) and c.status = 'unpaid';
  update public.journal_entries set source_id = v_run_id where id = v_entry_id;

  return jsonb_build_object('id', v_run_id, 'journal_entry_id', v_entry_id, 'total_amount', v_total_net, 'employee_count', v_count);
end;
$function$;

create or replace function public.post_cashbook_transaction(
  p_entry_date date, p_description text, p_direction text, p_amount numeric,
  p_cash_account_id uuid, p_contra_account_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_entry_id uuid;
  v_cash_code text;
  v_contra_active boolean;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 2 then
    raise exception 'You are not authorised to post cashbook transactions.';
  end if;
  if p_entry_date is null or p_amount is null or p_amount <= 0
     or p_direction is null or p_direction not in ('in', 'out')
     or p_cash_account_id is null or p_contra_account_id is null
     or p_cash_account_id = p_contra_account_id then
    raise exception 'Enter a valid date, direction, amount and two different accounts.';
  end if;
  select code into v_cash_code from public.accounts
  where id = p_cash_account_id and is_active = true;
  if v_cash_code is null or v_cash_code not in ('1000', '1010', '1020', '1050') then
    raise exception 'Select an active cash or bank account.';
  end if;
  select is_active into v_contra_active from public.accounts where id = p_contra_account_id;
  if coalesce(v_contra_active, false) is not true then raise exception 'Select an active contra account.'; end if;

  insert into public.journal_entries(entry_date, description, source_type, created_by)
  values (p_entry_date, coalesce(nullif(trim(p_description), ''), 'Cashbook transaction'), 'cash_transaction', auth.uid())
  returning id into v_entry_id;
  if p_direction = 'in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit)
    values (v_entry_id, p_cash_account_id, p_amount, 0), (v_entry_id, p_contra_account_id, 0, p_amount);
  else
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit)
    values (v_entry_id, p_contra_account_id, p_amount, 0), (v_entry_id, p_cash_account_id, 0, p_amount);
  end if;
  return v_entry_id;
end;
$function$;

create or replace function public.create_validated_receipt(
  p_repair_job_id uuid default null,
  p_sales_order_id uuid default null,
  p_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_receipt_id uuid;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'You are not authorised to create receipts.';
  end if;
  if (p_repair_job_id is null) = (p_sales_order_id is null) then
    raise exception 'A receipt must be linked to exactly one repair job or sales order.';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'Receipt amount must be zero or greater.'; end if;
  if p_repair_job_id is not null then
    perform 1 from public.repair_jobs where id = p_repair_job_id;
    if not found then raise exception 'The repair job for this receipt was not found.'; end if;
  else
    perform 1 from public.sales_orders where id = p_sales_order_id;
    if not found then raise exception 'The sales order for this receipt was not found.'; end if;
  end if;
  insert into public.receipts(repair_job_id, sales_order_id, amount)
  values (p_repair_job_id, p_sales_order_id, p_amount)
  returning id into v_receipt_id;
  return v_receipt_id;
end;
$function$;

drop policy if exists "Active staff can create receipts" on public.receipts;
revoke all on function public.process_payroll_transaction(integer, integer, date) from public, anon;
grant execute on function public.process_payroll_transaction(integer, integer, date) to authenticated;
revoke all on function public.post_cashbook_transaction(date, text, text, numeric, uuid, uuid) from public, anon;
grant execute on function public.post_cashbook_transaction(date, text, text, numeric, uuid, uuid) to authenticated;
revoke all on function public.create_validated_receipt(uuid, uuid, numeric) from public, anon;
grant execute on function public.create_validated_receipt(uuid, uuid, numeric) to authenticated;
