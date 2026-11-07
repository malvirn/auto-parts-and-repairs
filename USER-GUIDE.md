# Auto Parts & Repairs — User Guide

For vehicle checklists, add inspection notes as needed and explicitly select a condition—including “No damage”—for every listed area before confirming.

This guide explains the application as it works today. Your role determines which pages you can see. If a page is missing or access is denied, ask your Super Admin to check your account; do not try to work around the access controls.

The repair quotation, payment, and stock-threshold workflow requires the SQL migration `supabase/migrations/repair-quotations-payments-stock.sql` to be applied in Supabase before using the updated screens. Apply `supabase/migrations/customer-account-statement-view.sql` to display customer balances and carry-forward credit. Apply `supabase/migrations/customer-archive-labour-mode.sql` to enable customer archiving/restoration and provider-estimated or time-tier labour charges. Apply `supabase/migrations/receipt-credit-notes.sql` before `supabase/migrations/receipt-voiding.sql`; these migrations enable credit notes and audited receipt reversal. For Quick Sale payment methods and discounts on customer account statements, apply `supabase/migrations/customer-invoice-payments.sql` and `supabase/migrations/receipt-voiding.sql` first, then apply `supabase/migrations/quick-sale-payment-discounts.sql`. Then apply `supabase/migrations/quick-sale-customer-credit-and-payments.sql` for Bank/EcoCash sales, customer-account sales, and later account payments.

For vehicle drop-off checklists, apply `supabase/migrations/vehicle-condition-checklist.sql` after `supabase/access-control.sql` and the customer, vehicle, and repair-job tables exist. Open **Workshop → Vehicle Checklist** and enter the customer name, vehicle registration, inspector name, odometer, and fuel level; no customer or vehicle record is needed to save a checklist. Choose a condition for each vehicle area, then confirm the checklist. Confirmed checklists awaiting job cards appear in the **Job Cards** list and can be found by filtering for checklist number, customer, or registration. Select one to open a new job card prefilled with the checklist number, customer, registration, fuel, and odometer. If the customer or vehicle is not registered, the job-card flow creates the missing record from the checklist; enter a phone number for a new customer and make, model, year, chassis, and engine details for a new vehicle. Complete the fault and work information and create the job card; it will be linked to the checklist. Each checklist receives a unique sequential number starting at 1000. The number appears on the checklist, job card, receipt, and invoice; print the checklist from its detail view. Registration, fuel, and odometer are read-only on the job card; edit them from the linked checklist using **Open checklist to edit details**. Confirm the checklist again to sync its drop-off values and registration to the job card and vehicle record. Checklists can be deleted from the list or detail view. In **Analytics**, search a checklist number to see its customer, vehicles, checklists, job cards, invoices, sales orders, receipts, payments, parts, and account-statement entries.

After `supabase/migrations/repair-quotations-payments-stock.sql`, `supabase/migrations/repair-jobs-phase5.sql`, `supabase/migrations/customer-invoice-payments.sql`, `supabase/migrations/customer-invoice-repair-job-link.sql`, `supabase/migrations/receipt-credit-notes.sql`, `supabase/migrations/receipt-voiding.sql`, and `supabase/migrations/quick-sale-customer-credit-and-payments.sql` are installed, apply `supabase/migrations/workflow-integrity-fixes.sql`. If Quick Sale checkout is enabled, apply `supabase/migrations/quick-sale-atomic-checkout.sql` first as well. This migration aligns Accounting access checks, validates invoice amounts against their lines, keeps linked invoices synchronized with repair-job items and payments, makes quotation amendments and sales-order/stock updates atomic, enforces catalogue prices on Quick Sale lines, and avoids double-counting linked job invoices in customer balances.

Apply `supabase/migrations/job-card-close-and-quotation-vehicle-details.sql` to support the additional vehicle details on quotations. Apply `supabase/migrations/job-card-daily-updates-accounting-parts.sql` after the repair-job and job-parts tables exist. It enables job-card closure details and the Accounting queue for typed-in job parts; the job card now keeps only optional “Other mechanical findings” and does not use a daily-update form. After `supabase/migrations/customer-invoice-payments.sql`, apply `supabase/migrations/customer-invoice-repair-job-link.sql` to link customer invoices to repair jobs; Accounting will then be notified when a closed job is awaiting an invoice. To send receipts, invoices, quotations, or sales orders automatically by email, deploy the `send-receipt-email` Edge Function and configure `RESEND_API_KEY` and `RECEIPT_FROM_EMAIL`; if sending is unavailable, the application opens an email draft and downloads the PDF for manual attachment.

For typed-in job-part purchasing, first apply `supabase/migrations/job-card-daily-updates-accounting-parts.sql`, `supabase/migrations/shop-part-details-vat.sql`, and `supabase/migrations/shop-restock-payables.sql`, then apply `supabase/migrations/job-part-purchase-requests.sql`. A typed-in part on a new job card enters the Shop request queue. Shop records supplier contact details and the quoted unit cost; Accounting records the actual payment date and active Cash or Bank account, which posts the purchase to the ledger. Shop can then email the supplier and receive the delivery into existing or new inventory. New inventory items use the configured 5% VAT rate and require a selling price. The received item is linked to the job card, and the existing Accounting job-part pricing queue remains available.

For Quick Sale, apply `supabase/migrations/quick-sale-atomic-checkout.sql` after `supabase/migrations/quick-sale-customer-credit-and-payments.sql`. This ensures the required Cash (1000), Bank/Swipe (1010), EcoCash (1020), Accounts Receivable (1100), and Parts Sales Revenue (4100) accounts are active, then makes stock deduction, sale items, ledger posting, and payment recording one transaction; failed checkouts leave no partial order or stock change. If an earlier version of this migration is already applied and checkout reports a required account is missing or inactive, run the updated migration again.

For Cash Book daily drawer reconciliation and staff cash advances, first apply `supabase/migrations/repair-quotations-payments-stock.sql`, `supabase/migrations/customer-invoice-payments.sql`, `supabase/migrations/receipt-voiding.sql`, `supabase/migrations/quick-sale-payment-discounts.sql`, and `supabase/migrations/quick-sale-customer-credit-and-payments.sql`, then apply `supabase/migrations/cashbook-daily-reconciliation-advances.sql`.

For the Payables workflow, apply `supabase/migrations/shop-restock-payables.sql`, then `supabase/migrations/payable-payment-reversals.sql`, then `supabase/migrations/supplier-payables-workflow.sql`. The last migration adds atomic bill/payment posting and auditable bill voiding; apply it before using the updated Payables form.

For duplicate protection on quotation-to-order conversion, active receipts, and monthly payroll, apply `supabase/migrations/business-action-idempotency.sql` after `supabase/migrations/receipt-voiding.sql` and after the sales-order and payroll tables exist. The migration checks for existing duplicate records and stops without changing them if any are found; review and resolve those records before retrying it.

For configurable monthly payroll and individual payslips, apply `supabase/migrations/business-action-idempotency.sql` first, then `supabase/migrations/staff-payroll-payslips.sql` after the `payroll_runs`, `payroll_payments`, and `profiles` tables exist. Payroll on Employees & Staff requires a fresh Super Admin password confirmation. Enter one-off bonuses and overtime hours for each run; overtime is calculated as monthly salary ÷ 208 × 1.5 × hours. Payslips can be printed, or opened as an email draft or WhatsApp message; the last two actions require a recorded employee email address or phone number and do not send automatically.

## 1. Sign in and get around

1. Open the hosted HTTPS application and go to **Sign In**. Do not open `login.html` directly from disk (`file://`); browser security blocks or limits the Supabase connection. For local testing, run `python -m http.server 8000` from the project root and visit `http://localhost:8000/login.html`.
2. Enter the email and password for your authorized staff account, then select **Sign In**.
3. Use the left navigation to open a section. On a narrow screen, use the menu button to open navigation.
4. Start from **Dashboard** for today's activity, recent repair jobs, and items needing attention. Select an attention item to open the relevant page.
5. Use **Settings → Account** to check your role, request a password-reset email, or sign out.

The staff session is tied to the current browser session. If you close the browser and return later, you may need to sign in again.

## 2. Know your access

- **Super Admin:** full system access, including staff access controls and salary-related information.
- **Accounting:** accounting pages and analytics, without access to customer/vehicle information or salary details.
- **Staff:** day-to-day operating work such as customers, repairs, shop, and receipts; financial pages are restricted.

The actual pages available are controlled by your assigned account role and database permissions. Contact a Super Admin when your work requires a page you cannot open.

## 3. The everyday repair workflow

### A. Add or find the customer

1. Open **Customers**.
2. Enter the customer's name, customer type, and phone in the displayed format (`+263 00 000 0000`).
3. Optionally enter a Gmail address and the vehicle's license plate.
4. Select **Add Customer**.
5. Check the customer directory before creating another record. If the phone number or email is already registered, the system treats the submission as a returning customer and can add the entered plate to that customer's vehicles.

Use the customer form to register each vehicle's plate, body type, make, model, year, chassis number, and engine number. Submitting another vehicle with the same phone/email adds it to the existing customer's record instead of creating a duplicate customer.

### B. Open a repair job

1. Open **Job Cards** and choose an existing customer or enter a new one. For a new record, select **Individual** or **Company**; company job cards can also record the representative who brought in the vehicle.
2. Select a registered vehicle or enter a new vehicle's plate, make, model, year, body type, chassis number, and engine number. These details are saved to the vehicle and filled in the next time it is selected.
3. Record the odometer reading at drop-off when available.
4. Write the customer's reported concern clearly and factually, then choose **Create a quotation first** or **Open a draft job card directly**. A quotation-first intake saves the customer and vehicle, opens the quotation form with those details, and does not create a job card.
5. To open a job card after a quotation, use **Open Job Card** beside that quotation, confirm the vehicle details, and submit the intake. The new job starts as **Draft**.
6. Close the job card to return to the workshop queue. Use its search field and mechanic/customer-type filters to narrow the list. The assigned mechanic and their active job count are shown.

When creating or editing a job card, make, model, year, body type, chassis number, and engine number can be changed and are saved to the selected vehicle record. Registration, fuel at drop-off, and odometer at drop-off stay read-only on the job card; change these through its linked vehicle checklist. The customer's phone and email can be entered or updated in the form; changes are saved to the selected customer record when the job card is created. Choose a configured time-based rate or enter a provider-estimated labour amount. Add inventory parts (stock is deducted when the job is created) or type in a part that is not in the catalogue. Typed-in parts are not billed until Accounting prices them in **Ledger → Typed-in Job Parts Awaiting Price**.

### C. Diagnose, assign, and price the work

1. Select **View Details** on the repair order to open its job card. The job card highlights the customer, vehicle identifiers, assigned mechanic, reported concern, and current repair status.
2. Record the mechanic's inspection findings in **Technician Findings / Diagnosis** and, if useful, an expected diagnostic-completion time. The cause-suggestion tool uses these findings (not only the customer's reported concern), requires findings to be entered first, and provides suggestions only; verify them yourself.
3. Choose either **Time-based rate tier** and enter hours, or **Provider-estimated task price** and enter the task estimate. Configure hourly rates in **Settings → Vehicle Labour Rates**. The selected labour method and amount appear on the job card and flow through to its quotation.
4. Add parts from the shop catalogue and set the quantity. Stock is updated when parts are attached to a job. Add a workshop supply with a description and amount when appropriate.
5. Save the repair order. The displayed ZiG amount is an estimate based on the configured exchange rate.

### D. Keep the job current and close it correctly

1. Open a job card to review its status, work done, work still missing, and parts used. The selected inventory part's description is shown on the job card.
2. Save a daily update note whenever changing work details or status. Active cards with no update today are marked **Needs daily update**; this is a reminder, not a block on other actions.
3. Use **Close job card** only when work is complete. Enter who tested the vehicle and the next checkup mileage; confirming the modal changes the status to **Ready for Pickup**. Mark the vehicle **Collected** only after it has actually been handed over.
4. Job cards do not record payments. Use the accounting/ledger workflow for customer billing and payments. **Create invoice** is available only when the job has an outstanding balance; invoice details are prefilled from the job card. Typed-in parts must be priced by Accounting before an invoice can be created.
5. Use **WhatsApp update** to tell the customer the current job status. For more detailed updates (such as diagnosis/approval, parts delays, pickup readiness, or service reminders), verify the customer contact and message before sending.

### E. Issue and share a receipt

1. Open **Receipts** to search by customer name, receipt number, phone, or reference, and narrow the list by date. Open a receipt or invoice to print, download a PDF, or share it.
2. WhatsApp sharing opens WhatsApp Web or the installed app with a customer message. Where the browser supports file sharing, select the PDF attachment; otherwise attach the downloaded PDF manually in WhatsApp.
3. Email sharing sends the PDF when the email function is deployed and configured. If it is unavailable, an email draft opens and the downloaded PDF must be attached before sending.
4. Accounting users and Super Admins can void an incorrect receipt by entering a reason and confirming the in-page modal. Voiding preserves the receipt with a red **VOID** mark and excludes its amount from financial totals; it does not record a cash refund, so handle any actual refund separately.

After creating a quotation, use the sharing modal to print, download a PDF, send by WhatsApp, or email it. Check the highlighted missing customer/vehicle details before sending.

## 4. Customers and the public repair-status portal

### Customer records

The **Customers** page stores individual/company contacts and complete vehicle details. Use consistent phone numbers and check for an existing record before adding someone. A repeat phone or email is treated as the same customer, and another plate is added as an additional vehicle. Archive customers rather than permanently deleting them; use **View archived customers** to review records and **Restore** to return a customer to active lists. Archived customers' historical records remain available.

### Customer portal

1. Open or share the customer portal link (`portal.html`).
2. The customer enters the phone number used at drop-off and the vehicle's license plate, then selects **Check status**.
3. The portal displays the matched job's status, vehicle, estimated total, and available status timeline. It does not provide staff-only repair fields.
4. If the lookup fails, check the phone number and plate against the customer and vehicle records. For changes to repair details, staff must update the job in the staff application.

Staff can also share the portal link provided by a repair job when available. Treat customer-specific links and contact information as private.

## 5. Parts shop and sales

### Manage inventory

1. Open **Shop** to check low-stock alerts, best sellers, reorder suggestions, stock totals, and the parts catalogue. You can search the catalogue by part number, model, description, or category.
2. To add inventory, complete **Add Part** with the part name, optional part number, category, opening quantity, configured low-stock minimum, and unit cost. The selling price is calculated using the configured markup.
3. Optionally link one or more suppliers; mark the preferred supplier where applicable. Add a relevant part photo if useful.
4. Search the catalogue by part number, model, description, or category. Use the part's edit/restock actions to correct details or record a stock purchase.
5. For a restock, type a new supplier name or choose a saved supplier, then enter quantity and unit cost. Add the supplier's email to save it with a new supplier record and use **Email parts order** to compose an order request. After saving a purchase, choose whether to print its receipt on a standard or thermal printer.
6. The markup rate applies to new parts and edits. **Apply to All Existing Parts** changes prices across existing inventory, so review the rate before using it.
7. The admin dashboard and Shop alert when a part reaches or falls below 10% of its configured minimum. Set each part's minimum in its add/edit form; a minimum of zero disables that alert.

### Quick Sale

1. In **Shop → Quick Sale**, search for the part, select it, and enter the quantity.
2. Optionally select a salesperson and choose a registered customer. Use the walk-in name field for an unregistered walk-in customer.
3. Choose **Cash** (default), **EcoCash**, **Bank**, or **Swipe** for immediate payment. Or choose **Buy on credit** and select an active registered customer. Credit sales are not capped by a credit limit.
4. Enter a discount if applicable, check the calculated total, and select **Complete Sale**.
5. Paid sales create a receipt and post to the matching Cash, EcoCash, or Bank account. Credit sales deduct stock, post a customer receivable, and appear as outstanding in **Ledger → Customer Accounts**. Expand the customer's open items and choose **Record payment** to accept later Cash, EcoCash, or Bank installments. Payments reduce the account balance and post to the ledger. Walk-in sales cannot be put on credit.

### Suppliers

Open **Suppliers** to add or edit supplier contact details, search the directory, or export supplier records to CSV. Keep these details accurate because they are used when recording purchases and payables.

## 6. Quotations and sales orders

1. From repair intake, choose quotation-first to carry the selected customer, vehicle, and reported fault into a new quote. You can also open **Quotations** and choose a repair job/vehicle, a registered customer/vehicle, or a walk-in customer.
2. Choose **Time-based rate tier** and hours, or **Provider-estimated task price**, then select **Add Labour**. Job-card labour details carry into the quotation. Add parts at their current Shop selling prices and quantities. Enter each sundry price and select **Add Sundry** as needed. Check the quotation total in USD and ZiG.
3. Select **Save Quotation**. Use **Amend** on the issued quotation to review, print, or share its customer-facing copy, or **Open Job Card** to continue into job intake after approval. A quotation is valid for seven days.
4. When the customer approves, use the available quotation/order actions to confirm or convert the work into a sales order. Confirming an order deducts stock; review the items and quantities first.
5. Review sales orders in the **Sales Orders** list. Use the order actions to inspect or amend a record. A confirmed order has a receipt; find it from **Receipts**.

## 7. Team, analytics, and payroll

- **Team / Mechanics:** authorized users can maintain staff/technician records and related team details. Individual salary information is restricted to Super Admins. A mechanic may be assigned to multiple active jobs; each repair order identifies its assigned mechanic.
- **Analytics:** review performance summaries, live workshop state, capacity/workforce/inventory figures, financial summaries, revenue trends, top mechanics/parts, and turnaround time.
- **Payroll:** an authorized user can review the monthly payroll panel and select **Process This Month's Payroll**. The system's payroll run records the calculation and related accounting entries; it is not a bank transfer. Verify employee and commission data before processing, and check recent payroll runs to avoid duplicating work.
- **Commissions** (under Accounting): set the technician and salesperson percentage rates, save them, then scan for new commissions. Review generated records. Commission generation and payroll processing affect financial records.

## 8. Accounting tools

Open **Accounting** to reach these role-restricted tools. These records feed a shared general ledger, so use the correct date, account, supplier, amount, and reference.

- **Ledger:** maintain the chart of accounts, post journal entries, and review the Trial Balance. Journal entry debits must equal credits before posting. Price typed-in job parts in the prominent **Typed-in Job Parts Awaiting Price** queue before invoicing. Use **Customer Details & History** at the top to search customers by name, contact, or vehicle plate; select a customer to review their vehicles, quotations, job cards, parts, sales, invoices, receipts, payments, and account balance.
- **Payables:** type a supplier name or select a saved supplier; a new name is added to the supplier directory, and the system generates the bill number. Click a bill row to expand its details and payment history. Record full or partial payments, then open the payment history to print a receipt. Overdue bills are flagged in the page and notifications. To void a manual bill, first reverse every payment; the bill remains in the audit history and a reversing ledger entry is posted. Stock-linked bills must be reversed with their stock purchase, not voided separately.
- **Cash Book:** allocate dated cash/bank movements to the appropriate account and category. Select a Zimbabwe business date to review cash flow, Cash on Hand drawer transactions, and petty-cash activity. At close, enter the physical drawer count to save an audit reconciliation; cash Quick Sales and non-voided cash job payments are included. Record staff cash advances and repayments here; the outstanding balance is tracked separately from petty cash.
- **Landed Cost:** record a shipment, its parts and quantities, and related freight/insurance/other costs. Review allocation across the parts before saving; it updates inventory quantity and landed unit cost.
- **Fixed Assets:** register equipment with purchase date, cost, payment account, salvage value, and useful life. Review monthly straight-line depreciation. Use the disposal action only when the asset has actually been disposed of, and enter the true date and proceeds.
- **Statements:** choose the reporting period and refresh Profit & Loss; choose an as-of date and refresh the Balance Sheet. Review any balance/integrity messages rather than treating an unbalanced statement as correct.

If you are not responsible for bookkeeping, do not post or amend journal entries, payables, cash movements, payroll, depreciation, or other accounting records. Ask your accounting role or Super Admin for help.

## 9. Settings and access control

- **Appearance:** turn dark mode on or off for this browser.
- **About Us:** maintain the business name, tagline, contact details, and hours shown by the application.
- **Notifications:** use the bell/notification area for issues such as overdue bills or pickups, low stock, expiring contracts, low petty cash, and ledger integrity. The Settings tab lists recent notifications; it is not a configuration panel.
- **Currency & Rates:** authorized users can update the USD-to-ZiG rate. This affects converted displays and new documents; check the rate before quoting or reviewing totals.
- **Account:** send a password-reset email or sign out.
- **Job cards:** Super Admins can permanently delete a job card from the Job Cards list by selecting its trash button and typing **DELETE**. Catalog parts attached to the job are returned to stock; the job and its payment history cannot be restored.
- **Access Control:** Super Admins can change another user's role, reversibly terminate/reactivate access, or permanently delete a login. Role changes require the Super Admin's password again. Deleting a login has no undo.

## 10. Good habits: do's and don'ts

### Do

- Check the customer, phone, vehicle plate, chassis, engine, dates, quantities, and prices before saving.
- Search existing customer, part, supplier, job, receipt, and order records before adding a new one.
- Record what was actually reported, diagnosed, fitted, paid, received, or handed over.
- Keep job status, diagnosis, mechanic assignment, labour, and parts current so the dashboard and reports remain useful.
- Check stock and supplier invoices before restocking or confirming a parts sale.
- Review a quotation with the customer before confirming the sales order.
- Verify the exchange rate and totals before sending customer-facing documents.
- Check the receipt/ledger/history after a financial or stock-changing action.
- Sign out on shared computers and contact a Super Admin when access or account status is wrong.

### Don't

- Don't share your password, leave an authorized account open on a shared device, or send customer portal links to anyone other than the intended customer.
- Don't create duplicate customers to work around an existing phone/email match.
- Don't invent missing vehicle identifiers, diagnosis details, odometer readings, payment dates, or financial amounts.
- Don't add parts to a job, restock inventory, confirm a sale, or apply a broad markup update without checking the quantity and price; these actions affect stock or customer totals.
- Don't mark a vehicle **Collected** until it has actually been handed over. Collection is a one-way close-out action and locks normal job editing. A job that is only **Ready for Pickup** is not yet collected.
- Don't apply a parking fee without checking the overdue calculation and applicable shop policy.
- Don't assume a quotation is a confirmed sale, a receipt is proof of a bank transfer, or a payroll run has paid employees.
- Don't process payroll or post accounting transactions unless you are authorized and have checked the source records.
- Don't use permanent user deletion casually; it cannot be undone.
- Don't treat optional AI-suggested diagnostic causes as a verified diagnosis.

## 11. If something does not work

1. Read the on-screen message; required fields and valid formats are shown on the relevant form.
2. Check your connection and whether your account is still active.
3. Confirm you have the right role for the page or action.
4. For a missing record, check the customer/vehicle relationship and search for an existing record before retrying a create action.
5. For financial or stock changes, do not repeatedly submit if the result is uncertain. Check the relevant receipt, ledger, order, stock, or history page first.
6. If the error remains, provide the page name and exact error message to the system administrator. Do not send passwords or private customer details in an error report.
