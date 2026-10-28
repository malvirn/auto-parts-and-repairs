begin;

alter table public.parts
  add column if not exists minimum_stock numeric(10, 2) not null default 0;

alter table public.parts
  drop constraint if exists parts_minimum_stock_check;

alter table public.parts
  add constraint parts_minimum_stock_check check (minimum_stock >= 0);

alter table public.quotations
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists fault_reported text;

alter table public.quotation_items
  alter column quantity type numeric(10, 2) using quantity::numeric;

alter table public.sales_order_items
  alter column quantity type numeric(10, 2) using quantity::numeric;

alter table public.repair_jobs
  add column if not exists work_ready boolean not null default false;

update public.repair_jobs
set work_ready = true
where status in ('Ready for Pickup', 'Unclaimed', 'Collected');

create table if not exists public.repair_job_payments (
  id uuid primary key default gen_random_uuid(),
  repair_job_id uuid not null references public.repair_jobs(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('Cash', 'Card', 'Bank transfer', 'Mobile money', 'Other')),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.repair_job_payments enable row level security;
alter table public.receipts enable row level security;

drop policy if exists "Authenticated users can read repair job payments" on public.repair_job_payments;
create policy "Authenticated users can read repair job payments"
  on public.repair_job_payments for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can record repair job payments" on public.repair_job_payments;
create policy "Authenticated users can record repair job payments"
  on public.repair_job_payments for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "Level 2 can update cumulative repair receipts" on public.receipts;
create policy "Level 2 can update cumulative repair receipts"
  on public.receipts for update
  to authenticated
  using (public.current_access_level() >= 2)
  with check (public.current_access_level() >= 2);

commit;
