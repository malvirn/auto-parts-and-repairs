begin;

alter table public.invoices
  alter column vat_rate set default 5,
  alter column vat_rate set not null;

update public.invoices
set
  vat_rate = 5,
  subtotal = greatest(0, round(coalesce(subtotal, 0), 2)),
  total = round(
    greatest(
      0,
      greatest(0, round(coalesce(subtotal, 0), 2))
      - least(greatest(0, round(coalesce(discount, 0), 2)), greatest(0, round(coalesce(subtotal, 0), 2)))
    ) * 1.05,
    2
  ),
  status = case
    when coalesce(amount_paid, 0) >= round(
      greatest(
        0,
        greatest(0, round(coalesce(subtotal, 0), 2))
        - least(greatest(0, round(coalesce(discount, 0), 2)), greatest(0, round(coalesce(subtotal, 0), 2)))
      ) * 1.05,
      2
    ) - 0.005 then 'paid'
    else case when coalesce(amount_paid, 0) > 0 then 'partially_paid' else 'unpaid' end
  end
where true;

commit;
