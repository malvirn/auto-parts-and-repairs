-- ============================================================
-- FULL DATA RESET — irreversible. Keeps table structure, RLS policies,
-- and functions exactly as they are; deletes every row. Re-seeds the
-- Chart of Accounts and Commission Rates afterward since every
-- accounting feature looks those up by code and would otherwise break
-- immediately after this runs.
--
-- REQUIRED BEFORE RUNNING: replace 'YOUR_EMAIL_HERE' below with your own
-- login email — that account is the only one that survives this script.
-- Every other login (including any test accounts, other staff, or
-- accountants you added) is permanently deleted.
-- ============================================================

-- ---- 1. Wipe every business/transactional table ----
-- Guarded per-table so this runs cleanly even if some phase was never
-- deployed to this database — a missing table is skipped, not fatal.
do $$
declare
  t text;
begin
  foreach t in array array[
    'job_parts', 'receipts', 'quotations', 'sales_order_items', 'sales_orders',
    'repair_jobs', 'vehicles', 'customers',
    'part_suppliers', 'restocks', 'parts', 'suppliers',
    'employee_off_days', 'technicians',
    'depreciation_entries', 'fixed_assets',
    'purchase_shipment_items', 'purchase_shipments',
    'commissions', 'commission_rates',
    'payable_payments', 'payables',
    'petty_cash_settings',
    'journal_lines', 'journal_entries', 'accounts',
    'payroll_payments', 'payroll_runs'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('truncate table public.%I cascade', t);
      raise notice 'Truncated %', t;
    else
      raise notice 'Skipped % — table does not exist', t;
    end if;
  end loop;
end $$;

-- ---- 2. Delete every login except the one you specify ----
-- profiles cascades automatically when its matching auth.users row is
-- deleted, so this one delete handles both tables correctly.
delete from auth.users
where email <> 'YOUR_EMAIL_HERE';

-- ---- 3. Re-seed the Chart of Accounts — every accounting feature looks
--      these up by code, so the app needs them to exist to function.
--      Matches exactly what Phases 1, 3, and 6 originally seeded. ----
insert into public.accounts (code, name, type, normal_balance) values
  ('1000', 'Cash on Hand', 'asset', 'debit'),
  ('1010', 'Bank Account', 'asset', 'debit'),
  ('1050', 'Petty Cash Float', 'asset', 'debit'),
  ('1100', 'Accounts Receivable', 'asset', 'debit'),
  ('1200', 'Parts Inventory', 'asset', 'debit'),
  ('1300', 'Tools and Equipment', 'asset', 'debit'),
  ('1310', 'Accumulated Depreciation', 'asset', 'credit'),
  ('2000', 'Accounts Payable', 'liability', 'credit'),
  ('2100', 'Wages Payable', 'liability', 'credit'),
  ('2200', 'Tax Payable', 'liability', 'credit'),
  ('3000', 'Owner''s Equity', 'equity', 'credit'),
  ('3100', 'Retained Earnings', 'equity', 'credit'),
  ('4000', 'Repair Service Revenue', 'revenue', 'credit'),
  ('4100', 'Parts Sales Revenue', 'revenue', 'credit'),
  ('4200', 'Gain on Disposal of Assets', 'revenue', 'credit'),
  ('5000', 'Cost of Parts Sold', 'expense', 'debit'),
  ('5100', 'Wages Expense', 'expense', 'debit'),
  ('5200', 'Rent Expense', 'expense', 'debit'),
  ('5300', 'Utilities Expense', 'expense', 'debit'),
  ('5400', 'Depreciation Expense', 'expense', 'debit'),
  ('5500', 'Bank Charges', 'expense', 'debit'),
  ('5600', 'Miscellaneous Expense', 'expense', 'debit'),
  ('5700', 'Loss on Disposal of Assets', 'expense', 'debit')
on conflict (code) do nothing;

-- ---- 4. Re-seed default commission rates ----
insert into public.commission_rates (role, rate_pct) values
  ('technician', 5.00),
  ('salesperson', 3.00)
on conflict (role) do nothing;

-- ---- 5. Re-seed the petty cash float target ----
insert into public.petty_cash_settings (target_float)
select 100.00
where not exists (select 1 from public.petty_cash_settings);

-- ============================================================
-- After running: log out and back in. Your account should still work
-- and still be Super Admin. Everything else — every customer, job,
-- part, supplier, employee, and every dollar ever posted to the ledger
-- — is gone.
-- ============================================================
