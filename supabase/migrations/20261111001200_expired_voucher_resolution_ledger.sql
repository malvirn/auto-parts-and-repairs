create table if not exists public.credit_voucher_expiry_resolutions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.customer_credit_vouchers(id),
  credit_note_type text not null check (credit_note_type in ('quotation_deposit','invoice_overpayment')),
  credit_note_id uuid not null,
  decision text not null check (decision in ('refund','move_to_income')),
  amount numeric(12,2) not null check (amount>0),
  account_id uuid not null references public.accounts(id),
  journal_entry_id uuid not null references public.journal_entries(id),
  reason text not null,
  performed_by uuid not null references auth.users(id),
  performed_at timestamptz not null default now()
);
create index if not exists credit_voucher_expiry_resolutions_voucher_idx
  on public.credit_voucher_expiry_resolutions(voucher_id,performed_at desc);
alter table public.credit_voucher_expiry_resolutions enable row level security;
drop policy if exists credit_voucher_expiry_resolutions_staff_read on public.credit_voucher_expiry_resolutions;
create policy credit_voucher_expiry_resolutions_staff_read on public.credit_voucher_expiry_resolutions
  for select to authenticated using (public.current_access_level()>=1);
grant select on public.credit_voucher_expiry_resolutions to authenticated;
revoke insert,update,delete on public.credit_voucher_expiry_resolutions from anon,authenticated;
