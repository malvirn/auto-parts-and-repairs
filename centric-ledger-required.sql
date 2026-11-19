-- Centric Auto Mobile: General Ledger payment metadata and lookup indexes.
-- Safe to run more than once. Existing payment/accounting RPCs remain unchanged.

ALTER TABLE public.repair_job_payments
  ADD COLUMN IF NOT EXISTS payment_method text;

COMMENT ON COLUMN public.repair_job_payments.payment_method IS
  'Tender selected at collection time (Cash, Card/POS, EcoCash, Bank Transfer, Other).';

CREATE INDEX IF NOT EXISTS idx_job_parts_job_id
  ON public.job_parts (job_id);

CREATE INDEX IF NOT EXISTS idx_job_parts_waiting_accounting_price
  ON public.job_parts (job_id)
  WHERE awaiting_accounting_price IS TRUE;

CREATE INDEX IF NOT EXISTS idx_repair_job_payments_repair_job_id
  ON public.repair_job_payments (repair_job_id);

CREATE INDEX IF NOT EXISTS idx_invoices_repair_job_id
  ON public.invoices (repair_job_id);
