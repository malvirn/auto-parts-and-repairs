begin;

-- Grant full application access to the named authorized account.
-- Run this in the project's Supabase SQL editor after confirming the Auth user exists.
insert into public.profiles (id, full_name, role, access_level)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', 'Malvirn Gomo'),
  'super_admin',
  2
from auth.users
where email = 'malvirngomo8@gmail.com'
on conflict (id) do update
set role = 'super_admin',
    access_level = 2;

commit;
