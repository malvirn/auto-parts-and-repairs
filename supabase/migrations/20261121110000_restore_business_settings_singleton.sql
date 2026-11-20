begin;

-- The app expects one settings row. Restore the default singleton only when
-- it is missing; never overwrite a business profile that already exists.
insert into public.business_settings (
  id, business_name, tagline, vat_registered, vat_rate, fdms_status
)
values (
  1, 'Centric Auto Mobile', 'Professional Vehicle Service', false, 15.5, 'not_configured'
)
on conflict (id) do nothing;

commit;
