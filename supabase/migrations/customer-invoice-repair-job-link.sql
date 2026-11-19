begin;

alter table public.invoices
  add column if not exists repair_job_id uuid references public.repair_jobs(id) on delete set null;

with invoice_job_matches as (
  select
    invoice.id as invoice_id,
    job.id as job_id,
    count(*) over (partition by invoice.id) as invoice_match_count,
    count(*) over (partition by job.id) as job_match_count
  from public.invoices invoice
  join public.repair_jobs job
    on split_part(btrim(invoice.reference), ' · ', 1) =
      coalesce(nullif(btrim(job.cro_number), ''), 'JC-' || lpad(job.job_number::text, 5, '0'))
  where invoice.repair_job_id is null
    and invoice.reference is not null
)
update public.invoices invoice
set repair_job_id = matches.job_id
from invoice_job_matches matches
where invoice.id = matches.invoice_id
  and matches.invoice_match_count = 1
  and matches.job_match_count = 1;

create unique index if not exists invoices_repair_job_id_uidx
  on public.invoices(repair_job_id)
  where repair_job_id is not null;

commit;
