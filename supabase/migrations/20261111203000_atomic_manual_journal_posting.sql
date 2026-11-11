-- Post manual journal entries in one transaction and validate cent-level totals.
create or replace function public.post_manual_journal_entry(
  p_entry_date date,
  p_reference text,
  p_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = 'pg_catalog', 'public'
as $function$
declare
  entry_id uuid;
  line jsonb;
  account_id_value uuid;
  debit_value numeric(12,2);
  credit_value numeric(12,2);
  debit_total numeric(14,2) := 0;
  credit_total numeric(14,2) := 0;
begin
  if auth.uid() is null or public.current_access_level() < 2 then
    raise exception 'Only authorised accounting users can post manual journal entries'
      using errcode = '42501';
  end if;
  if p_entry_date is null or nullif(btrim(p_description), '') is null then
    raise exception 'Enter an entry date and description';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry requires at least two lines';
  end if;

  for line in select value from jsonb_array_elements(p_lines)
  loop
    account_id_value := nullif(line->>'account_id','')::uuid;
    debit_value := round(coalesce(nullif(line->>'debit','')::numeric,0),2);
    credit_value := round(coalesce(nullif(line->>'credit','')::numeric,0),2);
    if account_id_value is null then
      raise exception 'Choose an account for every journal line';
    end if;
    if debit_value < 0 or credit_value < 0
      or not ((debit_value > 0 and credit_value = 0)
        or (credit_value > 0 and debit_value = 0)) then
      raise exception 'Each journal line must contain a positive debit or a positive credit, but not both';
    end if;
    if not exists (select 1 from public.accounts where id = account_id_value and is_active = true) then
      raise exception 'A selected ledger account is missing or inactive';
    end if;
    debit_total := debit_total + debit_value;
    credit_total := credit_total + credit_value;
  end loop;

  if debit_total <= 0 or debit_total <> credit_total then
    raise exception 'Journal entry is not balanced. Debits: %, credits: %', debit_total, credit_total;
  end if;

  insert into public.journal_entries (entry_date, reference, description, source_type, created_by)
  values (p_entry_date, nullif(btrim(p_reference), ''), btrim(p_description), 'manual', auth.uid())
  returning id into entry_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit, credit)
  select entry_id, (line->>'account_id')::uuid,
    round(coalesce(nullif(line->>'debit','')::numeric,0),2),
    round(coalesce(nullif(line->>'credit','')::numeric,0),2)
  from jsonb_array_elements(p_lines) as rows(line);

  return entry_id;
end;
$function$;

revoke all on function public.post_manual_journal_entry(date,text,text,jsonb) from public, anon;
grant execute on function public.post_manual_journal_entry(date,text,text,jsonb) to authenticated;
