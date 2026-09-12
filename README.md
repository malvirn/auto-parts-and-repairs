# Computer Repair Management System (CRMS)

Phase 1 scaffold â€” core repair workflow + status lifecycle + basic reporting.

## Structure
- `index.html` â€” dashboard
- `pages/` â€” customers, repairs, receipts pages
- `css/style.css` â€” shared styling (Inter font, warm neutral palette)
- `js/supabaseClient.js` â€” Supabase connection (add your project URL + anon key)
- `js/app.js` â€” shared logic (icon rendering, nav)
- `js/customers.js`, `js/repairs.js`, `js/receipts.js` â€” module-specific Supabase queries (to fill in)
- `pages/suppliers.html`, `js/suppliers.js` â€” supplier contacts and restock purchasing history

## Next steps
1. Create a free project at https://supabase.com
2. In `js/supabaseClient.js`, replace `SUPABASE_URL` and `SUPABASE_ANON_KEY` with your project's values (Project Settings > API).
3. In Supabase, create tables matching the entities in the proposal: customers, devices, repair_jobs, parts, repair_job_parts, technicians, status_history.
	Run the supplier/restock section in `supabase/access-control.sql` to create `suppliers`, `restocks`, and `parts.supplier_id`.
4. Open `index.html` directly in your browser, or serve the folder with a simple local server (e.g. VS Code "Live Server" extension) to avoid CORS issues with fetch calls.
5. Icons are from Lucide (https://lucide.dev) â€” loaded via CDN, no install needed. Browse available icon names there and use `<i data-lucide="icon-name"></i>`.

## Staff login
- Email: `malvirngomo8@gmail.com`
- Configure the password directly in Supabase Auth. Do not commit passwords to this README or the repository.

## Customer portal
- Open `portal.html` or share a copied portal link from a repair job's staff edit modal.
- Run `supabase/access-control.sql` in the Supabase SQL Editor before using the portal.
- The portal lookup returns only the matched customer's vehicle, status, estimated total, and status timeline. Staff-only fields remain excluded.

## Status lifecycle (for reference)
Received -> Diagnosing -> Awaiting Parts -> In Repair -> Ready for Pickup -> Completed / Unclaimed
