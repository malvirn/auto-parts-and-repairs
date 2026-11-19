-- payroll_runs_unique already enforces one run per year/month.
drop index if exists public.payroll_runs_year_month_uidx;
