-- Tighten operational access to sales, receipts, suppliers and confirmed checklists.
-- Preserve existing role-aware operational policies and draft-only checklist edits.

drop policy if exists "Allow all for authenticated users" on public.sales_orders;
drop policy if exists "Allow all for authenticated users" on public.sales_order_items;

drop policy if exists "Allow delete for authenticated users" on public.suppliers;
drop policy if exists "Allow insert for authenticated users" on public.suppliers;
drop policy if exists "Allow read for authenticated users" on public.suppliers;
drop policy if exists "Allow update for authenticated users" on public.suppliers;

drop policy if exists "Authenticated staff can update vehicle condition reports" on public.job_condition_reports;
drop policy if exists "Authenticated staff can delete vehicle condition reports" on public.job_condition_reports;

drop policy if exists "Authenticated users can create receipts" on public.receipts;
drop policy if exists "Authenticated users can read receipts" on public.receipts;

create policy "Active staff can create receipts"
on public.receipts for insert to authenticated
with check (coalesce(public.current_access_level(), 0) >= 1);

create policy "Active staff can read receipts"
on public.receipts for select to authenticated
using (coalesce(public.current_access_level(), 0) >= 1);
