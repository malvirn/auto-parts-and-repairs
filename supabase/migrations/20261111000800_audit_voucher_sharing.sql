
create or replace function public.log_credit_voucher_event(p_voucher_id uuid,p_action text)
returns void language plpgsql security definer
set search_path=public,pg_temp
as $$
declare v public.customer_credit_vouchers%rowtype; uid uuid:=auth.uid();
begin
  if uid is null or public.current_access_level()<1 then raise exception 'Authorised staff access is required' using errcode='42501'; end if;
  if p_action not in ('printed','whatsapp_shared') then raise exception 'Unsupported voucher event'; end if;
  select * into v from public.customer_credit_vouchers where id=p_voucher_id;
  if not found then raise exception 'Voucher not found'; end if;
  insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
  values(v.id,v.voucher_code,p_action,jsonb_build_object('status',v.status),uid);
end;
$$;

revoke all on function public.log_credit_voucher_event(uuid,text) from public, anon;
grant execute on function public.log_credit_voucher_event(uuid,text) to authenticated;
