drop policy if exists suppliers_authenticated_access on public.suppliers;
create policy suppliers_active_staff_read
on public.suppliers for select to authenticated
using (coalesce(public.current_access_level(), 0) >= 1);
create policy suppliers_active_staff_insert
on public.suppliers for insert to authenticated
with check (coalesce(public.current_access_level(), 0) >= 1);
create policy suppliers_active_staff_update
on public.suppliers for update to authenticated
using (coalesce(public.current_access_level(), 0) >= 1)
with check (coalesce(public.current_access_level(), 0) >= 1);
create policy suppliers_admin_delete
on public.suppliers for delete to authenticated
using (coalesce(public.current_access_level(), 0) >= 2);
