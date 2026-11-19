begin;

-- Inventory mutation helpers are only used by signed-in workshop staff.
revoke all on function public.consume_part_stock(uuid, integer) from public, anon;
grant execute on function public.consume_part_stock(uuid, integer) to authenticated;
revoke all on function public.restore_part_stock(uuid, integer) from public, anon;
grant execute on function public.restore_part_stock(uuid, integer) to authenticated;

-- Financial reversal/refund RPCs must never be callable by anonymous visitors.
revoke all on function public.refund_overpayment_credit(uuid, numeric, uuid, date, text) from public, anon;
grant execute on function public.refund_overpayment_credit(uuid, numeric, uuid, date, text) to authenticated;
revoke all on function public.reverse_payable_payment(uuid, text) from public, anon;
grant execute on function public.reverse_payable_payment(uuid, text) to authenticated;
revoke all on function public.wipe_business_data(text[], text) from public, anon;
grant execute on function public.wipe_business_data(text[], text) to authenticated;

-- These functions are invoked by database triggers, not directly through the API.
revoke all on function public.reverse_cancelled_quick_sale() from public, anon, authenticated;
revoke all on function public.sync_repair_job_invoice_paid_amount() from public, anon, authenticated;
revoke all on function public.validate_quick_sale_catalog_price() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
