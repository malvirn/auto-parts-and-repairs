alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['super_admin', 'workshop', 'accounting', 'staff']::text[]));
