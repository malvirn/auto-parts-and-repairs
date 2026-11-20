begin;

-- The business_settings row is the single source of truth for the current
-- business VAT rate. Existing invoices, quotations and credit notes retain
-- their own stored vat_rate snapshots.
alter table public.business_settings
  alter column vat_rate set default 15.5;

alter table public.business_settings
  drop constraint if exists business_settings_vat_rate_check,
  add constraint business_settings_vat_rate_check
    check (vat_rate >= 0 and vat_rate <= 100);

-- Keep VAT changes behind the existing Super Admin boundary.
alter table public.business_settings enable row level security;
drop policy if exists business_settings_super_admin_update on public.business_settings;
create policy business_settings_super_admin_update
  on public.business_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
