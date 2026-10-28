# Auto Parts & Repairs — User Guide

This guide explains the application as it works today. Your role determines which pages you can see. If a page is missing or access is denied, ask your Super Admin to check your account; do not try to work around the access controls.

The repair quotation, payment, and stock-threshold workflow requires the SQL migration `supabase/migrations/repair-quotations-payments-stock.sql` to be applied in Supabase before using the updated screens.

## 1. Sign in and get around

1. Open the application and go to **Sign In**.
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

1. Open **Repair Jobs** and choose an existing customer or register a new one in the intake form.
2. Select a registered vehicle or register a new vehicle. When registering, enter its plate, make, model, year, body type, chassis number, and engine number; these details will be available for auto-fill later.
3. Record the fuel level and odometer at drop-off when available.
4. Write the customer's reported concern clearly and factually, then choose **Create a quotation first** or **Open a draft job card directly**. A quotation-first intake saves the customer and vehicle, opens the quotation form with those details, and does not create a job card.
5. To open a job card after a quotation, use **Open Job Card** beside that quotation, confirm the vehicle details, and submit the intake. The new job starts as **Draft**.
6. Close the job card to return to the workshop queue. Use its search field and mechanic/customer-type filters to narrow the list. The assigned mechanic and their active job count are shown.

### C. Diagnose, assign, and price the work

1. Select **View Details** on the repair order to open its job card. The job card highlights the customer, vehicle identifiers, assigned mechanic, reported concern, and current repair status.
2. Record the mechanic's inspection findings in **Technician Findings / Diagnosis** and, if useful, an expected diagnostic-completion time. The cause-suggestion tool uses these findings (not only the customer's reported concern), requires findings to be entered first, and provides suggestions only; verify them yourself.
3. Select the appropriate vehicle labour rate and enter hours worked. Configure hourly rates in **Settings → Vehicle Labour Rates**. Labour is calculated from the selected rate and hours; verify the resulting amount. Labour and parts cost can also be edited directly. Archive rates you no longer use; archived rates remain linked to past repair orders and can be restored later.
4. Add parts from the shop catalogue and set the quantity. Stock is updated when parts are attached to a job. Add a workshop supply with a description and amount when appropriate.
5. Save the repair order. The displayed ZiG amount is an estimate based on the configured exchange rate.

### D. Keep the job status current

1. New jobs start as **Draft**. Move a job to **Processing** when work begins and keep diagnosis, labour, parts, and incidentals current.
2. Record one or more installments in **Split Payments**, selecting the actual method for each payment. The panel shows total, paid, and balance; the methods are Cash, Card, Bank transfer, Mobile money, and Other.
3. Mark **Repair work is ready for pickup** when the work is finished. **Processed** is allowed only after the work is marked ready and the balance is zero. Older jobs may retain legacy statuses.
4. When a processed vehicle is physically handed back, select **Mark as Collected**. Enter the collection odometer and handover details; collected jobs are locked against routine edits.
5. A ready/unclaimed vehicle has a seven-day free pickup window. After it expires, the job shows an estimated parking fee of $3 per overdue day. Check the amount and shop policy before using **Apply Parking Fee**, then save the job.
6. Use the job's customer-update actions when you need to send a status update or diagnosis by WhatsApp/email. Verify the contact details and message before sending.

### E. Issue and share a receipt

1. Each repair installment updates a single cumulative receipt with the total amount paid so far.
2. Open **Receipts** to review, print, or share the current receipt. Check **All Receipts** before trying to create another record.

## 4. Customers and the public repair-status portal

### Customer records

The **Customers** page stores individual/company contacts and complete vehicle details. Use consistent phone numbers and check for an existing record before adding someone. A repeat phone or email is treated as the same customer, and another plate is added as an additional vehicle.

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
5. For a restock, choose the supplier, quantity, and unit cost. Confirm the entry against the supplier invoice; restocking changes on-hand stock and is included in purchase history.
6. The markup rate applies to new parts and edits. **Apply to All Existing Parts** changes prices across existing inventory, so review the rate before using it.
7. The admin dashboard and Shop alert when a part reaches or falls below 10% of its configured minimum. Set each part's minimum in its add/edit form; a minimum of zero disables that alert.

### Quick Sale

1. In **Shop → Quick Sale**, select the part and quantity.
2. Optionally select a salesperson and enter a customer name.
3. Check the calculated total, then select **Complete Sale**.
4. The sale reduces stock, records a sales order, and creates a receipt. Follow the **View / Print Receipt** link in the confirmation.

### Suppliers

Open **Suppliers** to add or edit supplier contact details, search the directory, or export supplier records to CSV. Keep these details accurate because they are used when recording purchases and payables.

## 6. Quotations and sales orders

1. From repair intake, choose quotation-first to carry the selected customer, vehicle, and reported fault into a new quote. You can also open **Quotations** and choose a repair job/vehicle, a registered customer/vehicle, or a walk-in customer.
2. Enter the labour rate per hour and hours worked, then select **Add Labour**. Add parts at their current Shop selling prices and quantities. Enter each sundry price and select **Add Sundry** as needed. Labour and sundry lines do not use descriptions. Check the quotation total in USD and ZiG.
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

- **Ledger:** maintain the chart of accounts, post journal entries, and review the Trial Balance. Journal entry debits must equal credits before posting.
- **Payables:** record a supplier bill with its bill date, due date, amount, and description. Use the payment action to record a payment against the payable; check the payment date and amount.
- **Cash Book:** post dated cash/bank movements to the appropriate account and other-side account. Use the separate petty-cash controls to log expenses and top up the float; reconcile entries to the actual cash held.
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
- Don't mark a vehicle **Collected** until it has actually been handed over. Collection is a one-way close-out action and locks normal job editing.
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
