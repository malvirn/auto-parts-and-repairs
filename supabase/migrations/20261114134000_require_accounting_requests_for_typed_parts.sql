-- Ensure every manually entered job-card part enters the Shop/Accounting
-- purchase-request workflow, including parts priced from an approved quotation.
create or replace function public.enqueue_job_part_purchase_request()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.part_id is null then
    insert into public.job_part_purchase_requests(job_part_id)
    values(new.id) on conflict(job_part_id) do nothing;
  end if;
  return new;
end;
$$;

insert into public.job_part_purchase_requests(job_part_id)
select jp.id from public.job_parts jp
where jp.part_id is null
on conflict(job_part_id) do nothing;

create or replace function public.get_repair_job_close_readiness(
  p_job_id uuid,p_work_complete boolean default false,
  p_qc_signed_by text default null,p_customer_signed_by text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  j public.repair_jobs%rowtype;
  v_work boolean; v_checklist boolean; v_parts boolean; v_no_pending boolean;
  v_invoice_paid boolean; v_qc boolean; v_customer boolean; v_checks jsonb;
begin
  select * into j from public.repair_jobs where id=p_job_id;
  if not found then raise exception 'Job card not found'; end if;
  v_work:=coalesce(p_work_complete,false)
    and nullif(trim(coalesce(j.work_done,'')),'') is not null
    and nullif(trim(coalesce(j.work_missing,'')),'') is null;
  v_checklist:=exists(select 1 from public.job_condition_reports c
    where c.job_id=p_job_id and c.voided_at is null
      and (c.confirmed_at is not null or (c.status='completed' and c.completed_at is not null)));
  v_parts:=not exists(select 1 from public.job_parts jp
    where jp.job_id=p_job_id and (
      jp.awaiting_accounting_price or jp.price_at_time is null or jp.price_at_time<=0
      or exists(select 1 from public.job_part_purchase_requests r
        where r.job_part_id=jp.id and (r.status<>'received' or r.released_at is null))
      or (jp.part_id is null and not exists(select 1 from public.job_part_purchase_requests r
        where r.job_part_id=jp.id and r.status='received' and r.released_at is not null))
    ));
  v_no_pending:=not exists(select 1 from public.job_part_purchase_requests r
    join public.job_parts jp on jp.id=r.job_part_id
    where jp.job_id=p_job_id and r.status in ('requested','awaiting_accounting'));
  v_invoice_paid:=exists(select 1 from public.invoices i where i.repair_job_id=p_job_id) and (
    coalesce((select sum(rp.amount) from public.repair_job_payments rp where rp.repair_job_id=p_job_id and rp.voided_at is null),0)
    + greatest(0,coalesce((select sum(ip.amount) from public.invoice_payments ip join public.invoices i on i.id=ip.invoice_id where i.repair_job_id=p_job_id and ip.voided_at is null),0)
      -coalesce((select sum(oc.amount) from public.customer_overpayment_credits oc join public.invoice_payments ip on ip.id=oc.invoice_payment_id join public.invoices i on i.id=ip.invoice_id where i.repair_job_id=p_job_id and ip.voided_at is null),0))
    +coalesce((select sum(cm.amount) from public.customer_credit_movements cm where cm.target_type='repair_job' and cm.target_id=p_job_id and cm.movement_type='application' and cm.reversed_at is null),0)
    +coalesce((select sum(cm.amount) from public.customer_credit_movements cm join public.invoices i on i.id=cm.target_id where i.repair_job_id=p_job_id and cm.target_type='invoice' and cm.movement_type='application' and cm.reversed_at is null),0)
    +coalesce((select sum(l.applied_amount) from public.customer_overpayment_credit_job_links l where l.repair_job_id=p_job_id and l.applied_amount>0),0)
  )>=greatest(coalesce(j.total_cost,0),coalesce((select sum(i.total) from public.invoices i where i.repair_job_id=p_job_id),0));
  v_qc:=nullif(trim(coalesce(p_qc_signed_by,'')),'') is not null or (j.qc_signed_at is not null and nullif(trim(coalesce(j.qc_signed_by,'')),'') is not null);
  v_customer:=nullif(trim(coalesce(p_customer_signed_by,'')),'') is not null or (j.customer_signed_at is not null and nullif(trim(coalesce(j.customer_signed_by,'')),'') is not null);
  v_checks:=jsonb_build_array(
    jsonb_build_object('key','work_complete','label','All work/tasks completed and no outstanding work remains','ok',v_work),
    jsonb_build_object('key','checklist','label','Vehicle checklist completed and confirmed','ok',v_checklist),
    jsonb_build_object('key','parts_issued','label','All parts priced, funded and issued/received','ok',v_parts),
    jsonb_build_object('key','no_pending_parts','label','No pending or unapproved parts requests','ok',v_no_pending),
    jsonb_build_object('key','invoice_paid','label','Invoice generated and fully paid, or approved customer credit applied','ok',v_invoice_paid),
    jsonb_build_object('key','qc_signoff','label','Final inspection / QC signed off','ok',v_qc),
    jsonb_build_object('key','customer_signoff','label','Customer sign-off recorded','ok',v_customer)
  );
  return jsonb_build_object('can_close',v_work and v_checklist and v_parts and v_no_pending and v_invoice_paid and v_qc and v_customer,'checks',v_checks);
end; $$;
