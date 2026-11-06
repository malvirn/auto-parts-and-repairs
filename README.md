# Auto Parts & Repairs

Auto Parts & Repairs is a browser-based workshop and parts-management system. Staff use it to manage customers, vehicles, repair jobs, parts sales, receipts, suppliers, reporting, and (for authorized roles) accounting.

## User instructions

See the complete step-by-step [User Guide](USER-GUIDE.md). It covers the staff workflows, the customer repair-status portal, accounting tools, role permissions, and practical do's and don'ts.

The same guide is linked from **Settings → User Guide** in the application.

## Running the application

The application is built from static HTML, CSS, and JavaScript pages and uses Supabase for authentication and data. Open the deployed application URL and sign in with an authorized staff account. For local development, serve the repository through a local web server rather than opening HTML files directly; browser module and network requests may not work correctly from a `file:` URL.

## Administrator setup

The Supabase project, database migrations, authentication users, and access policies must be configured before staff can use the application. Review the files under `supabase/` and apply the appropriate migrations and access-control setup to the intended Supabase project. Apply `supabase/migrations/customer-archive-labour-mode.sql` to enable reversible customer archiving and the two repair labour pricing modes. Apply `supabase/migrations/repair-quotations-payments-stock.sql` and `supabase/migrations/customer-account-statement-view.sql` for repair payments and customer balances, including carry-forward credit. Apply `supabase/migrations/vehicle-rate-tiers-archive.sql` to enable archiving labour rates while preserving links from existing repair orders. Apply `supabase/migrations/shop-part-details-vat.sql` to enable part descriptions and VAT rates in Shop. Apply `supabase/migrations/shop-part-number.sql` to add optional part numbers to the Shop inventory. Apply `supabase/migrations/quotation-labour-sundries.sql` to store quotation and sales-order line types for labour, parts, and sundries. Apply `supabase/migrations/part-history-delete.sql` to allow obsolete parts to be deleted while keeping their purchasing history and part-name snapshots. Apply `supabase/migrations/receipt-credit-notes.sql` to enable credit notes and optional inventory restocking from issued receipts. Apply `supabase/migrations/customer-invoice-payments.sql` and `supabase/migrations/receipt-voiding.sql` before `supabase/migrations/quick-sale-payment-discounts.sql` to enable Quick Sale payment methods and discounts in the customer ledger and receipts. `supabase/clear-database.sql` is an optional destructive reset script for the Supabase SQL Editor. It clears rows from tables in the `public` schema only, without `CASCADE`, and is not run by the application. Review the script and your table relationships before execution. Do not commit passwords or other private credentials.

For Quick Sale, apply `supabase/migrations/quick-sale-atomic-checkout.sql` after `supabase/migrations/quick-sale-customer-credit-and-payments.sql` to make the checkout an atomic database transaction.

For Cash Book daily drawer reconciliation and staff cash advances, apply `repair-quotations-payments-stock.sql`, `customer-invoice-payments.sql`, `receipt-voiding.sql`, `quick-sale-payment-discounts.sql`, and `quick-sale-customer-credit-and-payments.sql` before `cashbook-daily-reconciliation-advances.sql`.

For Quick Sale Bank/EcoCash payments and customer credit with later installment payments, apply `customer-archive-labour-mode.sql`, `repair-quotations-payments-stock.sql`, `customer-invoice-payments.sql`, `receipt-voiding.sql`, and `quick-sale-payment-discounts.sql` before `quick-sale-customer-credit-and-payments.sql`.

Customers are archived with a `deleted_at` timestamp and can be restored from the archived-customer list; their historical jobs and account entries are retained. Bulk deletion for other supported records remains destructive and requires typing `DELETE`. All actions remain subject to the signed-in user's existing database policies. Generated records and login accounts continue to use their source-specific deletion and reauthentication flows.

## Main entry points

- `login.html` — staff sign-in
- `index.html` — staff dashboard
- `portal.html` — customer repair-status lookup
- `pages/` — operational and accounting screens
