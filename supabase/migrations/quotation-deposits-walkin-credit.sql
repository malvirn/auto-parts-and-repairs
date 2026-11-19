begin;
alter table public.quotation_deposit_receipts alter column customer_id drop not null;
commit;