-- Allow operational users to open the receipt for a Quick Sale they have just completed.
-- The receipt page reads quick_sale_payments to resolve the journal-entry receipt link.
-- Keep access restricted to signed-in staff; do not expose payment rows to anon users.
drop policy if exists "Accounting users can view quick sale payments" on public.quick_sale_payments;
create policy "Operational users can view quick sale payments"
on public.quick_sale_payments
for select
to authenticated
using (public.current_access_level() >= 1);
