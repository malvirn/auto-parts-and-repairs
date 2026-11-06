begin;

alter table public.job_parts
  add column if not exists cost_price numeric(12,2),
  add column if not exists markup_pct numeric(7,2);

create or replace function public.price_job_card_parts(
  p_job_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job_row public.repair_jobs%rowtype;
  line_value jsonb;
  part_row public.job_parts%rowtype;
  line_id uuid;
  cost_value numeric(12,2);
  markup_value numeric(7,2);
  selling_value numeric(12,2);
  submitted_selling_value numeric(12,2);
  quantity_value numeric;
  cost_total numeric(12,2) := 0;
  selling_total numeric(12,2) := 0;
  labour_value numeric := 0;
  extras_value numeric := 0;
  cash_account public.accounts%rowtype;
  expense_account public.accounts%rowtype;
  entry_id uuid;
  job_number_value text;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and (
        profile.role in ('super_admin', 'accounting')
        or coalesce(profile.access_level, 0) >= 2
      )
  ) then
    raise exception 'Only authorised Accounting users can price job-card parts';
  end if;

  if p_job_id is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Select at least one job-card part line to price';
  end if;

  select * into job_row
  from public.repair_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception 'Job card not found';
  end if;

  for line_value in select value from jsonb_array_elements(p_lines)
  loop
    begin
      line_id := nullif(trim(line_value->>'id'), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'A job-card part line has an invalid identifier';
    end;
    cost_value := nullif(line_value->>'cost_price', '')::numeric;
    markup_value := nullif(line_value->>'markup_pct', '')::numeric;
    submitted_selling_value := nullif(line_value->>'selling_price', '')::numeric;
    if line_id is null or cost_value is null or markup_value is null
      or cost_value <= 0 or markup_value < -100 or markup_value > 1000 then
      raise exception 'Enter a valid cost price and markup percentage for every part';
    end if;

    cost_value := round(cost_value, 2);
    markup_value := round(markup_value, 2);
    if submitted_selling_value is not null then
      submitted_selling_value := round(submitted_selling_value, 2);
      if submitted_selling_value <= 0 then
        raise exception 'Selling price must be greater than zero';
      end if;
      selling_value := submitted_selling_value;
      markup_value := round((selling_value / cost_value - 1) * 100, 2);
      if markup_value < -100 or markup_value > 1000 then
        raise exception 'Selling price produces an unsupported markup percentage';
      end if;
    else
      selling_value := round(cost_value * (1 + markup_value / 100), 2);
    end if;
    if cost_value <= 0 or selling_value <= 0 then
      raise exception 'The calculated selling price must be greater than zero';
    end if;

    select * into part_row
    from public.job_parts
    where id = line_id and job_id = p_job_id and awaiting_accounting_price = true
    for update;
    if not found then
      raise exception 'One or more job-card part lines are no longer awaiting a price';
    end if;
    quantity_value := coalesce(part_row.quantity, 0);
    if quantity_value <= 0 then
      raise exception 'Part quantity must be greater than zero';
    end if;

    update public.job_parts
    set cost_price = cost_value,
        markup_pct = markup_value,
        price_at_time = selling_value,
        awaiting_accounting_price = false
    where id = part_row.id;

    cost_total := round(cost_total + cost_value * quantity_value, 2);
    selling_total := round(selling_total + selling_value * quantity_value, 2);
  end loop;

  update public.repair_jobs
  set parts_cost = (
        select coalesce(sum(quantity * price_at_time), 0)
        from public.job_parts
        where job_id = p_job_id and awaiting_accounting_price = false
      )
  where id = p_job_id;

  if cost_total > 0 then
    select * into cash_account
    from public.accounts
    where code = '1000' and type = 'asset' and is_active = true
    for share;
    if not found then
      raise exception 'Cash on Hand account (1000) is missing or inactive';
    end if;

    select * into expense_account
    from public.accounts
    where type = 'expense' and is_active = true
      and (name ilike '%part%' or name ilike '%material%' or name ilike '%inventory%')
    order by code
    limit 1
    for share;
    if not found then
      select * into expense_account
      from public.accounts
      where type = 'expense' and is_active = true
      order by code
      limit 1
      for share;
    end if;
    if not found then
      raise exception 'An active expense account is required to record the part cost';
    end if;

    job_number_value := coalesce(job_row.job_number::text, substr(p_job_id::text, 1, 8));
    insert into public.journal_entries(entry_date, reference, description, source_type)
    values (
      current_date,
      'JC-' || lpad(job_number_value, 5, '0'),
      'Cost of unpriced typed parts — JC-' || lpad(job_number_value, 5, '0'),
      'job_card_typed_part_cost'
    )
    returning id into entry_id;

    insert into public.journal_lines(journal_entry_id, account_id, debit, credit)
    values
      (entry_id, expense_account.id, cost_total, 0),
      (entry_id, cash_account.id, 0, cost_total);
  end if;

  return entry_id;
end;
$$;

revoke all on function public.price_job_card_parts(uuid, jsonb) from public, anon;
grant execute on function public.price_job_card_parts(uuid, jsonb) to authenticated;

drop function if exists public.price_unlisted_job_part(uuid, numeric);

create or replace function public.price_unlisted_job_part(
  p_job_part_id uuid,
  p_cost_price numeric,
  p_markup_pct numeric,
  p_selling_price numeric default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job_id uuid;
begin
  select job_id into v_job_id
  from public.job_parts
  where id = p_job_part_id;
  if v_job_id is null then
    raise exception 'Job-card part not found';
  end if;

  perform public.price_job_card_parts(
    v_job_id,
    jsonb_build_array(jsonb_build_object(
      'id', p_job_part_id::text,
      'cost_price', p_cost_price,
      'markup_pct', p_markup_pct,
      'selling_price', coalesce(p_selling_price, round(p_cost_price * (1 + p_markup_pct / 100), 2))
    ))
  );
end;
$$;

revoke all on function public.price_unlisted_job_part(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.price_unlisted_job_part(uuid, numeric, numeric, numeric) to authenticated;

commit;
