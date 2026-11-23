-- Activity & audit trail for Centric Intelligence.
-- Records WHO did WHAT and WHEN on the key business tables, with before/after values.
-- Additive only: one table, two functions, row triggers. Trigger failures never block a business write.

create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,
  actor_name    text,
  actor_role    text,
  action        text not null check (action in ('INSERT','UPDATE','DELETE')),
  table_name    text not null,
  record_id     text,
  record_label  text,
  summary       text,
  changed_fields text[],
  old_data      jsonb,
  new_data      jsonb,
  source        text not null default 'live' check (source in ('live','backfill'))
);

create index if not exists audit_log_occurred_idx on public.audit_log (occurred_at desc, id desc);
create index if not exists audit_log_actor_idx    on public.audit_log (actor_id, occurred_at desc);
create index if not exists audit_log_table_idx    on public.audit_log (table_name, occurred_at desc);
create index if not exists audit_log_record_idx   on public.audit_log (table_name, record_id);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
  for select to authenticated
  using (coalesce(public.current_access_level(), 0) >= 2);

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- The log is append-only: nobody can edit or delete history through the API.
create or replace function public.audit_log_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'The audit log is append-only';
end $$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

create or replace function public.audit_table_label(t text) returns text
language sql immutable as $$
  select case t
    when 'repair_jobs' then 'job card'
    when 'job_parts' then 'job part'
    when 'job_condition_reports' then 'vehicle checklist'
    when 'invoices' then 'invoice'
    when 'invoice_payments' then 'payment'
    when 'receipts' then 'receipt'
    when 'expenses' then 'expense'
    when 'parts' then 'part'
    when 'restocks' then 'stock purchase'
    when 'customers' then 'customer'
    when 'vehicles' then 'vehicle'
    when 'payables' then 'supplier bill'
    else t end
$$;

create or replace function public.log_audit_event() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_changed text[];
  v_uid uuid := auth.uid(); v_name text; v_role text;
  v_id text; v_label text; v_summary text; v_old_chg jsonb; v_new_chg jsonb; v_what text;
begin
  begin
    if tg_op = 'INSERT' then
      v_new := to_jsonb(new); v_row := v_new;
    elsif tg_op = 'UPDATE' then
      v_old := to_jsonb(old); v_new := to_jsonb(new); v_row := v_new;
      select array_agg(n.key order by n.key) into v_changed
        from jsonb_each(v_new) n where v_old -> n.key is distinct from n.value;
      v_changed := array_remove(v_changed, 'updated_at');
      if v_changed is null or cardinality(v_changed) = 0 then return new; end if;
      select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
        into v_old_chg, v_new_chg from unnest(v_changed) k;
    else
      v_old := to_jsonb(old); v_row := v_old;
    end if;

    v_id := v_row ->> 'id';
    v_label := case tg_table_name
      when 'repair_jobs' then coalesce(v_row ->> 'cro_number', 'Job #' || (v_row ->> 'job_number'))
      when 'invoices' then 'INV-' || lpad(coalesce(v_row ->> 'invoice_number', '0'), 5, '0')
      when 'receipts' then 'Receipt #' || coalesce(v_row ->> 'receipt_number', '')
      when 'invoice_payments' then coalesce(v_row ->> 'payment_method', 'payment') || ' ' || coalesce(v_row ->> 'amount', '')
      when 'expenses' then coalesce(v_row ->> 'category', '') || ' — ' || coalesce(v_row ->> 'description', '')
      when 'job_condition_reports' then coalesce(v_row ->> 'inspection_no', v_row ->> 'vehicle_registration')
      when 'payables' then coalesce(v_row ->> 'bill_number', '')
      when 'vehicles' then coalesce(v_row ->> 'license_plate', '')
      when 'customers' then coalesce(v_row ->> 'full_name', '')
      else coalesce(v_row ->> 'name', v_row ->> 'part_name', v_row ->> 'description', v_id) end;

    v_what := public.audit_table_label(tg_table_name);
    v_summary := case tg_op
      when 'INSERT' then 'Created ' || v_what || ' ' || coalesce(v_label, '')
      when 'DELETE' then 'Deleted ' || v_what || ' ' || coalesce(v_label, '')
      else 'Updated ' || v_what || ' ' || coalesce(v_label, '') || ' — ' ||
        case when 'status' in (select unnest(v_changed))
          then 'status ' || coalesce(v_old ->> 'status', '—') || ' → ' || coalesce(v_new ->> 'status', '—')
          else array_to_string(v_changed[1:4], ', ') || case when cardinality(v_changed) > 4 then ' +' || (cardinality(v_changed) - 4) || ' more' else '' end
        end
      end;

    select coalesce(p.full_name, p.email), p.role into v_name, v_role from public.profiles p where p.id = v_uid;

    insert into public.audit_log(actor_id, actor_name, actor_role, action, table_name, record_id, record_label, summary, changed_fields, old_data, new_data)
    values (v_uid, v_name, v_role, tg_op, tg_table_name, v_id, v_label, v_summary, v_changed,
            case tg_op when 'UPDATE' then v_old_chg when 'DELETE' then v_old end,
            case tg_op when 'UPDATE' then v_new_chg when 'INSERT' then v_new end);
  exception when others then
    null; -- never block the business write because logging failed
  end;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['repair_jobs','job_parts','job_condition_reports','invoices','invoice_payments','receipts','expenses','parts','restocks','customers','vehicles','payables']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_audit_log on public.%I', t);
      execute format('create trigger trg_audit_log after insert or update or delete on public.%I for each row execute function public.log_audit_event()', t);
    end if;
  end loop;
end $$;

-- One-off backfill so the module shows history immediately. Actor is unknown where the original record never stored one.
do $$
begin
  if not exists (select 1 from public.audit_log) then
    insert into public.audit_log(occurred_at, actor_id, actor_name, actor_role, action, table_name, record_id, record_label, summary, changed_fields, new_data, source)
    select sh.changed_at, sh.changed_by, coalesce(pr.full_name, pr.email), pr.role, 'UPDATE', 'repair_jobs', sh.job_id::text,
           coalesce(j.cro_number, 'Job #' || j.job_number), 'Updated job card ' || coalesce(j.cro_number, 'Job #' || j.job_number) || ' — status → ' || sh.status::text,
           array['status'], jsonb_build_object('status', sh.status::text), 'backfill'
    from public.status_history sh join public.repair_jobs j on j.id = sh.job_id left join public.profiles pr on pr.id = sh.changed_by
    where sh.job_id is not null;

    insert into public.audit_log(occurred_at, actor_id, actor_name, actor_role, action, table_name, record_id, record_label, summary, new_data, source)
    select p.created_at, p.created_by, coalesce(pr.full_name, pr.email), pr.role, 'INSERT', 'invoice_payments', p.id::text,
           p.payment_method || ' ' || p.amount, 'Created payment ' || p.payment_method || ' ' || p.amount || ' on INV-' || lpad(i.invoice_number::text, 5, '0'), to_jsonb(p), 'backfill'
    from public.invoice_payments p join public.invoices i on i.id = p.invoice_id left join public.profiles pr on pr.id = p.created_by;

    insert into public.audit_log(occurred_at, action, table_name, record_id, record_label, summary, new_data, source)
    select r.issued_at, 'INSERT', 'receipts', r.id::text, 'Receipt #' || r.receipt_number, 'Created receipt #' || r.receipt_number, to_jsonb(r), 'backfill' from public.receipts r;

    insert into public.audit_log(occurred_at, action, table_name, record_id, record_label, summary, new_data, source)
    select i.issued_at, 'INSERT', 'invoices', i.id::text, 'INV-' || lpad(i.invoice_number::text, 5, '0'), 'Created invoice INV-' || lpad(i.invoice_number::text, 5, '0'), to_jsonb(i), 'backfill' from public.invoices i;

    insert into public.audit_log(occurred_at, action, table_name, record_id, record_label, summary, new_data, source)
    select e.created_at, 'INSERT', 'expenses', e.id::text, e.category || ' — ' || coalesce(e.description, ''), 'Created expense ' || e.category || ' — ' || coalesce(e.description, ''), to_jsonb(e), 'backfill' from public.expenses e;

    insert into public.audit_log(occurred_at, actor_id, actor_name, actor_role, action, table_name, record_id, record_label, summary, new_data, source)
    select c.confirmed_at, c.confirmed_by, coalesce(pr.full_name, pr.email), pr.role, 'INSERT', 'job_condition_reports', c.id::text, coalesce(c.inspection_no, c.vehicle_registration),
           'Confirmed vehicle checklist ' || coalesce(c.inspection_no, c.vehicle_registration), to_jsonb(c) - 'report', 'backfill'
    from public.job_condition_reports c left join public.profiles pr on pr.id = c.confirmed_by where c.confirmed_at is not null;

    insert into public.audit_log(occurred_at, action, table_name, record_id, record_label, summary, new_data, source)
    select r.restocked_at, 'INSERT', 'restocks', r.id::text, r.part_name, 'Created stock purchase ' || r.part_name || ' × ' || r.quantity, to_jsonb(r), 'backfill' from public.restocks r;
  end if;
end $$;
