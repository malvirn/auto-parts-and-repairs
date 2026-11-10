-- Restrict internal role-check helpers to signed-in sessions.
-- RLS policies call these functions after authentication; anonymous callers
-- must not be able to invoke the SECURITY DEFINER helpers directly.
revoke execute on function public.current_access_level() from public, anon;
revoke execute on function public.is_accounting_or_above() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_operational() from public, anon;
revoke execute on function public.is_super_admin() from public, anon;

-- Customer tracking remains available to anonymous users through its
-- verification inputs (phone, registration, job number and portal token).
grant execute on function public.lookup_repair_portal(text,text,integer,text) to anon, authenticated;
