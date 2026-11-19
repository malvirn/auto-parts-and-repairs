begin;

alter table public.business_settings
  add column if not exists vat_registered boolean not null default false,
  add column if not exists vat_rate numeric(5,2) not null default 15.5,
  add column if not exists vat_number text,
  add column if not exists fdms_device_id text,
  add column if not exists fdms_status text not null default 'not_configured';

alter table public.business_settings
  drop constraint if exists business_settings_vat_rate_check,
  add constraint business_settings_vat_rate_check
    check (vat_rate >= 0 and vat_rate <= 100),
  drop constraint if exists business_settings_vat_number_required_check,
  add constraint business_settings_vat_number_required_check
    check (not vat_registered or nullif(btrim(vat_number), '') is not null),
  drop constraint if exists business_settings_fdms_status_check,
  add constraint business_settings_fdms_status_check
    check (fdms_status in ('not_configured', 'pending', 'active', 'suspended'));

commit;