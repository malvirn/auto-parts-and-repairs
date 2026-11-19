-- Sales orders and their line items are visible only to active Centric staff.
drop policy if exists sales_orders_select_all on public.sales_orders;
drop policy if exists sales_order_items_select_all on public.sales_order_items;

create policy sales_orders_active_staff_read
on public.sales_orders for select to authenticated
using (coalesce(public.current_access_level(), 0) >= 1);

create policy sales_order_items_active_staff_read
on public.sales_order_items for select to authenticated
using (coalesce(public.current_access_level(), 0) >= 1);
