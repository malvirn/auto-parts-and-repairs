create or replace function public.consume_part_stock(p_part_id uuid, p_quantity integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_updated integer;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'You are not authorised to consume workshop stock.';
  end if;
  if p_part_id is null or p_quantity is null or p_quantity < 1 then return false; end if;
  update public.parts set quantity_in_stock = quantity_in_stock - p_quantity
  where id = p_part_id and quantity_in_stock >= p_quantity;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

create or replace function public.restore_part_stock(p_part_id uuid, p_quantity integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_updated integer;
begin
  if auth.uid() is null or coalesce(public.current_access_level(), 0) < 1 then
    raise exception 'You are not authorised to restore workshop stock.';
  end if;
  if p_part_id is null or p_quantity is null or p_quantity < 1 then return false; end if;
  update public.parts set quantity_in_stock = quantity_in_stock + p_quantity where id = p_part_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

revoke all on function public.consume_part_stock(uuid, integer) from public, anon;
grant execute on function public.consume_part_stock(uuid, integer) to authenticated;
revoke all on function public.restore_part_stock(uuid, integer) from public, anon;
grant execute on function public.restore_part_stock(uuid, integer) to authenticated;
