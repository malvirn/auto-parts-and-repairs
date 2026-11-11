-- Restrict inspection SECURITY DEFINER RPCs to signed-in staff.
revoke all on function public.complete_vehicle_inspection(uuid) from public, anon;
grant execute on function public.complete_vehicle_inspection(uuid) to authenticated;

revoke all on function public.reopen_vehicle_inspection(uuid,text) from public, anon;
grant execute on function public.reopen_vehicle_inspection(uuid,text) to authenticated;

-- Trigger-only function. It must not be callable through the Data API.
revoke all on function public.require_completed_vehicle_inspection_for_job() from public, anon, authenticated;
