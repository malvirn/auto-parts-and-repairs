# Auto Parts & Repairs

Auto Parts & Repairs is a browser-based workshop and parts-management system. Staff use it to manage customers, vehicles, repair jobs, parts sales, receipts, suppliers, reporting, and (for authorized roles) accounting.

## User instructions

See the complete step-by-step [User Guide](USER-GUIDE.md). It covers the staff workflows, the customer repair-status portal, accounting tools, role permissions, and practical do's and don'ts.

The same guide is linked from **Settings → User Guide** in the application.

## Running the application

The application is built from static HTML, CSS, and JavaScript pages and uses Supabase for authentication and data. Open the deployed application URL and sign in with an authorized staff account. For local development, serve the repository through a local web server rather than opening HTML files directly; browser module and network requests may not work correctly from a `file:` URL.

## Administrator setup

The Supabase project, database migrations, authentication users, and access policies must be configured before staff can use the application. Review the files under `supabase/` and apply the appropriate migrations and access-control setup to the intended Supabase project. Apply `supabase/migrations/vehicle-rate-tiers-archive.sql` to enable archiving labour rates while preserving links from existing repair orders. Do not commit passwords or other private credentials.

## Main entry points

- `login.html` — staff sign-in
- `index.html` — staff dashboard
- `portal.html` — customer repair-status lookup
- `pages/` — operational and accounting screens
