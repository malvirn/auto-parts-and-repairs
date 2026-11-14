create or replace function public.post_cashbook_transaction(
  p_entry_date date,
  p_description text,
  p_direction text,
  p_amount numeric,
  p_cash_account_id uuid,
  p_contra_account_id uuid
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
     or p_direction not in ('in', 'out')
     or p_cash_account_id is null or p_contra_account_id is null
     or p_cash_account_id = p_contra_account_id then
    raise exception 'Enter a valid date, direction, amount and two different accounts.';
  end if;

  select code into v_cash_code
  from public.accounts
  where id = p_cash_account_id and is_active = true;
  if v_cash_code is null or v_cash_code not in ('1000', '1010', '1020', '1050') then
    raise exception 'Select an active cash or bank account.';
  end if;

  select is_active into v_contra_active
  from public.accounts
  where id = p_contra_account_id;
  if coalesce(v_contra_active, false) is not true then
    raise exception 'Select an active contra account.';
  end if;

  insert into public.journal_entries(entry_date, description, source_type, created_by)
  values (p_entry_date, coalesce(nullif(trim(p_description), ''), 'Cashbook transaction'), 'cash_transaction', auth.uid())
  returning id into v_entry_id;

  if p_direction = 'in' then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit)
    values
      (v_entry_id, p_cash_account_id, p_amount, 0),
      (v_entry_id, p_contra_account_id, 0, p_amount);
  else
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit)
    values
      (v_entry_id, p_contra_account_id, p_amount, 0),
      (v_entry_id, p_cash_account_id, 0, p_amount);
  end if;

  return v_entry_id;
end;
$function$;

revoke all on function public.post_cashbook_transaction(date, text, text, numeric, uuid, uuid) from public, anon;
grant execute on function public.post_cashbook_transaction(date, text, text, numeric, uuid, uuid) to authenticated;
