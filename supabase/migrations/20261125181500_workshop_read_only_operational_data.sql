-- Give active workshop users read-only access to the operational records
-- needed to look up customers, vehicles, parts, job parts and quotations.
-- This does not grant INSERT, UPDATE or DELETE on any of these tables.
-- Existing staff/admin policies and role helpers remain unchanged.

begin;

drop policy if exists customers_workshop_read_only on public.customers;
create policy customers_workshop_read_only
on public.customers
for select
to authenticated
using (public.is_workshop());

drop policy if exists vehicles_workshop_read_only on public.vehicles;
create policy vehicles_workshop_read_only
on public.vehicles
for select
to authenticated
using (public.is_workshop());

drop policy if exists parts_workshop_read_only on public.parts;
create policy parts_workshop_read_only
on public.parts
for select
to authenticated
using (public.is_workshop());

drop policy if exists job_parts_workshop_read_only on public.job_parts;
create policy job_parts_workshop_read_only
on public.job_parts
for select
to authenticated
using (public.is_workshop());

drop policy if exists quotations_workshop_read_only on public.quotations;
create policy quotations_workshop_read_only
on public.quotations
for select
to authenticated
using (public.is_workshop());

drop policy if exists quotation_items_workshop_read_only on public.quotation_items;
create policy quotation_items_workshop_read_only
on public.quotation_items
for select
to authenticated
using (public.is_workshop());

commit;
