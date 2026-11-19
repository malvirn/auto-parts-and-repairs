begin;

create or replace function public.admin_delete_repair_job(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected integer;
begin
  if auth.uid() is null or not public.is_current_user_super_admin() then
    raise exception 'Only a Super Admin can delete job cards'
      using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'Choose a valid job card to delete';
  end if;

  perform 1
  from public.repair_jobs
  where id = p_id
  for update;

  if not found then
    raise exception 'The selected job card no longer exists';
  end if;

  update public.parts as part
  set quantity_in_stock = part.quantity_in_stock + used.quantity
  from (
    select part_id, sum(quantity) as quantity
    from public.job_parts
    where job_id = p_id
      and part_id is not null
    group by part_id
  ) as used
  where part.id = used.part_id;

  delete from public.repair_jobs
  where id = p_id;
  get diagnostics affected = row_count;

  if affected = 0 then
    raise exception 'The selected job card could not be deleted';
  end if;

  return jsonb_build_object(
    'success', true,
    'deleted_id', p_id
  );
end;
$$;

revoke all on function public.admin_delete_repair_job(uuid) from public, anon;
grant execute on function public.admin_delete_repair_job(uuid) to authenticated;

commit;
