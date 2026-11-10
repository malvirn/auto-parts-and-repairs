-- Final security audit: remove development/anonymous table access and enforce role checks.
begin;

-- Unknown, missing, and anonymous users have no application access level.
create or replace function public.current_access_level()
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce((
    select case
      when lower(coalesce(profile.role, '')) in ('super_admin', 'superadmin', 'accounting')
        then greatest(coalesce(profile.access_level, 1), 2)
      when lower(coalesce(profile.role, '')) = 'staff'
        then greatest(coalesce(profile.access_level, 1), 1)
      else 0
    end
    from public.profiles as profile
    where profile.id = auth.uid()
  ), 0);
$$;

-- Harden helper/trigger functions against search_path substitution.
alter function public.is_admin() set search_path = pg_catalog, public;
alter function public.is_accounting_or_above() set search_path = pg_catalog, public;
alter function public.is_operational() set search_path = pg_catalog, public;
alter function public.is_super_admin() set search_path = pg_catalog, public;
alter function public.log_status_change() set search_path = pg_catalog, public;
alter function public.check_journal_balance() set search_path = pg_catalog, public;
alter function public.handle_new_user() set search_path = pg_catalog, public;
alter function public.check_mechanic_availability() set search_path = pg_catalog, public;
alter function public.generate_cro_number() set search_path = pg_catalog, public;
alter function public.record_repair_status() set search_path = pg_catalog, public;
alter function public.lookup_repair_portal(text,text,integer,text) set search_path = pg_catalog, public;

-- Remove development policies that allowed unauthenticated reads/writes.
drop policy if exists "anon full access business_settings" on public.business_settings;
drop policy if exists "Allow anon insert" on public.customers;
drop policy if exists "Allow anon select" on public.customers;
drop policy if exists "Allow anon delete" on public.expenses;
drop policy if exists "Allow anon insert" on public.expenses;
drop policy if exists "Allow anon select" on public.expenses;
drop policy if exists "Allow anon update" on public.expenses;
drop policy if exists "anon full access notifications" on public.notifications;
drop policy if exists "Local development can manage quotation items" on public.quotation_items;
drop policy if exists "Local development can manage quotations" on public.quotations;
drop policy if exists "Allow anon insert" on public.repair_jobs;
drop policy if exists "Allow anon select" on public.repair_jobs;
drop policy if exists "Allow all updates for now" on public.repair_jobs;
drop policy if exists "Local development can manage restocks" on public.restocks;
drop policy if exists "Local development can read restocks" on public.restocks;
drop policy if exists "anon full access restocks" on public.restocks;
drop policy if exists "Local development can manage sales order items" on public.sales_order_items;
drop policy if exists "Local development can manage sales orders" on public.sales_orders;
drop policy if exists "Allow anon select" on public.settings;
drop policy if exists "Allow anon update" on public.settings;
drop policy if exists "Allow anon insert" on public.status_history;
drop policy if exists "Allow anon select" on public.status_history;
drop policy if exists "Allow insert for anon" on public.suppliers;
drop policy if exists "Allow insert for anon (dev only)" on public.suppliers;
drop policy if exists "Allow read for anon (dev only)" on public.suppliers;
drop policy if exists "Local development can manage suppliers" on public.suppliers;
drop policy if exists "Local development can read suppliers" on public.suppliers;
drop policy if exists "anon full access suppliers" on public.suppliers;
drop policy if exists "Allow anon insert" on public.technicians;
drop policy if exists "Allow anon select" on public.technicians;
drop policy if exists "Allow anon insert" on public.vehicles;
drop policy if exists "Allow anon select" on public.vehicles;

-- The portal uses lookup_repair_portal(), not direct anonymous table access.
revoke all on public.technician_directory from public, anon;
grant select on public.technician_directory to authenticated;

-- Role-specific access: job cards are readable by signed-in staff/accounting,
-- but only operational staff and super admins can change them.
drop policy if exists "Authenticated full access" on public.repair_jobs;
create policy repair_jobs_authenticated_read
  on public.repair_jobs for select to authenticated
  using (auth.uid() is not null);

-- Customer records are operationally managed; accounting gets read-only
-- access needed for customer account statements.
drop policy if exists "Authenticated full access" on public.customers;
create policy customers_accounting_read
  on public.customers for select to authenticated
  using (public.current_access_level() >= 2);

-- Vehicle details stay with operational staff and super admins.
drop policy if exists "Authenticated full access" on public.vehicles;

-- Full employee records and payroll-related details are super-admin only.
drop policy if exists "Authenticated full access" on public.technicians;
drop policy if exists "Level 2 can manage technicians" on public.technicians;

-- Receipts remain readable/creatable by signed-in staff and accounting;
-- corrections are handled by the existing accounting-only policies/RPCs.
drop policy if exists "Authenticated full access" on public.receipts;

-- Status history is read-only through the API; its trigger records changes.
drop policy if exists "Authenticated full access" on public.status_history;

-- Inventory is available to operational staff; accounting retains the
-- existing Level 2 stock access needed by landed-cost workflows.
drop policy if exists "parts_any_authenticated" on public.parts;
create policy parts_operational_access
  on public.parts for all to authenticated
  using (public.is_operational())
  with check (public.is_operational());

drop policy if exists "job_parts_any_authenticated" on public.job_parts;

-- Quotes are operational records, not unrestricted authenticated write targets.
drop policy if exists "Allow all for authenticated users" on public.quotations;
drop policy if exists "Allow all for authenticated users" on public.quotation_items;
create policy quotations_operational_access
  on public.quotations for all to authenticated
  using (public.is_operational())
  with check (public.is_operational());
create policy quotation_items_operational_access
  on public.quotation_items for all to authenticated
  using (public.is_operational())
  with check (public.is_operational());

-- Invoices and credit notes are financial records. Staff must use the
-- authorised workflow/RPCs rather than unrestricted direct table writes.
drop policy if exists "staff manage invoices" on public.invoices;
drop policy if exists "staff all" on public.credit_notes;
drop policy if exists "staff all" on public.credit_note_items;
drop policy if exists "staff manage condition reports" on public.job_condition_reports;

-- Credit balances, credit movements, refunds, and quotation deposits are
-- financial information and are visible only to Accounting/Super Admin.
drop policy if exists "Staff can view customer credit movements" on public.customer_credit_movements;
create policy customer_credit_movements_accounting_read
  on public.customer_credit_movements for select to authenticated
  using (public.current_access_level() >= 2);

drop policy if exists "Staff can view quotation deposit receipts" on public.quotation_deposit_receipts;
create policy quotation_deposit_receipts_accounting_read
  on public.quotation_deposit_receipts for select to authenticated
  using (public.current_access_level() >= 2);

drop policy if exists customer_overpayment_credit_notes_read on public.customer_overpayment_credit_notes;
create policy customer_overpayment_credit_notes_accounting_read
  on public.customer_overpayment_credit_notes for select to authenticated
  using (public.current_access_level() >= 2);

drop policy if exists customer_overpayment_credit_job_links_read on public.customer_overpayment_credit_job_links;
create policy customer_overpayment_credit_job_links_accounting_read
  on public.customer_overpayment_credit_job_links for select to authenticated
  using (public.current_access_level() >= 2);

drop policy if exists customer_overpayment_credit_refunds_read on public.customer_overpayment_credit_refunds;
create policy customer_overpayment_credit_refunds_accounting_read
  on public.customer_overpayment_credit_refunds for select to authenticated
  using (public.current_access_level() >= 2);

-- Payroll data is restricted to Super Admin, not the general Accounting role.
drop policy if exists "Payroll runs are visible to accounting and super admins" on public.payroll_runs;
create policy payroll_runs_super_admin_read
  on public.payroll_runs for select to authenticated
  using (public.is_admin());

-- Restore authenticated-only access for tables that previously depended on
-- local-development policies. No anonymous access is required by the portal.
create policy business_settings_authenticated_read
  on public.business_settings for select to authenticated
  using (public.current_access_level() >= 1);
create policy business_settings_super_admin_update
  on public.business_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy settings_authenticated_read
  on public.settings for select to authenticated
  using (public.current_access_level() >= 1);
create policy settings_super_admin_update
  on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy notifications_authenticated_access
  on public.notifications for all to authenticated
  using (public.current_access_level() >= 1)
  with check (public.current_access_level() >= 1);

create policy expenses_accounting_access
  on public.expenses for all to authenticated
  using (public.current_access_level() >= 2)
  with check (public.current_access_level() >= 2);

create policy restocks_authenticated_access
  on public.restocks for all to authenticated
  using (public.current_access_level() >= 1)
  with check (public.current_access_level() >= 1);

create policy suppliers_authenticated_access
  on public.suppliers for all to authenticated
  using (public.current_access_level() >= 1)
  with check (public.current_access_level() >= 1);

-- Only Super Admins can manage employee leave records.
create policy employee_off_days_super_admin_access
  on public.employee_off_days for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Trigger functions are not API endpoints. Remove direct RPC execution.
revoke all on function public.generate_customer_code() from public, anon, authenticated;
revoke all on function public.record_repair_status() from public, anon, authenticated;

commit;
