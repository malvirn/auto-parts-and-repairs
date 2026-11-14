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
  if found then
    raise exception 'Payroll for this month has already been processed.';
  end if;

  select id into v_wages_account from public.accounts where code = '5100' limit 1;
  select id into v_bank_account from public.accounts where code = '1010' limit 1;
  select id into v_tax_account from public.accounts where code = '2200' limit 1;
  if v_wages_account is null or v_bank_account is null or v_tax_account is null then
    raise exception 'Required payroll accounts 5100, 1010 or 2200 are missing.';
  end if;

  -- Lock unpaid commission rows so two payroll requests cannot pay them twice.
  perform 1 from public.commissions c
  join public.technicians t on t.id = c.employee_id and coalesce(t.is_active, true)
  where c.status = 'unpaid'
  for update of c;

  for v_employee in
    select t.id, t.full_name, t.department,
           coalesce(t.salary, 0)::numeric as gross_salary,
           coalesce(t.deductions, 0)::numeric as deductions
    from public.technicians t
    where coalesce(t.is_active, true)
    order by t.id
  loop
    select coalesce(sum(c.commission_amount), 0)
      into v_commission
    from public.commissions c
    where c.employee_id = v_employee.id and c.status = 'unpaid';

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

  if v_count = 0 then
    raise exception 'There are no active employees to pay.';
  end if;

  insert into public.journal_entries(entry_date, description, source_type, created_by)
  values (
    p_pay_date,
    format('Payroll for %s', to_char(make_date(p_year, p_month, 1), 'FMMonth YYYY')),
    'payroll',
    auth.uid()
  )
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
    payroll_run_id, employee_id, employee_name, department,
    gross_salary, deductions, commission_amount, net_pay
  )
  select v_run_id, t.id, t.full_name, t.department,
         coalesce(t.salary, 0), coalesce(t.deductions, 0),
         coalesce(c.commission_amount, 0),
         coalesce(t.salary, 0) + coalesce(c.commission_amount, 0) - coalesce(t.deductions, 0)
  from public.technicians t
  left join lateral (
    select sum(cm.commission_amount) as commission_amount
    from public.commissions cm
    where cm.employee_id = t.id and cm.status = 'unpaid'
  ) c on true
  where coalesce(t.is_active, true);

  update public.commissions c
  set status = 'paid', payroll_run_id = v_run_id
  from public.technicians t
  where t.id = c.employee_id
    and coalesce(t.is_active, true)
    and c.status = 'unpaid';

  update public.journal_entries set source_id = v_run_id where id = v_entry_id;

  return jsonb_build_object(
    'id', v_run_id,
    'journal_entry_id', v_entry_id,
    'total_amount', v_total_net,
    'employee_count', v_count
  );
end;
$function$;

revoke all on function public.process_payroll_transaction(integer, integer, date) from public, anon;
grant execute on function public.process_payroll_transaction(integer, integer, date) to authenticated;
