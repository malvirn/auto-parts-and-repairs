begin;

do $$
begin
  if exists (
    select 1
    from public.sales_orders
    where quotation_id is not null
    group by quotation_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate sales orders already exist for one or more quotations. Resolve those records before applying business-action-idempotency.sql.';
  end if;

  if exists (
    select 1
    from public.receipts
    where repair_job_id is not null and voided_at is null
    group by repair_job_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate active receipts already exist for one or more repair jobs. Resolve those records before applying business-action-idempotency.sql.';
  end if;

  if exists (
    select 1
    from public.receipts
    where sales_order_id is not null and voided_at is null
    group by sales_order_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate active receipts already exist for one or more sales orders. Resolve those records before applying business-action-idempotency.sql.';
  end if;

  if exists (
    select 1
    from public.payroll_runs
    group by year, month
    having count(*) > 1
  ) then
    raise exception 'Duplicate payroll runs already exist for one or more months. Resolve those records before applying business-action-idempotency.sql.';
  end if;
end
$$;

create unique index if not exists sales_orders_quotation_id_uidx
  on public.sales_orders(quotation_id)
  where quotation_id is not null;

create unique index if not exists receipts_active_repair_job_uidx
  on public.receipts(repair_job_id)
  where repair_job_id is not null and voided_at is null;

create unique index if not exists receipts_active_sales_order_uidx
  on public.receipts(sales_order_id)
  where sales_order_id is not null and voided_at is null;

create unique index if not exists payroll_runs_year_month_uidx
  on public.payroll_runs(year, month);

commit;
