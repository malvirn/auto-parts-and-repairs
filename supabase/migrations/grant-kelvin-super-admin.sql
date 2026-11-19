begin;

-- This SQL editor role cannot change table ownership or RLS policies.
-- Configure RLS in the Supabase Dashboard under Authentication > Policies.
-- Use the UUID from Supabase Authentication > Users because auth.users
-- is intentionally protected from direct SQL Editor access.
insert into public.profiles (
  id,
  full_name,
  role,
  access_level
)
values (
  '3be4fc9d-1044-40f3-a8cc-f3744812cfd4'::uuid,
  'Kelvin Gomo',
  'super_admin',
  2
)
on conflict (id) do update
set role = 'super_admin',
    access_level = 2;

do $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = '3be4fc9d-1044-40f3-a8cc-f3744812cfd4'::uuid
      and lower(role) = 'super_admin'
      and access_level >= 2
  ) then
    raise exception 'Super Admin profile was not updated';
  end if;
end $$;

commit;
