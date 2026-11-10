-- Keep Super Admin separate from Accounting, including destructive RPCs.
begin;

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
      and coalesce(profile.is_active, true)
  ), 0);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(replace(replace(coalesce(p.role,''),'-','_'),' ','_')) in ('super_admin','superadmin')
      and coalesce(p.is_active,true)
  );
$$;

create or replace function public.is_current_user_super_admin()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(replace(replace(coalesce(p.role,''),'-','_'),' ','_')) in ('super_admin','superadmin')
      and coalesce(p.is_active,true)
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.is_current_user_super_admin();
$$;

create or replace function public.is_accounting_or_above()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role,'')) in ('accounting','super_admin','superadmin')
      and coalesce(p.is_active,true)
  );
$$;

create or replace function public.is_operational()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role,'')) in ('staff','super_admin','superadmin')
      and coalesce(p.is_active,true)
  );
$$;

-- Preserve the existing scoped-wipe implementation, but place a strict
-- Super Admin-only RPC in front of it. The unchecked internal name is revoked.
alter function public.wipe_business_data(text[], text) rename to wipe_business_data_unchecked;
revoke all on function public.wipe_business_data_unchecked(text[], text) from public, anon, authenticated;

create or replace function public.wipe_business_data(p_groups text[], p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_current_user_super_admin() then
    raise exception 'Only an active Super Admin can wipe business data'
      using errcode = '42501';
  end if;
  return public.wipe_business_data_unchecked(p_groups, p_confirmation);
end;
$$;

revoke all on function public.wipe_business_data(text[], text) from public, anon;
grant execute on function public.wipe_business_data(text[], text) to authenticated;

-- Disable the old unrestricted all-data wipe endpoint. Use the scoped,
-- typed-confirmation Super Admin workflow instead.
revoke all on function public.wipe_business_data() from public, anon, authenticated;

commit;
