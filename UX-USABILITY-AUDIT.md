# Centric Auto Mobile: Usability Audit and Workflow Redesign

Date: 23 November 2026
Scope: Current `main` branch, existing user guide, shared navigation, dashboard and key workshop/accounting pages.

## Executive finding

The main problem is not visual styling. The product exposes too many separate destinations and asks users to understand the software's internal modules before they can complete a real workshop task. The same customer/vehicle/job/payment journey crosses several pages, and the current guide itself describes multiple entry routes and cross-module handoffs.

The recommended direction is to keep the existing capabilities and data model, but reorganise the experience around the work people are trying to complete. The job record should become the central workspace. Navigation should be role-aware and task-oriented. The application should show the next useful action at each stage.

This document is an audit and proposed implementation plan. It does not authorise changing financial rules, database schemas, or access-control permissions.

## Evidence from the current repository

### 1. Navigation is organised by software categories

The shared shell currently groups links under Main, Workshop, Inventory, Finance, Intelligence, and Administration. It exposes destinations such as Repairs / Job Cards, Vehicle Checklist, Technicians, Commissions, Shop / Parts, Suppliers, Landed Cost, Quotations, Receipts, Cashbook, Payables, Ledger, Accounting, Fixed Assets, Financial Statements, Centric Intelligence, Analytics, Customers, and Settings.

Customers are currently placed under Administration even though customer lookup and registration are everyday workshop work. Quotations and receipts are grouped under Finance even though they are steps in the repair/customer journey. A user has to know the module name and where it is grouped.

### 2. One real-world job crosses many separate pages

The current user guide describes this sequence:
- Find or create the customer and vehicle.
- Open a quotation or a draft job card.
- If quotation-first was chosen, return to Quotations and use Open Job Card.
- Use the job card for diagnosis, technician assignment, labour and parts.
- Use the checklist separately for vehicle drop-off condition and sync it to the job.
- Close the job to Ready for Pickup.
- Use Ledger/Accounting to create an invoice and record payment.
- Use Receipts to print/share the receipt.
- Mark the vehicle Collected after handover.

These are valid capabilities, but the navigation and workflow handoffs make the user remember where each next step lives.

### 3. Pages contain several different jobs at once

Repository page structure shows:
- Repairs contains new job intake, draft job cards, daily updates, parts, checklist links, job editing, closure, collection, WhatsApp updates and invoice entry points.
- Checklist has saved checklists, drafts, inspection and linking to job cards.
- Quotations contains quotation creation, quotation list, sales orders, amendments, customer approval and order confirmation.
- Receipts contains receipts, invoices, customer credit notes, vouchers, new invoice creation and payment recording.
- Shop contains Quick Sale, parts catalogue, inventory intake, restock, purchase history and job-part requests.
- Ledger combines ready-to-bill jobs, typed-in parts awaiting price, bill/payment actions, customer details/history, customer accounts, chart of accounts, journal entries and trial balance.
- Settings combines account, device sign-in, appearance, business details, labour charges, daily goals, currency, notifications, access control and user guide.

Several of these pages are effectively mini-applications. That increases the learning burden.

### 4. Roles already exist and should be used to simplify the experience

The documented roles are Super Admin, Accounting, and Staff. The current user guide says Staff focus on day-to-day customers, repairs, shop and receipts; Accounting handles financial pages and analytics; Super Admin has full access and administration.

The redesign should use these existing roles to reduce visible choices. It must not broaden or bypass the existing permission checks. Hiding a navigation link is not a replacement for backend access control.

### 5. The system already has useful foundations

The current app already has global search, quick Job Card entry, attention notifications, status queues, a customer history view, job/checklist linking, quotation-to-job handoff, and accounting queues. The redesign should connect these capabilities more clearly rather than replace them.

## Proposed experience

### Primary navigation

Use five clear destinations:

1. **Home**: today's priorities, work in progress, overdue pickups, low stock, unpaid customer balances and quick actions.
2. **Jobs**: the complete vehicle/job journey, including intake, inspection, quotation, diagnosis, repair, quality check, billing readiness and collection.
3. **Customers**: customer and vehicle lookup, registration, history and balances.
4. **Stock**: parts catalogue, stock levels, restocking, suppliers and Quick Sale.
5. **More**: role-appropriate finance, team, reports, intelligence and settings.

For Accounting users, provide a clearly visible **Money** entry in place of less relevant workshop shortcuts, or as a prominent item within the More area. Keep accounting destinations grouped together. For Staff, keep advanced finance and administration out of the primary navigation. Super Admin retains access to all authorised areas.

The existing roles remain the source of truth. Do not introduce new roles as part of this usability change.

### The Job Workspace

Make one job record the home for the vehicle's entire workshop journey. Its detail view should show:

- Customer and vehicle identity.
- Drop-off checklist and condition evidence.
- Reported problem and technician diagnosis.
- Assigned technician and labour method.
- Parts and work progress.
- Quotation and approval state.
- Repair status and quality/closure information.
- Invoice, payments and receipt references.
- Pickup readiness and collection details.
- A clear activity timeline.

Do not duplicate financial records or create parallel invoice/payment logic. The workspace should link to existing authoritative records and actions.

### Guided next action

Every job should show one primary next action based on its actual state. Examples:

- Missing drop-off inspection: **Complete vehicle checklist**.
- Intake complete but not priced: **Prepare quotation** or **Continue job card**, depending on the saved path.
- Quotation awaiting customer decision: **Record customer approval**.
- Approved work not started: **Start repair**.
- Repair complete: **Complete final checks / close job**.
- Ready for billing: **Create invoice** (only for authorised roles and only when current business rules allow it).
- Invoice has an outstanding amount: **Record payment**.
- Ready for pickup: **Record collection** after actual handover.

The system must derive actions from persisted status and existing business rules. It must not offer actions that bypass required approvals, stock checks, pricing, permissions, or financial validations.

### Progressive disclosure

Keep advanced functions available, but show them when relevant:
- Put common daily actions first.
- Move journal entries, chart of accounts, depreciation, landed cost, payroll and access control into clearly named advanced areas.
- Use short, step-by-step forms for complex intake and transaction flows.
- Explain unfamiliar fields in plain language.
- Use one consistent status vocabulary across lists, detail views and dashboard alerts.
- Keep destructive and financial actions explicit, confirmed and auditable.

## Proposed phased implementation

### Phase 0: Baseline and safety
- Record current route destinations, role restrictions and critical business actions.
- Capture existing Playwright baseline and add navigation smoke tests.
- Confirm no business rule or database migration is needed for the first navigation/workspace changes.

### Phase 1: Navigation simplification
- Replace the long module-first navigation with Home, Jobs, Customers, Stock and More.
- Put Customers in the daily-work area, not Administration.
- Consolidate the accounting links under Money/Accounting.
- Keep every existing page reachable from the appropriate destination.
- Preserve role-based visibility and backend permission checks.

### Phase 2: Job workspace
- Improve the existing job detail view before creating a new data model.
- Add a clear progress/timeline area and state-based next action.
- Link existing checklist, quotation, invoice, payment and receipt records.
- Avoid changing the financial source of truth.

### Phase 3: Task-first home
- Replace generic dashboard cards with a short prioritized task list.
- Each alert should explain the issue and provide one direct action.
- Show role-relevant tasks only.

### Phase 4: Forms and terminology
- Review intake, quotation, parts, payment and collection forms.
- Remove repeated data entry where safe.
- Use plain labels, sensible defaults and clear validation.
- Keep important confirmation steps for money, stock and irreversible actions.

### Phase 5: Usability testing
Test with people unfamiliar with Centric. Ask them to complete:
1. Register a new customer and vehicle.
2. Receive a vehicle and complete its condition checklist.
3. Create a quotation and convert approved work to a job.
4. Add parts and record repair progress.
5. Close a completed job, invoice it and record a payment.
6. Mark a vehicle collected.
7. Find a customer's outstanding balance.
8. Restock a part and complete a Quick Sale.

Measure whether they can complete each task without being told which module to open. Record errors, time, backtracking and help requests.

## Non-negotiable safeguards

- Do not delete existing modules, records or capabilities merely to shorten navigation.
- Do not alter invoice, receipt, payment, stock, ledger, payroll, commission or customer-balance calculations as part of a navigation redesign.
- Do not bypass existing role checks or database policies.
- Do not mark a job collected unless the vehicle has actually been handed over.
- Do not create duplicate customer, vehicle, job, invoice or payment records.
- Keep existing URLs working during the transition so saved links and current workflows are not broken.
- Every meaningful change must pass JavaScript checks, existing tests and Playwright workflow tests before being called complete.

## Recommended first implementation

Start with Phase 1 only: simplify the shared navigation while preserving every destination and permission. Then test it on desktop and mobile. Once navigation is stable, move to the Job Workspace. This gives users immediate relief without risking the underlying workshop and accounting workflows.
