begin;

alter table public.restocks
  add column if not exists invoice_number text,
  add column if not exists payment_status text not null default 'paid',
  add column if not exists journal_entry_id uuid references public.journal_entries(id) on delete set null,
  add column if not exists part_name text;

create table if not exists public.job_part_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  job_part_id uuid not null unique references public.job_parts(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested', 'awaiting_accounting', 'paid', 'received')),
  supplier_name text,
  supplier_email text,
  supplier_phone text,
  quoted_unit_cost numeric(12, 2) check (quoted_unit_cost is null or quoted_unit_cost > 0),
  release_journal_entry_id uuid references public.journal_entries(id) on delete set null,
  cash_account_id uuid references public.accounts(id) on delete set null,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  part_id uuid references public.parts(id) on delete set null,
  restock_id uuid,
  received_at timestamptz,
  received_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$
declare
  restock_id_type text;
  request_restock_id_type text;
begin
  select format_type(attribute.atttypid, attribute.atttypmod)
  into restock_id_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.restocks'::regclass
    and attribute.attname = 'id'
    and not attribute.attisdropped;

  if restock_id_type is null then
    raise exception 'Could not determine the type of public.restocks.id';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
  into request_restock_id_type
  from pg_attribute attribute
  where attribute.attrelid = 'public.job_part_purchase_requests'::regclass
    and attribute.attname = 'restock_id'
    and not attribute.attisdropped;

  if request_restock_id_type is distinct from restock_id_type then
    if exists (
      select 1
      from public.job_part_purchase_requests
      where restock_id is not null
    ) then
      raise exception
        'job_part_purchase_requests.restock_id contains values and does not match public.restocks.id type (%)',
        restock_id_type;
    end if;

    execute format(
      'alter table public.job_part_purchase_requests alter column restock_id type %s using restock_id::text::%s',
      restock_id_type,
      restock_id_type
    );
  end if;

  alter table public.job_part_purchase_requests
    drop constraint if exists job_part_purchase_requests_restock_id_fkey;
  alter table public.job_part_purchase_requests
    add constraint job_part_purchase_requests_restock_id_fkey
    foreign key (restock_id) references public.restocks(id) on delete set null;
end $$;

alter table public.job_part_purchase_requests enable row level security;
revoke all on public.job_part_purchase_requests from public, anon, authenticated;
grant select on public.job_part_purchase_requests to authenticated;

drop policy if exists "Operational and accounting users can view job part purchase requests"
  on public.job_part_purchase_requests;
create policy "Operational and accounting users can view job part purchase requests"
  on public.job_part_purchase_requests for select to authenticated
  using (
    coalesce(public.is_operational(), false)
    or public.current_access_level() >= 2
  );

alter table public.restocks
  add column if not exists purchase_request_id uuid
    references public.job_part_purchase_requests(id) on delete set null;

create unique index if not exists restocks_purchase_request_id_uidx
  on public.restocks(purchase_request_id)
  where purchase_request_id is not null;

create index if not exists job_part_purchase_requests_status_created_idx
  on public.job_part_purchase_requests(status, created_at desc);

create or replace function public.enqueue_job_part_purchase_request()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.awaiting_accounting_price then
    insert into public.job_part_purchase_requests(job_part_id)
    values (new.id)
    on conflict (job_part_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists job_parts_enqueue_purchase_request on public.job_parts;
create trigger job_parts_enqueue_purchase_request
after insert on public.job_parts
for each row execute function public.enqueue_job_part_purchase_request();

insert into public.job_part_purchase_requests(job_part_id)
select part.id
from public.job_parts part
where part.awaiting_accounting_price
on conflict (job_part_id) do nothing;

create or replace function public.get_shop_job_part_purchase_requests()
returns table (
  id uuid,
  job_id uuid,
  job_part_id uuid,
  job_number text,
  cro_number text,
  customer_name text,
  part_name text,
  quantity numeric,
  status text,
  supplier_id uuid,
  supplier_name text,
  supplier_email text,
  supplier_phone text,
  quoted_unit_cost numeric,
  part_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(public.is_operational(), false) is not true then
    raise exception 'Shop access is required to view job-part purchase requests';
  end if;

  return query
  select request.id, job.id, job_part.id, job.job_number::text, job.cro_number,
    customer.full_name, job_part.part_name, job_part.quantity::numeric,
    request.status, request.supplier_id, request.supplier_name,
    request.supplier_email, request.supplier_phone, request.quoted_unit_cost,
    request.part_id, request.created_at
  from public.job_part_purchase_requests request
  join public.job_parts job_part on job_part.id = request.job_part_id
  join public.repair_jobs job on job.id = job_part.job_id
  left join public.customers customer on customer.id = job.customer_id
  where request.status <> 'received'
  order by request.created_at desc
  limit 500;
end;
$$;

create or replace function public.get_accounting_job_part_purchase_requests()
returns table (
  id uuid,
  job_id uuid,
  job_number text,
  cro_number text,
  customer_name text,
  part_name text,
  quantity numeric,
  supplier_name text,
  supplier_email text,
  supplier_phone text,
  quoted_unit_cost numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
    raise exception 'Accounting access is required to review job-part purchase requests';
  end if;

  return query
  select request.id, job.id, job.job_number::text, job.cro_number,
    customer.full_name, job_part.part_name, job_part.quantity::numeric,
    request.supplier_name, request.supplier_email, request.supplier_phone,
    request.quoted_unit_cost, request.created_at
  from public.job_part_purchase_requests request
  join public.job_parts job_part on job_part.id = request.job_part_id
  join public.repair_jobs job on job.id = job_part.job_id
  left join public.customers customer on customer.id = job.customer_id
  where request.status = 'awaiting_accounting'
  order by request.created_at
  limit 500;
end;
$$;

create or replace function public.submit_job_part_purchase_quote(
  p_request_id uuid,
  p_supplier_name text,
  p_supplier_email text,
  p_supplier_phone text,
  p_unit_cost numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.job_part_purchase_requests%rowtype;
  supplier_row public.suppliers%rowtype;
  supplier_label text := nullif(btrim(p_supplier_name), '');
  email_value text := nullif(btrim(p_supplier_email), '');
  phone_value text := nullif(btrim(p_supplier_phone), '');
begin
  if coalesce(public.is_operational(), false) is not true then
    raise exception 'Shop access is required to submit supplier details';
  end if;
  if supplier_label is null or length(supplier_label) > 200 then
    raise exception 'Enter a supplier name of 200 characters or fewer';
  end if;
  if email_value is null or email_value !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid supplier email address';
  end if;
  if phone_value is null or length(phone_value) > 50 then
    raise exception 'Enter a supplier phone number of 50 characters or fewer';
  end if;
  if p_unit_cost is null or p_unit_cost <= 0 then
    raise exception 'Enter a quoted unit cost greater than zero';
  end if;
  if round(p_unit_cost, 2) <= 0 then
    raise exception 'The quoted unit cost must be at least 0.01';
  end if;

  select * into request_row
  from public.job_part_purchase_requests
  where id = p_request_id
  for update;
  if not found or request_row.status <> 'requested' then
    raise exception 'This request is no longer waiting for Shop supplier details';
  end if;

  perform pg_advisory_xact_lock(hashtext('supplier_name:' || lower(supplier_label)));
  select * into supplier_row
  from public.suppliers
  where lower(btrim(name)) = lower(supplier_label)
  order by created_at
  limit 1
  for update;

  if not found then
    insert into public.suppliers(name, email, phone)
    values (supplier_label, email_value, phone_value)
    returning * into supplier_row;
  else
    update public.suppliers
    set email = email_value,
        phone = phone_value
    where id = supplier_row.id
    returning * into supplier_row;
  end if;

  update public.job_part_purchase_requests
  set supplier_id = supplier_row.id,
      supplier_name = supplier_row.name,
      supplier_email = email_value,
      supplier_phone = phone_value,
      quoted_unit_cost = round(p_unit_cost, 2),
      status = 'awaiting_accounting'
  where id = request_row.id;
end;
$$;

create or replace function public.release_job_part_purchase_funds(
  p_request_id uuid,
  p_cash_account_id uuid,
  p_payment_date date
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.job_part_purchase_requests%rowtype;
  job_part_row public.job_parts%rowtype;
  inventory_account public.accounts%rowtype;
  cash_account public.accounts%rowtype;
  entry_id uuid;
  amount_value numeric(12, 2);
  reference_value text;
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
    raise exception 'Only authorised Accounting users can release purchase funds';
  end if;
  if p_payment_date is null then
    raise exception 'Choose the payment date';
  end if;

  select * into request_row
  from public.job_part_purchase_requests
  where id = p_request_id
  for update;
  if not found or request_row.status <> 'awaiting_accounting' then
    raise exception 'This purchase request is no longer awaiting Accounting release';
  end if;

  select * into job_part_row
  from public.job_parts
  where id = request_row.job_part_id;
  if not found or request_row.supplier_id is null or request_row.quoted_unit_cost is null then
    raise exception 'The request is missing its supplier quote or job-card part';
  end if;
  if job_part_row.quantity <= 0 or job_part_row.quantity <> trunc(job_part_row.quantity) then
    raise exception 'Job-part purchase quantity must be a whole number greater than zero';
  end if;

  amount_value := round(request_row.quoted_unit_cost * job_part_row.quantity, 2);
  if amount_value <= 0 then
    raise exception 'The supplier payment must be greater than zero';
  end if;

  select * into inventory_account
  from public.accounts
  where code = '1200' and type = 'asset' and is_active = true
  for share;
  if not found then
    raise exception 'Parts Inventory account (code 1200) is missing or inactive';
  end if;

  select * into cash_account
  from public.accounts
  where id = p_cash_account_id
    and code in ('1000', '1010')
    and type = 'asset'
    and is_active = true
  for share;
  if not found then
    raise exception 'Choose an active Cash or Bank account';
  end if;
  if cash_account.id = inventory_account.id then
    raise exception 'Choose a Cash or Bank account instead of Parts Inventory';
  end if;

  reference_value := 'JPR-' || upper(substr(replace(request_row.id::text, '-', ''), 1, 12));
  insert into public.journal_entries(entry_date, reference, description, source_type)
  values (
    p_payment_date,
    reference_value,
    'Job-part purchase from ' || request_row.supplier_name || ': '
      || job_part_row.part_name || ' × ' || job_part_row.quantity,
    'shop_restock'
  )
  returning id into entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit)
  values
    (entry_id, inventory_account.id, amount_value, 0),
    (entry_id, cash_account.id, 0, amount_value);

  update public.job_part_purchase_requests
  set status = 'paid',
      release_journal_entry_id = entry_id,
      cash_account_id = cash_account.id,
      released_at = now(),
      released_by = auth.uid()
  where id = request_row.id;

  return entry_id;
end;
$$;

create or replace function public.receive_job_part_purchase(
  p_request_id uuid,
  p_existing_part_id uuid default null,
  p_part_number text default null,
  p_selling_price numeric default null,
  p_vat_rate numeric default 5
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.job_part_purchase_requests%rowtype;
  job_part_row public.job_parts%rowtype;
  part_row public.parts%rowtype;
  part_label text;
  restock_row_id public.restocks.id%type;
  invoice_value text;
begin
  if coalesce(public.is_operational(), false) is not true then
    raise exception 'Shop access is required to receive job-part purchases';
  end if;

  select * into request_row
  from public.job_part_purchase_requests
  where id = p_request_id
  for update;
  if not found or request_row.status <> 'paid' then
    raise exception 'Only a purchase with released funds can be received into inventory';
  end if;

  select * into job_part_row
  from public.job_parts
  where id = request_row.job_part_id;
  if not found then
    raise exception 'The original job-card part no longer exists';
  end if;

  part_label := btrim(job_part_row.part_name);
  if p_existing_part_id is null then
    if p_selling_price is null or p_selling_price <= 0 then
      raise exception 'Enter a selling price greater than zero for the new stock item';
    end if;
    if round(p_selling_price, 2) <= 0 then
      raise exception 'The selling price must be at least 0.01';
    end if;
    if p_vat_rate is distinct from 5 then
      raise exception 'Shop inventory must use the configured 5%% VAT rate';
    end if;

    insert into public.parts(
      name, part_number, description, category, quantity_in_stock,
      minimum_stock, cost_price, selling_price, vat_rate, supplier_id
    )
    values (
      part_label, nullif(btrim(p_part_number), ''), part_label, 'Other',
      job_part_row.quantity, 0, request_row.quoted_unit_cost,
      round(p_selling_price, 2), p_vat_rate, request_row.supplier_id
    )
    returning * into part_row;
  else
    if job_part_row.quantity <= 0 or job_part_row.quantity <> trunc(job_part_row.quantity) then
      raise exception 'Job-part purchase quantity must be a whole number greater than zero';
    end if;
    update public.parts
    set quantity_in_stock = coalesce(quantity_in_stock, 0) + job_part_row.quantity,
        cost_price = request_row.quoted_unit_cost,
        supplier_id = request_row.supplier_id
    where id = p_existing_part_id
    returning * into part_row;
    if not found then
      raise exception 'The selected inventory part no longer exists';
    end if;
  end if;

  invoice_value := 'JPR-' || upper(substr(replace(request_row.id::text, '-', ''), 1, 12));
  insert into public.restocks(
    part_id, part_name, supplier_id, quantity, unit_cost,
    invoice_number, payment_status, journal_entry_id, purchase_request_id, restocked_at
  )
  values (
    part_row.id, part_row.name, request_row.supplier_id,
    job_part_row.quantity::integer, request_row.quoted_unit_cost,
    invoice_value, 'paid', request_row.release_journal_entry_id,
    request_row.id, now()
  )
  returning id into restock_row_id;

  update public.job_parts
  set part_id = part_row.id
  where id = job_part_row.id;

  update public.job_part_purchase_requests
  set status = 'received',
      part_id = part_row.id,
      restock_id = restock_row_id,
      received_at = now(),
      received_by = auth.uid()
  where id = request_row.id;

  return part_row.id;
end;
$$;

revoke all on function public.enqueue_job_part_purchase_request() from public, anon;
revoke all on function public.get_shop_job_part_purchase_requests() from public, anon;
revoke all on function public.get_accounting_job_part_purchase_requests() from public, anon;
revoke all on function public.submit_job_part_purchase_quote(uuid, text, text, text, numeric) from public, anon;
revoke all on function public.release_job_part_purchase_funds(uuid, uuid, date) from public, anon;
revoke all on function public.receive_job_part_purchase(uuid, uuid, text, numeric, numeric) from public, anon;

grant execute on function public.get_shop_job_part_purchase_requests() to authenticated;
grant execute on function public.get_accounting_job_part_purchase_requests() to authenticated;
grant execute on function public.submit_job_part_purchase_quote(uuid, text, text, text, numeric) to authenticated;
grant execute on function public.release_job_part_purchase_funds(uuid, uuid, date) to authenticated;
grant execute on function public.receive_job_part_purchase(uuid, uuid, text, numeric, numeric) to authenticated;

commit;
