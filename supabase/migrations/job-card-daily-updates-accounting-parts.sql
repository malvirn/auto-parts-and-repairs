begin;

alter table public.repair_jobs
  add column if not exists work_done text,
  add column if not exists work_missing text,
  add column if not exists daily_update_note text,
  add column if not exists daily_update_at timestamptz,
  add column if not exists tested_by text,
  add column if not exists next_service_mileage integer,
  add column if not exists closed_at timestamptz;

update public.repair_jobs
set daily_update_at = created_at
where daily_update_at is null;

alter table public.job_parts
  add column if not exists awaiting_accounting_price boolean not null default false,
  alter column part_id drop not null;

drop policy if exists "Operational users can read job parts" on public.job_parts;
create policy "Operational users can read job parts"
  on public.job_parts for select
  to authenticated
  using (public.is_operational());

drop policy if exists "Operational users can add job parts" on public.job_parts;
create policy "Operational users can add job parts"
  on public.job_parts for insert
  to authenticated
  with check (public.is_operational());

create or replace function public.job_card_part_catalog()
returns table (
  id uuid,
  name text,
  description text,
  selling_price numeric,
  quantity_in_stock numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.is_operational(), false) is not true then
    raise exception 'Operational access is required to view job-card parts';
  end if;

  return query
  select p.id, p.name, p.description, p.selling_price::numeric, p.quantity_in_stock::numeric
  from public.parts p
  order by p.name;
end;
$$;

create or replace function public.price_unlisted_job_part(
  p_job_part_id uuid,
  p_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and (profile.role in ('accounting', 'super_admin') or coalesce(profile.access_level, 0) >= 2)
  ) then
    raise exception 'Accounting access is required to price a typed-in job part';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter a price greater than zero';
  end if;

  update public.job_parts
  set price_at_time = p_price,
      awaiting_accounting_price = false
  where id = p_job_part_id
    and awaiting_accounting_price = true
  returning job_id into v_job_id;

  if v_job_id is null then
    raise exception 'This typed-in job part is no longer awaiting a price';
  end if;

  update public.repair_jobs
  set parts_cost = (
    select coalesce(sum(quantity * price_at_time), 0)
    from public.job_parts
    where job_id = v_job_id
      and awaiting_accounting_price = false
  )
  where id = v_job_id;
end;
$$;

create or replace function public.get_unpriced_job_parts()
returns table (
  id uuid,
  part_name text,
  quantity numeric,
  job_number text,
  customer_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = auth.uid()
      and (profile.role in ('accounting', 'super_admin') or coalesce(profile.access_level, 0) >= 2)
  ) then
    raise exception 'Accounting access is required to review unpriced job parts';
  end if;

  return query
  select jp.id, jp.part_name, jp.quantity::numeric, j.job_number::text, c.full_name
  from public.job_parts jp
  join public.repair_jobs j on j.id = jp.job_id
  left join public.customers c on c.id = j.customer_id
  where jp.awaiting_accounting_price = true
  order by j.created_at, jp.id;
end;
$$;

revoke all on function public.job_card_part_catalog() from public;
revoke all on function public.job_card_part_catalog() from anon;
grant execute on function public.job_card_part_catalog() to authenticated;

revoke all on function public.price_unlisted_job_part(uuid, numeric) from public;
revoke all on function public.price_unlisted_job_part(uuid, numeric) from anon;
grant execute on function public.price_unlisted_job_part(uuid, numeric) to authenticated;

revoke all on function public.get_unpriced_job_parts() from public;
revoke all on function public.get_unpriced_job_parts() from anon;
grant execute on function public.get_unpriced_job_parts() to authenticated;

commit;
