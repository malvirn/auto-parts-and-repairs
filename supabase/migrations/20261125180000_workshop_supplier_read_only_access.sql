-- Workshop can view supplier contact details for repair and parts coordination.
-- This deliberately does not change current_access_level() or is_operational().
-- Supplier writes remain limited to the existing staff/admin policies.

begin;

create or replace function public.is_workshop()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role, '')) = 'workshop'
      and coalesce(p.is_active, true)
  );
$function$;

revoke all on function public.is_workshop() from public;
revoke all on function public.is_workshop() from anon;
grant execute on function public.is_workshop() to authenticated;

drop policy if exists suppliers_workshop_read_only on public.suppliers;
create policy suppliers_workshop_read_only
on public.suppliers
for select
to authenticated
using (public.is_workshop());

comment on function public.is_workshop() is
  'Returns true only for an active authenticated workshop profile; does not grant operational or accounting access.';

commit;
