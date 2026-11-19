-- These helpers are internal: trigger invocation and SECURITY DEFINER callers do not need client EXECUTE grants.
revoke all on function public.audit_manual_bank_rate_change() from public, anon, authenticated;
revoke all on function public.get_manual_usd_zig_rate() from public, anon, authenticated;
