-- Record the historical vouchers that were backfilled before their first audit event.
insert into public.credit_voucher_audit(voucher_id,voucher_code,action,details,performed_by)
select v.id,v.voucher_code,'issued',
  jsonb_build_object(
    'credit_note_type',v.credit_note_type,
    'credit_note_id',v.credit_note_id,
    'expires_at',v.expires_at,
    'backfilled',true
  ),
  v.created_by
from public.customer_credit_vouchers v
where not exists (
  select 1 from public.credit_voucher_audit a
  where a.voucher_id=v.id and a.action in ('issued','backfilled')
);
