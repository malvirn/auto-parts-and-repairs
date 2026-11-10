import supabase from "./supabaseClient.js";

const panel = document.getElementById("customer-credit-panel");
const list = document.getElementById("customer-credit-list");
const refreshButton = document.getElementById("customer-credit-refresh");
if (!panel || !list) throw new Error("Customer credit panel is missing from the Receipts page.");
panel.classList.add("customer-credit-panel-scope");

const money = value => `$${Number(value || 0).toFixed(2)}`;
const escapeHtml = value => {
  const node = document.createElement("div");
  node.textContent = value ?? "";
  return node.innerHTML;
};
const dateLabel = value => value ? new Date(value).toLocaleDateString("en-GB", {
  timeZone: "Africa/Harare", day: "2-digit", month: "short", year: "numeric",
}) : "—";

let creditNotes = [];
let overpaymentCreditNotes = [];
let overpaymentRefunds = [];
let movements = [];
let targets = [];
let jobsById = new Map();
let unpaidJobs = [];
let canRefund = false;
let loadSequence = 0;
let hasLoadedCreditNotes = false;
let requestedCreditNoteHandled = false;

function showMessage(message, tone = "info") {
  let status = document.getElementById("customer-credit-message");
  if (!status) {
    status = document.createElement("p");
    status.id = "customer-credit-message";
    status.className = "form-message";
    status.setAttribute("role", "status");
    list.before(status);
  }
  status.textContent = message;
  status.dataset.tone = tone;
}

async function load() {
  const requestId = ++loadSequence;
  if (!hasLoadedCreditNotes) list.innerHTML = '<div class="customer-credit-empty">Loading credit notes…</div>';
  const [receiptsResult, balancesResult, movementsResult, targetsResult, authResult] = await Promise.all([
    supabase.from("quotation_deposit_receipts")
      .select("id, credit_note_number, quotation_id, customer_id, customer_name, customer_phone, amount, payment_method, payment_date, reference, created_at, journal_entry_id, quotations(quotation_number, created_at, repair_job_id), customers(email)")
      .order("created_at", { ascending: false }),
    supabase.from("customer_credit_balances").select("deposit_receipt_id, available_amount"),
    supabase.from("customer_credit_movements")
      .select("id, deposit_receipt_id, movement_type, amount, target_type, target_id, payment_account_id, reason, journal_entry_id, created_at, reversed_at, reversal_reason, reversal_journal_entry_id")
      .order("created_at", { ascending: false }),
    supabase.from("customer_account_statement")
      .select("customer_id, customer_name, source_id, source_type, reference, balance_due")
      .gt("balance_due", 0.005),
    supabase.auth.getUser(),
  ]);

  if (requestId !== loadSequence) return;
  const failure = receiptsResult.error || balancesResult.error || movementsResult.error || targetsResult.error;
  if (failure) {
    if (!hasLoadedCreditNotes) list.innerHTML = `<div class="customer-credit-empty">Customer credit is unavailable: ${escapeHtml(failure.message)}</div>`;
    console.error("Customer credit refresh failed; keeping the last displayed credit notes:", failure);
    return;
  }

  const [overpaymentResult, overpaymentRefundsResult] = await Promise.all([
    supabase.from("customer_overpayment_credit_notes")
      .select("id,note_number,customer_id,invoice_id,customer_name,customer_phone,amount,issued_at,invoices(invoice_number,customer_email,total,subtotal,vat_rate,vat_base,repair_job_id,repair_jobs(checklist_number)),customer_overpayment_credits(available_amount,invoice_payments(payment_method)),customer_overpayment_credit_job_links(repair_job_id,applied_amount,repair_jobs(job_number,checklist_number,cro_number))")
      .order("issued_at", { ascending: false }).limit(500),
    supabase.from("customer_overpayment_credit_refunds")
      .select("credit_note_id,amount,voided_at"),
  ]);
  overpaymentRefunds = overpaymentRefundsResult.error ? [] : (overpaymentRefundsResult.data || []);
  if (overpaymentRefundsResult.error) console.error("Could not load customer credit refund history:", overpaymentRefundsResult.error);
  if (overpaymentResult.error) {
    console.error("Could not load invoice overpayment credit notes:", overpaymentResult.error);
    if (!hasLoadedCreditNotes) overpaymentCreditNotes = [];
  } else {
    overpaymentCreditNotes = overpaymentResult.data || [];
  }

  if (requestId !== loadSequence) return;
  const userId = authResult.data.user?.id;
  const profileResult = userId
    ? await supabase.from("profiles").select("role, access_level").eq("id", userId).maybeSingle()
    : { data: null, error: null };
  const role = String(profileResult.data?.role || "").toLowerCase();
  canRefund = role === "accounting" || role === "super_admin" || role === "superadmin" || Number(profileResult.data?.access_level || 0) >= 2;

  creditNotes = receiptsResult.data || [];
  const balanceById = new Map((balancesResult.data || []).map(row => [row.deposit_receipt_id, Number(row.available_amount) || 0]));
  creditNotes = creditNotes.map(row => ({ ...row, available_amount: balanceById.get(row.id) || 0 }));
  movements = movementsResult.data || [];
  targets = (targetsResult.data || []).filter(row => ["Repair job", "Sales order", "Invoice"].includes(row.source_type));

  const jobIds = [...new Set(creditNotes.map(note => note.quotations?.repair_job_id).filter(Boolean))];
  jobsById = new Map();
  if (jobIds.length) {
    const { data: jobs, error } = await supabase.from("repair_jobs")
      .select("id, job_number, cro_number, checklist_number, status, vehicle_id, vehicles(make, model, year, license_plate)")
      .in("id", jobIds);
    if (!error) (jobs || []).forEach(job => jobsById.set(job.id, job));
  }
  const unpaidJobIds = [...new Set(targets.filter(row => row.source_type === "Repair job").map(row => row.source_id).filter(Boolean))];
  unpaidJobs = [];
  if (unpaidJobIds.length) {
    const { data: jobs, error } = await supabase.from("repair_jobs")
      .select("id, job_number, cro_number, checklist_number, status, customer_id, vehicle_id, vehicles(make, model, year, license_plate)")
      .in("id", unpaidJobIds);
    if (!error) unpaidJobs = jobs || [];
  }
  if (requestId !== loadSequence) return;
  hasLoadedCreditNotes = true;
  render();

  const requestedId = new URLSearchParams(location.search).get("credit_note_id");
  if (requestedId && !requestedCreditNoteHandled) {
    requestedCreditNoteHandled = true;
    const cleanParams = new URLSearchParams(location.search);
    cleanParams.delete("credit_note_id");
    history.replaceState(null, "", `${location.pathname}${cleanParams.toString() ? "?" + cleanParams.toString() : ""}${location.hash}`);
    const card = list.querySelector(`[data-credit-note-id="${CSS.escape(requestedId)}"]`);
    if (card) openCreditDetails(card);
    else showMessage("The requested quotation credit note could not be found. You can still view all previous receipts below.", "error");
  }
}

function noteStatus(note, noteMovements) {
  const refunded = noteMovements.filter(item => item.movement_type === "refund" && !item.reversed_at)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const applied = noteMovements.filter(item => item.movement_type === "application" && !item.reversed_at)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (note.available_amount <= 0.005 && refunded > 0) return { label: "Refunded", tone: "refunded", refunded, applied };
  if (refunded > 0) return { label: "Partially refunded", tone: "partial", refunded, applied };
  if (note.available_amount <= 0.005 && applied > 0) return { label: "Fully applied", tone: "applied", refunded, applied };
  if (applied > 0) return { label: "Partially applied", tone: "partial", refunded, applied };
  return { label: "Available", tone: "available", refunded, applied };
}

function printCreditNote(note) {
  const quote = note.quotations || {};
  const job = quote.repair_job_id ? jobsById.get(quote.repair_job_id) : null;
  const number = `QCN-${String(note.credit_note_number).padStart(6, "0")}`;
  const movementsForNote = movements.filter(item => item.deposit_receipt_id === note.id);
  const status = noteStatus(note, movementsForNote);
  const vehicle = job?.vehicles || {};
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const jobRef = job ? (job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : "Not created yet";
  const activityRows = movementsForNote.map(item => `<tr><td>${escapeHtml(item.movement_type === "refund" ? "Refund" : "Credit applied")}</td><td>${dateLabel(item.created_at)}</td><td>${money(item.amount)}</td><td>${escapeHtml(item.reason || "—")}</td></tr>`).join("");
  const popup = window.open("", "_blank", "width=900,height=720");
  if (!popup) { showMessage("Allow pop-ups for this site to print the credit note.", "error"); return; }
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${number} · Centric Auto Mobile</title>
  <style>
    *{box-sizing:border-box}body{margin:0;padding:28px;background:#eef1f4;color:#17212b;font:14px/1.5 Inter,Arial,sans-serif}
    .sheet{max-width:820px;margin:auto;background:#fff;border:1px solid #dce2e8;border-radius:12px;overflow:hidden}
    .hero{padding:28px 30px;background:#27364d;color:#fff}.hero-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
    .hero h1{font-size:23px;margin:0}.hero .amount{font-size:27px;font-weight:800;white-space:nowrap}
    .hero .sub{display:flex;justify-content:space-between;gap:10px;margin-top:8px;color:#c8d2df}
    .pill{display:inline-block;margin-top:18px;padding:6px 14px;border-radius:99px;background:#fff2df;color:#94431f;font-weight:800}
    .customer{margin-top:18px;font-size:22px}.vehicle{color:#c8d2df;font-size:16px}
    .section{padding:0 30px}.section h2{margin:22px 0 0;padding:12px 16px;background:#f1f3f6;color:#596779;font-size:13px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #dce2e8}
    .line{display:flex;justify-content:space-between;gap:14px;padding:15px 16px;border-bottom:1px solid #e2e6eb;font-size:15px}
    .line strong{font-variant-numeric:tabular-nums;text-align:right}.line.total{font-weight:800;border-top:2px solid #cbd3dc}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:18px 0}.meta div{padding:12px;background:#f5f7f9;border-radius:8px;min-width:0}.meta small{display:block;color:#687789;font-size:10px;text-transform:uppercase;letter-spacing:.07em}.meta strong{display:block;margin-top:4px;overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;margin:12px 0 24px}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e9ed}th{background:#f5f7f9;font-size:10px;text-transform:uppercase;color:#64748b}
    footer{margin:0 30px 24px;padding-top:14px;border-top:1px solid #e5e9ed;text-align:center;color:#657384;font-size:11px}
    .print{display:block;margin:0 auto 14px;padding:10px 16px;border:0;border-radius:8px;background:#17212b;color:#fff;font-weight:700;cursor:pointer}
    @page{size:auto;margin:0}
    @media print{html,body{margin:0!important;padding:10mm!important;background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{max-width:none!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}.print{display:none!important}}
    @media(max-width:600px){body{padding:10px}.hero{padding:20px}.hero-top{flex-direction:column}.hero .amount{font-size:23px}.section{padding:0 16px}.meta{grid-template-columns:1fr}}
  </style></head><body><button class="print" onclick="window.print()">Print credit note</button><main class="sheet">
    <header class="hero"><div class="hero-top"><div><h1>${number}</h1><div class="sub"><span>Quotation #${escapeHtml(quote.quotation_number ?? "—")}</span><span>${dateLabel(note.payment_date)}</span></div></div><div class="amount">${money(note.amount)}</div></div>
    <div class="pill">${status.label}</div><div class="customer">${escapeHtml(note.customer_name || "Customer")}</div>
    <div class="vehicle">${escapeHtml(vehicleLabel || "Quotation deposit")} · ${escapeHtml(vehicle.license_plate || (job ? "Registration not recorded" : "Job card pending"))}</div></header>
    <section class="section"><h2>Credit note details</h2><div class="meta">
      <div><small>Job card</small><strong>${escapeHtml(jobRef)}</strong></div>
      <div><small>Checklist number</small><strong>${job?.checklist_number ? "#" + escapeHtml(job.checklist_number) : "Pending"}</strong></div>
      <div><small>Job status</small><strong>${escapeHtml(job?.status || "Awaiting job card")}</strong></div>
      <div><small>Payment method / reference</small><strong>${escapeHtml(note.payment_method)} · ${escapeHtml(note.reference || "No reference")}</strong></div>
      <div><small>Customer phone</small><strong>${escapeHtml(note.customer_phone || "—")}</strong></div>
      <div><small>Quotation issued</small><strong>${dateLabel(quote.created_at)}</strong></div>
    </div></section>
    <section class="section"><h2>Credit summary</h2>
      <div class="line"><span>Original deposit</span><strong>${money(note.amount)}</strong></div>
      <div class="line"><span>Refunded</span><strong>${money(status.refunded)}</strong></div>
      <div class="line"><span>Applied to customer work</span><strong>${money(status.applied)}</strong></div>
      <div class="line total"><span>Available credit</span><strong>${money(note.available_amount)}</strong></div>
    </section>
    <section class="section"><h2>Credit activity</h2><table><thead><tr><th>Action</th><th>Date</th><th>Amount</th><th>Details</th></tr></thead><tbody>${activityRows || '<tr><td colspan="4">No credit movements recorded.</td></tr>'}</tbody></table></section>
    <footer>Customer deposit liability account 2300 · Retain this document for your records.<br>CENTRIC AUTO MOBILE · Auto Parts &amp; Repairs · Norton, Zimbabwe</footer>
  </main></body></html>`);
  popup.document.close(); popup.focus(); setTimeout(() => popup.print(), 350);
}

function renderUnpaidJobs(note) {
  const name = String(note.customer_name || "").trim().toLocaleLowerCase();
  const rows = targets.filter(row => row.source_type === "Repair job" && (
    note.customer_id ? row.customer_id === note.customer_id :
      String(row.customer_name || "").trim().toLocaleLowerCase() === name
  ));
  if (!rows.length) return '<section class="credit-unpaid-jobs"><h4>Unpaid job cards</h4><p>This customer has no unpaid job cards.</p></section>';
  const byId = new Map(unpaidJobs.map(job => [job.id, job]));
  return `<section class="credit-unpaid-jobs"><h4>Unpaid job cards <span>${rows.length}</span></h4>
    <div class="credit-job-table-wrap"><table class="credit-job-table">
    <thead><tr><th>Job card</th><th>Checklist</th><th>Vehicle</th><th>Job status</th><th>Balance due</th></tr></thead>
    <tbody>${rows.map(row => {
      const job = byId.get(row.source_id);
      const vehicle = job?.vehicles || {};
      const vehicleName = [vehicle.year, vehicle.make, vehicle.model, vehicle.license_plate].filter(Boolean).join(" ");
      const number = job ? (job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : row.reference;
      return `<tr><td><a href="repairs.html?highlight=${encodeURIComponent(row.source_id)}">${escapeHtml(number || "Job card")}</a></td>
      <td>${job?.checklist_number ? "#" + escapeHtml(job.checklist_number) : "—"}</td>
      <td>${escapeHtml(vehicleName || "—")}</td><td><span class="credit-job-status">${escapeHtml(job?.status || "Job card")}</span></td>
      <td class="credit-job-balance">${money(row.balance_due)}</td></tr>`;
    }).join("")}</tbody></table></div></section>`;
}

function render() {
  const query = document.getElementById("customer-credit-search")?.value.trim().toLocaleLowerCase() || "";
  const from = document.getElementById("customer-credit-from")?.value || "";
  const to = document.getElementById("customer-credit-to")?.value || "";
  const statusFilter = document.getElementById("customer-credit-status")?.value || "";
  const methodFilter = document.getElementById("customer-credit-method")?.value.trim().toLocaleLowerCase() || "";
  const min = document.getElementById("customer-credit-min")?.value === "" ? null : Number(document.getElementById("customer-credit-min")?.value);
  const max = document.getElementById("customer-credit-max")?.value === "" ? null : Number(document.getElementById("customer-credit-max")?.value);
  const dateKey = value => value ? String(value).slice(0, 10) : "";
  const matches = (note, kind) => {
    const invoice = note.invoices || {};
    const noteNumber = kind === "deposit" ? `QCN-${note.credit_note_number}` : `CN-${note.note_number}`;
    const checklist = kind === "deposit" ? jobsById.get(note.quotations?.repair_job_id)?.checklist_number : invoice.repair_jobs?.checklist_number;
    const paymentMethod = kind === "deposit" ? note.payment_method : note.customer_overpayment_credits?.invoice_payments?.payment_method;
    const haystack = [noteNumber, note.customer_name, note.customer_phone, note.customers?.email, invoice.invoice_number, invoice.customer_email, note.reference, paymentMethod, checklist, kind === "deposit" ? note.quotations?.quotation_number : "invoice overpayment"].filter(Boolean).join(" ").toLocaleLowerCase();
    const date = dateKey(kind === "deposit" ? note.payment_date || note.created_at : note.issued_at);
    const amount = Number(kind === "deposit" ? note.available_amount ?? note.amount : note.customer_overpayment_credits?.available_amount ?? note.amount) || 0;
    const refunded = kind === "overpayment" ? overpaymentRefunds
      .filter(refund => refund.credit_note_id === note.id && !refund.voided_at)
      .reduce((sum, refund) => sum + Number(refund.amount || 0), 0) : 0;
    const status = kind === "deposit" ? noteStatus(note, movements.filter(item => item.deposit_receipt_id === note.id)).tone
      : refunded > 0 && amount <= 0.005 ? "refunded"
        : refunded > 0 || amount < Number(note.amount || 0) - 0.005 ? "partial"
          : amount <= 0.005 ? "applied" : "available";
    return (!query || haystack.includes(query)) && (!from || date >= from) && (!to || date <= to)
      && (min === null || amount >= min) && (max === null || amount <= max)
      && (!statusFilter || status === statusFilter) && (!methodFilter || String(paymentMethod || "").toLocaleLowerCase().includes(methodFilter));
  };
  const filteredCreditNotes = creditNotes.filter(note => matches(note, "deposit"));
  const filteredOverpaymentNotes = overpaymentCreditNotes.filter(note => matches(note, "overpayment"));
  if (!filteredCreditNotes.length && !filteredOverpaymentNotes.length) {
    const hasFilters = query || from || to || statusFilter || methodFilter || min !== null || max !== null;
    list.innerHTML = `<div class="customer-credit-empty">${hasFilters ? "No credit notes match these filters." : "No customer credit notes have been issued yet."}</div>`;
    return;
  }
  const totalOriginal = creditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);
  const totalAvailable = creditNotes.reduce((sum, note) => sum + Number(note.available_amount || 0), 0);
  const totalRefunded = creditNotes.reduce((sum, note) => sum + noteStatus(note, movements.filter(m => m.deposit_receipt_id === note.id)).refunded, 0);
  list.innerHTML = `
    <div class="customer-credit-summary"><div><small>Deposits issued</small><strong>${money(totalOriginal)}</strong></div><div><small>Refunded</small><strong>${money(totalRefunded)}</strong></div><div><small>Credit remaining</small><strong>${money(totalAvailable)}</strong></div></div>
    <div class="customer-credit-records">${filteredCreditNotes.map(note => {
      const quote = note.quotations || {};
      const job = quote.repair_job_id ? jobsById.get(quote.repair_job_id) : null;
      const quoteNumber = quote.quotation_number ?? "—";
      const noteName = note.customer_name || "Customer";
      const quoteTargets = targets.filter(target => note.customer_id
        ? target.customer_id === note.customer_id
        : String(target.customer_name || "").trim().toLocaleLowerCase() === noteName.trim().toLocaleLowerCase());
      const targetOptions = quoteTargets.map(target => {
        const type = target.source_type === "Repair job" ? "repair_job" : target.source_type === "Sales order" ? "sales_order" : "invoice";
        return `<option value="${type}|${escapeHtml(target.source_id)}">${escapeHtml(target.reference)} · due ${money(target.balance_due)}</option>`;
      }).join("");
      const noteMovements = movements.filter(movement => movement.deposit_receipt_id === note.id);
      const status = noteStatus(note, noteMovements);
      const expired = quote.created_at && Date.now() > Date.parse(quote.created_at) + 7 * 86400000;
      const history = noteMovements.length ? `<details class="customer-credit-history"><summary>Activity history · ${noteMovements.length}</summary>${noteMovements.map(movement => {
        const label = movement.movement_type === "refund" ? "Refund" : "Credit applied";
        const reversed = movement.reversed_at ? ` · Reversed: ${escapeHtml(movement.reversal_reason || "")}` : "";
        const reverseAction = canRefund && !movement.reversed_at
          ? ` <button type="button" class="btn customer-credit-reverse" data-movement-id="${escapeHtml(movement.id)}">Reverse</button>`
          : "";
        return `<div class="credit-history-row"><span>${label} · ${dateLabel(movement.created_at)}</span><strong>${money(movement.amount)}</strong><small>${escapeHtml(movement.reason || "")}${reversed}</small>${reverseAction}</div>`;
      }).join("")}</details>` : '<small class="customer-credit-history">No payments have been applied or refunded against this credit note yet.</small>';
      const applyFields = note.available_amount > 0.005
        ? `<div class="customer-credit-actions" data-credit-id="${escapeHtml(note.id)}" data-action="apply">
            <select class="credit-target" aria-label="Apply credit to" ${quoteTargets.length ? "" : "disabled"}><option value="">${quoteTargets.length ? "Apply to customer balance…" : "No same-customer balance"}</option>${targetOptions}</select>
            <input class="credit-amount" type="number" min="0.01" max="${note.available_amount}" step="0.01" placeholder="Amount" aria-label="Credit amount">
            <button type="button" class="btn customer-credit-apply" ${quoteTargets.length ? "" : "disabled"} aria-disabled="${quoteTargets.length ? "false" : "true"}">Apply credit</button>
          </div>` : "";
      return `<details class="customer-credit-record" data-credit-note-id="${escapeHtml(note.id)}">
        <summary class="customer-credit-record__summary">
          <span class="credit-note-id">QCN-${String(note.credit_note_number).padStart(6, "0")}</span>
          <span class="credit-note-customer"><strong>${escapeHtml(noteName)}</strong><small>Quotation #${escapeHtml(quoteNumber)} · ${dateLabel(note.payment_date)}</small></span>
          <span class="credit-note-balance"><strong>${money(note.available_amount)}</strong><small>Available</small></span>
          <span class="credit-note-status status-${status.tone}">${status.label}</span>
        </summary>
        <div class="customer-credit-document">
          <header class="credit-modal-header credit-note-brand-header">
            <img class="credit-note-brand-logo" src="../assets/logo.png" alt="Centric Auto Mobile logo">
            <div class="credit-modal-title"><small>CENTRIC AUTO MOBILE</small><h3>Customer Credit Note QCN-${String(note.credit_note_number).padStart(6, "0")}</h3></div>
          </header>
          <section class="credit-available-card">
            <div><small>Available credit</small><strong>${money(note.available_amount)}</strong></div>
            <span class="credit-unused-badge">${status.applied > 0.005 || status.refunded > 0.005 ? escapeHtml(status.label) : "Unused"}</span>
          </section>
          <section class="credit-details-card credit-note-narrative" aria-label="Credit note explanation">
            <h4>About this credit</h4>
            <p>This credit note confirms that <strong>${escapeHtml(noteName)}</strong> (${escapeHtml(note.customer_phone || "no phone number recorded")}) paid a deposit of <strong>${money(note.amount)}</strong> in cash for Quotation #${escapeHtml(quoteNumber)} on ${dateLabel(note.payment_date)}.</p>
            <p>So far, <strong>${money(status.applied)}</strong> of this deposit has been used towards the customer's work, and <strong>${money(status.refunded)}</strong> has been refunded. This leaves <strong>${money(note.available_amount)}</strong> available to use.</p>
            <p>${job ? `This credit is linked to job card ${escapeHtml(job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`)}.` : "A job card has not yet been created for this deposit."}</p>
            <p>This quotation deposit can be used within seven days of the date it was issued.</p>
          </section>
          <p class="credit-note-validity">${expired ? "The seven-day quotation deposit period has ended. Any unused credit is still available." : "This quotation deposit can be used for seven days after it was issued."}</p>
          <section class="credit-apply-section">
            <h4>Apply this credit</h4>
            ${applyFields || '<p class="credit-apply-empty">There is no available credit to apply at this time.</p>'}
          </section>
          ${history}
          ${renderUnpaidJobs(note)}
          <div class="credit-doc-actions credit-doc-actions--footer">
            <button type="button" class="btn credit-refund-placeholder" disabled title="Quotation deposit refunds are not yet supported by the current accounting workflow">Refund</button>
            <button type="button" class="btn customer-credit-print" data-credit-print="${escapeHtml(note.id)}"><i data-lucide="printer"></i> Print</button>
          </div>
        </div>
      </details>`;
    }).join("")}</div>`;
  if (filteredOverpaymentNotes.length) {
    const overpaymentTotal = overpaymentCreditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);
    const invoiceNotesHtml = filteredOverpaymentNotes.map(note => {
      const invoice = Array.isArray(note.invoices) ? (note.invoices[0] || {}) : (note.invoices || {});
      const number = "CN-" + String(note.note_number).padStart(5, "0");
      const invoiceNumber = invoice.invoice_number ? "INV-" + String(invoice.invoice_number).padStart(5, "0") : "Original invoice";
      const available = Number(note.customer_overpayment_credits?.available_amount ?? note.amount) || 0;
      const refunded = overpaymentRefunds.filter(row => row.credit_note_id === note.id && !row.voided_at).reduce((sum,row) => sum + Number(row.amount || 0),0);
      const applied = Math.max(0, Number(note.amount || 0) - available - refunded);
      const status = available <= .005 ? "Used / refunded" : available < Number(note.amount || 0) - .005 ? "Partially used" : "Available";
      const tone = available <= .005 ? "applied" : available < Number(note.amount || 0) - .005 ? "partial" : "available";
      const phone = String(note.customer_phone || "").replace(/\D/g,"");
      const message = `Centric Auto Mobile credit note CN-${String(note.note_number).padStart(5,"0")}. Customer: ${note.customer_name || "Customer"}. Invoice: ${invoiceNumber}. Amount: ${money(note.amount)}. Carried forward: ${money(available)}.`;
      const wa = phone ? "https://wa.me/" + phone + "?text=" + encodeURIComponent(message) : "";
      const mail = invoice.customer_email ? "mailto:" + encodeURIComponent(invoice.customer_email) + "?subject=" + encodeURIComponent("Centric Auto Mobile " + number) + "&body=" + encodeURIComponent(message) : "";
      const jobLink = Array.isArray(note.customer_overpayment_credit_job_links) ? (note.customer_overpayment_credit_job_links[0] || {}) : (note.customer_overpayment_credit_job_links || {});
      const linked = jobLink.repair_job_id || "";
      const link = linked ? '<a class="btn" href="repairs.html?highlight=' + encodeURIComponent(linked) + '">Open linked job card</a>' :
        '<section class="overpayment-job-link"><h4>Link carried-forward amount to the next job card</h4><p>Enter the customer name, email, phone number and checklist number. The name, email and phone must match the original credit note.</p><div class="overpayment-job-link__fields" data-overpayment-link="' + escapeHtml(note.id) + '" data-credit-note-id="' + escapeHtml(note.id) + '"><input data-match="name" placeholder="Customer full name" required><input data-match="email" type="email" placeholder="Customer email address" required><input data-match="phone" type="tel" placeholder="Customer phone number" required><input data-match="checklist" placeholder="Next job card checklist number" required><button class="btn btn--primary" type="button" data-link-overpayment-job>Verify and link next job card</button></div></section>';
      return '<details class="customer-credit-record overpayment-credit-record" style="margin-top:10px"><summary class="overpayment-credit-record__summary"><span><strong>' + number + '</strong><small>' + escapeHtml(note.customer_name || "Customer") + ' · ' + escapeHtml(invoiceNumber) + '</small></span><span class="credit-note-status status-' + tone + '">' + status + '</span><strong>' + money(available) + '<small>Carried forward</small></strong></summary><div class="overpayment-credit-record__body"><div class="credit-doc-heading"><div><small>CENTRIC AUTO MOBILE · INVOICE OVERPAYMENT</small><h3>' + number + '</h3></div><span class="credit-note-status status-' + tone + '">' + status + '</span></div><div class="credit-doc-facts"><div><small>Customer name</small><strong>' + escapeHtml(note.customer_name || "—") + '</strong></div><div><small>Phone</small><strong>' + escapeHtml(note.customer_phone || "—") + '</strong></div><div><small>Email</small><strong>' + escapeHtml(invoice.customer_email || "—") + '</strong></div><div><small>Original invoice</small><strong>' + escapeHtml(invoiceNumber) + '</strong></div><div><small>Original invoice total</small><strong>' + money(invoice.total) + '</strong></div><div><small>Issued</small><strong>' + dateLabel(note.issued_at) + '</strong></div><div><small>Original job card</small><strong>' + (linked ? "Linked" : "Not linked") + '</strong></div><div><small>Status</small><strong>' + status + '</strong></div></div><div class="credit-doc-totals"><div><small>Credit note amount</small><strong>' + money(note.amount) + '</strong></div><div><small>Refunded</small><strong>' + money(refunded) + '</strong></div><div><small>Applied</small><strong>' + money(applied) + '</strong></div><div><small>Amount carried forward</small><strong>' + money(available) + '</strong></div></div><div class="credit-doc-actions"><button class="btn" type="button" data-overpayment-print="' + escapeHtml(note.id) + '"><i data-lucide="printer"></i> Print</button>' + (wa ? '<a class="btn" href="' + wa + '" target="_blank" rel="noopener"><i data-lucide="message-circle"></i> WhatsApp</a>' : '<button class="btn" disabled>WhatsApp unavailable</button>') + (mail ? '<a class="btn" href="' + mail + '"><i data-lucide="mail"></i> Email</a>' : '<button class="btn" disabled>Email unavailable</button>') + '</div>' + link + '</div></details>';
    }).join("");
    list.insertAdjacentHTML("beforeend",
      '<section style="margin-top:24px"><div class="rc-tabs"><div><p class="section-kicker">Invoice overpayments</p><h3 style="margin:0">Overpayment Credit Notes</h3></div><span class="grow"></span><strong>' + money(overpaymentTotal) + ' carried forward</strong></div>' +
      '<p class="invoice-billing-note">Credit notes issued when a customer pays more than the invoice or job total. These amounts remain customer credit and are not counted as new income.</p><div class="customer-credit-records">' + invoiceNotesHtml + '</div>' + '</section>');
  }
  window.lucide?.createIcons();
}

let activeCreditDialog = null;
let activeCreditPlaceholder = null;
let activeCreditRecord = null;

function closeCreditDetails() {
  if (!activeCreditDialog) return;
  const documentPanel = activeCreditDialog.querySelector(".credit-dialog-content");
  if (documentPanel && activeCreditPlaceholder?.parentNode) {
    activeCreditPlaceholder.parentNode.insertBefore(documentPanel.firstElementChild, activeCreditPlaceholder);
    activeCreditPlaceholder.remove();
  }
  activeCreditDialog.remove();
  activeCreditDialog = null;
  activeCreditPlaceholder = null;
  if (activeCreditRecord) activeCreditRecord.open = false;
  activeCreditRecord = null;
  document.body.style.overflow = "";
}

function openCreditDetails(record) {
  if (!record) return;
  if (activeCreditDialog) closeCreditDetails();
  const details = record.querySelector(".customer-credit-document, .overpayment-credit-record__body");
  if (!details) return;
  const placeholder = document.createComment("credit note details return point");
  details.parentNode.insertBefore(placeholder, details);
  const overlay = document.createElement("div");
  overlay.className = "credit-note-dialog-overlay";
  overlay.setAttribute("role", "presentation");
  overlay.innerHTML = `<section class="credit-note-dialog" role="dialog" aria-modal="true" aria-label="Customer credit note details">
    <header class="credit-note-dialog-head"><strong>Customer credit note</strong><button type="button" class="credit-note-dialog-close" aria-label="Close credit note">×</button></header>
    <div class="credit-dialog-content"></div>
  </section>`;
  overlay.querySelector(".credit-dialog-content").appendChild(details);
  document.body.appendChild(overlay);
  record.open = false;
  activeCreditDialog = overlay;
  activeCreditPlaceholder = placeholder;
  activeCreditRecord = record;
  document.body.style.overflow = "hidden";
  overlay.querySelector(".credit-note-dialog-close").addEventListener("click", closeCreditDetails);
  overlay.addEventListener("click", event => { if (event.target === overlay) closeCreditDetails(); });
  requestAnimationFrame(() => overlay.querySelector(".credit-note-dialog-close")?.focus());
}

const creditInlineStyle = document.createElement("style");
creditInlineStyle.id = "customer-credit-inline-details";
creditInlineStyle.textContent = `
/* Fresh neutral credit note interface. No green theme, no modal layout. */
.customer-credit-panel-scope,
.customer-credit-panel-scope *{box-sizing:border-box!important}
.customer-credit-panel-scope{width:100%!important;max-width:100%!important;min-width:0!important;color:#e8edf3!important}
.customer-credit-panel-scope .customer-credit-summary{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important;width:100%!important;margin:0 0 18px!important}
.customer-credit-panel-scope .customer-credit-summary>div{min-width:0!important;padding:14px!important;border:1px solid #3b4654!important;border-radius:12px!important;background:#202833!important;color:#e8edf3!important}
.customer-credit-panel-scope .customer-credit-summary small{display:block!important;color:#aeb8c5!important;font-size:12px!important}
.customer-credit-panel-scope .customer-credit-summary strong{display:block!important;margin-top:5px!important;color:#fff!important;font-size:19px!important;font-weight:750!important}
.customer-credit-panel-scope .customer-credit-records{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:14px!important;width:100%!important;max-width:100%!important;min-width:0!important}
.customer-credit-panel-scope .customer-credit-record,
.customer-credit-panel-scope .overpayment-credit-record{display:block!important;position:relative!important;width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important;overflow:hidden!important;border:1px solid #465365!important;border-radius:14px!important;background:#1b232e!important;color:#edf1f6!important;box-shadow:0 8px 22px rgba(0,0,0,.16)!important}
.customer-credit-panel-scope .customer-credit-record__summary,
.customer-credit-panel-scope .overpayment-credit-record__summary{
 display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;
 gap:9px 12px!important;width:100%!important;min-width:0!important;margin:0!important;padding:16px!important;
 list-style:none!important;cursor:pointer!important;background:#252f3c!important;color:#f1f4f8!important;
}
.customer-credit-panel-scope .customer-credit-record__summary::-webkit-details-marker,
.customer-credit-panel-scope .overpayment-credit-record__summary::-webkit-details-marker{display:none!important}
.customer-credit-panel-scope .customer-credit-record__summary::after,
.customer-credit-panel-scope .overpayment-credit-record__summary::after{content:"+";position:absolute;right:12px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:24px;height:24px;color:#c5ced9;font-size:22px;font-weight:500;pointer-events:none}
.customer-credit-panel-scope details[open]>.customer-credit-record__summary::after,
.customer-credit-panel-scope details[open]>.overpayment-credit-record__summary::after{content:"−"}
.customer-credit-panel-scope .overpayment-credit-record__summary{padding-right:42px!important}
.customer-credit-panel-scope .overpayment-credit-record__summary>span:first-child{grid-column:1!important;grid-row:1!important;display:grid!important;gap:4px!important;min-width:0!important}
.customer-credit-panel-scope .overpayment-credit-record__summary>span:nth-child(2){grid-column:1!important;grid-row:2!important;justify-self:start!important}
.customer-credit-panel-scope .overpayment-credit-record__summary>strong{grid-column:2!important;grid-row:1/3!important;min-width:0!important;padding-right:12px!important;text-align:right!important}
.customer-credit-panel-scope .credit-note-id{display:inline-flex!important;grid-column:1!important;grid-row:1!important;width:max-content!important;max-width:100%!important;padding:6px 10px!important;border:1px solid #566477!important;border-radius:7px!important;background:#303c4b!important;color:#f1f4f8!important;font-size:13px!important;font-weight:800!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-note-customer{grid-column:1!important;grid-row:2!important;display:grid!important;gap:3px!important;min-width:0!important}
.customer-credit-panel-scope .credit-note-customer strong,
.customer-credit-panel-scope .overpayment-credit-record__summary>span:first-child strong{color:#f4f6f9!important;font-size:16px!important;line-height:1.35!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-note-customer small,
.customer-credit-panel-scope .credit-note-balance small,
.customer-credit-panel-scope .overpayment-credit-record__summary small{display:block!important;color:#aeb9c6!important;font-size:12px!important;line-height:1.4!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-note-balance{grid-column:2!important;grid-row:1/3!important;display:grid!important;gap:4px!important;text-align:right!important;min-width:0!important;padding-right:24px!important}
.customer-credit-panel-scope .credit-note-balance strong,
.customer-credit-panel-scope .overpayment-credit-record__summary>strong{color:#fff!important;font-size:19px!important;font-weight:800!important;font-variant-numeric:tabular-nums!important}
.customer-credit-panel-scope .credit-note-status{display:inline-flex!important;align-items:center!important;justify-content:center!important;grid-column:1!important;grid-row:3!important;width:max-content!important;max-width:100%!important;padding:5px 9px!important;border:1px solid #536174!important;border-radius:7px!important;background:#303b49!important;color:#e2e8f0!important;font-size:11px!important;font-weight:750!important;white-space:normal!important}
.customer-credit-panel-scope .status-available,
.customer-credit-panel-scope .status-partial,
.customer-credit-panel-scope .status-refunded,
.customer-credit-panel-scope .status-applied{background:#303b49!important;border-color:#536174!important;color:#e2e8f0!important}
.customer-credit-panel-scope .customer-credit-document,
.customer-credit-panel-scope .overpayment-credit-record__body{
 display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:14px!important;
 position:static!important;inset:auto!important;float:none!important;transform:none!important;
 width:100%!important;max-width:100%!important;min-width:0!important;height:auto!important;max-height:none!important;
 margin:0!important;padding:16px!important;overflow:visible!important;visibility:visible!important;opacity:1!important;
 border-top:1px solid #3d4958!important;background:#151c25!important;color:#e9eef4!important;
 font-family:Inter,"Segoe UI",Arial,sans-serif!important;font-size:14px!important;line-height:1.5!important;
}
.customer-credit-panel-scope .credit-modal-header,
.customer-credit-panel-scope .credit-doc-heading{display:flex!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;width:100%!important;min-width:0!important;margin:0!important;padding:0 0 10px!important;border:0!important;background:transparent!important}
.customer-credit-panel-scope .credit-modal-title{display:grid!important;gap:5px!important;min-width:0!important}
.customer-credit-panel-scope .credit-modal-title small,
.customer-credit-panel-scope .credit-doc-heading small{color:#aeb9c6!important;font-size:10px!important;font-weight:750!important;letter-spacing:.08em!important}
.customer-credit-panel-scope .credit-modal-title h3,
.customer-credit-panel-scope .credit-doc-heading h3{margin:0!important;color:#f3f6fa!important;font-size:20px!important;line-height:1.25!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-available-card{display:flex!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;width:100%!important;min-width:0!important;margin:0!important;padding:15px!important;border:1px solid #465365!important;border-radius:11px!important;background:#273241!important;color:#edf2f7!important}
.customer-credit-panel-scope .credit-available-card>div{display:grid!important;gap:4px!important;min-width:0!important}
.customer-credit-panel-scope .credit-available-card small,
.customer-credit-panel-scope .credit-unused-badge{color:#c3ccd7!important;font-size:12px!important}
.customer-credit-panel-scope .credit-available-card strong{color:#fff!important;font-size:24px!important;font-weight:800!important}
.customer-credit-panel-scope .credit-unused-badge{padding:5px 9px!important;border:1px solid #566477!important;border-radius:7px!important;background:#303c4b!important}
.customer-credit-panel-scope .credit-details-card,
.customer-credit-panel-scope .credit-apply-section,
.customer-credit-panel-scope .overpayment-job-link{display:grid!important;gap:10px!important;width:100%!important;min-width:0!important;margin:0!important;padding:14px!important;border:1px solid #3c4857!important;border-radius:11px!important;background:#202a36!important;color:#eaf0f6!important}
.customer-credit-panel-scope .credit-details-card h4,
.customer-credit-panel-scope .credit-apply-section h4,
.customer-credit-panel-scope .overpayment-job-link h4{margin:0!important;color:#f2f5f9!important;font-size:15px!important;font-weight:750!important}
.customer-credit-panel-scope .credit-detail-row{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)!important;gap:8px!important;align-items:start!important;width:100%!important;min-width:0!important;padding:9px 0!important;border-bottom:1px solid #3b4653!important}
.customer-credit-panel-scope .credit-detail-row:last-child{border-bottom:0!important}
.customer-credit-panel-scope .credit-detail-row>span{min-width:0!important;color:#aeb9c6!important;font-size:13px!important}
.customer-credit-panel-scope .credit-detail-row>strong{min-width:0!important;color:#f1f4f8!important;font-size:13px!important;text-align:right!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-detail-row>strong small{display:block!important;margin-top:3px!important;color:#aeb9c6!important;font-size:12px!important}
.customer-credit-panel-scope .credit-note-validity{margin:0!important;padding:11px 12px!important;border-left:3px solid #8291a4!important;background:#202a36!important;color:#c5cfda!important;font-size:12px!important;line-height:1.5!important}
.customer-credit-panel-scope .customer-credit-actions{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:9px!important;width:100%!important;min-width:0!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important}
.customer-credit-panel-scope .customer-credit-actions>*,
.customer-credit-panel-scope .overpayment-job-link__fields>*{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;min-height:44px!important;margin:0!important}
.customer-credit-panel-scope input,
.customer-credit-panel-scope select,
.customer-credit-panel-scope textarea{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;min-height:44px!important;padding:10px 12px!important;border:1px solid #566477!important;border-radius:8px!important;background:#111923!important;color:#f1f4f8!important;font:inherit!important;font-size:14px!important}
.customer-credit-panel-scope button,
.customer-credit-panel-scope a.btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;max-width:100%!important;min-height:42px!important;padding:10px 14px!important;border:1px solid #5b687a!important;border-radius:8px!important;background:#354253!important;color:#f5f7fa!important;font:inherit!important;font-size:13px!important;font-weight:700!important;text-decoration:none!important;white-space:normal!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope button:disabled{opacity:.48!important}
.customer-credit-panel-scope .credit-doc-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;width:100%!important;min-width:0!important;padding-top:10px!important;border-top:1px solid #3c4857!important}
.customer-credit-panel-scope .credit-doc-actions>*{width:100%!important;min-width:0!important}
.customer-credit-panel-scope .customer-credit-history{display:block!important;width:100%!important;min-width:0!important;margin:0!important;padding:12px!important;border:1px solid #3c4857!important;border-radius:10px!important;background:#202a36!important;color:#c5cfda!important}
.customer-credit-panel-scope .customer-credit-history>summary{cursor:pointer!important;color:#f0f3f7!important;font-weight:700!important}
.customer-credit-panel-scope .credit-history-row{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:6px 10px!important;padding:10px 0!important;border-bottom:1px solid #3b4653!important}
.customer-credit-panel-scope .credit-history-row>*{min-width:0!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-doc-facts,
.customer-credit-panel-scope .credit-doc-totals{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;width:100%!important;min-width:0!important}
.customer-credit-panel-scope .credit-doc-facts>div,
.customer-credit-panel-scope .credit-doc-totals>div{display:grid!important;gap:4px!important;min-width:0!important;padding:11px!important;border:1px solid #3c4857!important;border-radius:8px!important;background:#202a36!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-doc-facts small,
.customer-credit-panel-scope .credit-doc-totals small{color:#aeb9c6!important;font-size:11px!important}
.customer-credit-panel-scope .credit-doc-facts strong,
.customer-credit-panel-scope .credit-doc-totals strong{color:#f1f4f8!important;font-size:13px!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .overpayment-job-link p{margin:0!important;color:#c1cbd6!important;font-size:13px!important}
.customer-credit-panel-scope .overpayment-job-link__fields{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:9px!important;width:100%!important;min-width:0!important}
.customer-credit-panel-scope .customer-credit-empty{padding:18px!important;border:1px solid #3c4857!important;border-radius:10px!important;background:#202a36!important;color:#c5cfda!important}
@media(max-width:900px){
 .customer-credit-panel-scope .customer-credit-summary{grid-template-columns:minmax(0,1fr)!important}
 .customer-credit-panel-scope .customer-credit-document,
 .customer-credit-panel-scope .overpayment-credit-record__body{padding:13px!important}
 .customer-credit-panel-scope .credit-doc-facts,
 .customer-credit-panel-scope .credit-doc-totals{grid-template-columns:minmax(0,1fr)!important}
 .customer-credit-panel-scope .credit-doc-actions{grid-template-columns:minmax(0,1fr)!important}
 .customer-credit-panel-scope .credit-detail-row{grid-template-columns:minmax(0,1fr)!important;gap:3px!important}
 .customer-credit-panel-scope .credit-detail-row>strong{text-align:left!important}
}
html,body{max-width:100%!important;overflow-x:hidden!important}
`;
creditInlineStyle.textContent += `
/* Clear English labels, readable spacing and a deliberate light theme. */
.customer-credit-panel-scope .credit-detail-row{display:grid!important;grid-template-columns:minmax(115px,.8fr) minmax(0,1.2fr)!important;align-items:start!important;column-gap:18px!important;row-gap:5px!important;padding:11px 0!important}
.customer-credit-panel-scope .credit-detail-row>span{display:block!important;line-height:1.45!important;color:#b8c3d0!important}
.customer-credit-panel-scope .credit-detail-row>strong{display:block!important;line-height:1.5!important;overflow-wrap:anywhere!important;word-break:normal!important}
.customer-credit-panel-scope .credit-detail-row>strong small{display:block!important;margin-top:5px!important;font-weight:500!important;line-height:1.4!important}
.customer-credit-panel-scope .credit-note-validity{line-height:1.6!important}
.customer-credit-panel-scope .credit-apply-section h4,
.customer-credit-panel-scope .credit-details-card h4{line-height:1.4!important}
.credit-note-dialog .credit-dialog-content{color:#edf1f6!important}
.credit-note-dialog .credit-dialog-content p{line-height:1.6!important}
:root[data-theme="light"] .credit-note-dialog-overlay{background:rgba(20,28,38,.48)!important;backdrop-filter:blur(3px)!important}
:root[data-theme="light"] .credit-note-dialog{border-color:#cbd3dc!important;background:#fff!important;box-shadow:0 24px 70px rgba(20,30,45,.28)!important}
:root[data-theme="light"] .credit-note-dialog-head{border-color:#dce2e8!important;background:#f2f5f8!important;color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog-close{border-color:#c5ced8!important;background:#e5eaf0!important;color:#17212d!important}
:root[data-theme="light"] .credit-dialog-content{background:#fff!important;color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog .customer-credit-document,
:root[data-theme="light"] .credit-note-dialog .overpayment-credit-record__body{background:#fff!important;color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog .credit-modal-title h3,
:root[data-theme="light"] .credit-note-dialog .credit-doc-heading h3,
:root[data-theme="light"] .credit-note-dialog .credit-details-card h4,
:root[data-theme="light"] .credit-note-dialog .credit-apply-section h4,
:root[data-theme="light"] .credit-note-dialog .overpayment-job-link h4{color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog .credit-modal-title small,
:root[data-theme="light"] .credit-note-dialog .credit-doc-heading small,
:root[data-theme="light"] .credit-note-dialog .credit-detail-row>span,
:root[data-theme="light"] .credit-note-dialog .credit-detail-row>strong small,
:root[data-theme="light"] .credit-note-dialog .credit-available-card small,
:root[data-theme="light"] .credit-note-dialog .credit-unused-badge,
:root[data-theme="light"] .credit-note-dialog .overpayment-job-link p{color:#536273!important}
:root[data-theme="light"] .credit-note-dialog .credit-available-card{border-color:#d6dee7!important;background:#eef2f6!important;color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog .credit-available-card strong,
:root[data-theme="light"] .credit-note-dialog .credit-detail-row>strong,
:root[data-theme="light"] .credit-note-dialog .credit-doc-facts strong,
:root[data-theme="light"] .credit-note-dialog .credit-doc-totals strong{color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog .credit-details-card,
:root[data-theme="light"] .credit-note-dialog .credit-apply-section,
:root[data-theme="light"] .credit-note-dialog .overpayment-job-link,
:root[data-theme="light"] .credit-note-dialog .customer-credit-history,
:root[data-theme="light"] .credit-note-dialog .credit-doc-facts>div,
:root[data-theme="light"] .credit-note-dialog .credit-doc-totals>div{border-color:#d6dee7!important;background:#f7f9fb!important;color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog .credit-note-validity{border-left-color:#7b8795!important;background:#f1f4f7!important;color:#39485a!important}
:root[data-theme="light"] .credit-note-dialog .credit-detail-row{border-color:#e0e5eb!important}
:root[data-theme="light"] .credit-note-dialog .credit-history-row{border-color:#e0e5eb!important;color:#263445!important}
:root[data-theme="light"] .credit-note-dialog .credit-history-row strong,
:root[data-theme="light"] .credit-note-dialog .customer-credit-history>summary{color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog input,
:root[data-theme="light"] .credit-note-dialog select,
:root[data-theme="light"] .credit-note-dialog textarea{border-color:#bdc8d4!important;background:#fff!important;color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog input::placeholder{color:#687789!important;opacity:1!important}
:root[data-theme="light"] .credit-note-dialog button,
:root[data-theme="light"] .credit-note-dialog a.btn{border-color:#aebac7!important;background:#e7ecf1!important;color:#17212d!important}
:root[data-theme="light"] .credit-note-dialog .credit-note-status{border-color:#c4ced8!important;background:#e9eef3!important;color:#263445!important}
:root[data-theme="light"] .credit-note-dialog .credit-job-table-wrap{overflow-x:auto!important}
@media(max-width:600px){.customer-credit-panel-scope .credit-detail-row{grid-template-columns:minmax(0,1fr)!important;row-gap:4px!important}.customer-credit-panel-scope .credit-detail-row>strong{text-align:left!important}}
`;
creditInlineStyle.textContent += `
.customer-credit-panel-scope .credit-note-brand-header{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:16px!important;padding:0 0 16px!important;border-bottom:1px solid #465365!important}
.customer-credit-panel-scope .credit-note-brand-logo{display:block!important;width:76px!important;height:76px!important;max-width:24%!important;object-fit:contain!important;flex:none!important}
.customer-credit-panel-scope .credit-note-brand-header .credit-modal-title{min-width:0!important}
.customer-credit-panel-scope .credit-note-brand-header .credit-modal-title h3{font-size:clamp(17px,3.5vw,23px)!important;line-height:1.3!important}
.customer-credit-panel-scope .credit-note-narrative p{margin:0!important;color:#e2e8f0!important;font-size:14px!important;line-height:1.8!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-note-narrative p+p{margin-top:12px!important}
.customer-credit-panel-scope .credit-note-narrative p strong{color:#fff!important;font-weight:750!important}
:root[data-theme="light"] .credit-note-dialog .credit-note-brand-header{border-color:#d8e0e8!important}
:root[data-theme="light"] .credit-note-dialog .credit-note-narrative p{color:#344256!important}
:root[data-theme="light"] .credit-note-dialog .credit-note-narrative p strong{color:#17212d!important}
@media(max-width:600px){.customer-credit-panel-scope .credit-note-brand-logo{width:58px!important;height:58px!important}.customer-credit-panel-scope .credit-note-brand-header{gap:11px!important}}
`;
document.head.appendChild(creditInlineStyle);
import supabase from "./supabaseClient.js";

const panel = document.getElementById("customer-credit-panel");
const list = document.getElementById("customer-credit-list");
const refreshButton = document.getElementById("customer-credit-refresh");
if (!panel || !list) throw new Error("Customer credit panel is missing from the Receipts page.");
panel.classList.add("customer-credit-panel-scope");

const money = value => `$${Number(value || 0).toFixed(2)}`;
const escapeHtml = value => {
  const node = document.createElement("div");
  node.textContent = value ?? "";
  return node.innerHTML;
};
const dateLabel = value => value ? new Date(value).toLocaleDateString("en-GB", {
  timeZone: "Africa/Harare", day: "2-digit", month: "short", year: "numeric",
}) : "—";

let creditNotes = [];
let overpaymentCreditNotes = [];
let overpaymentRefunds = [];
let movements = [];
let targets = [];
let jobsById = new Map();
let unpaidJobs = [];
let canRefund = false;
let loadSequence = 0;
let hasLoadedCreditNotes = false;
let requestedCreditNoteHandled = false;

function showMessage(message, tone = "info") {
  let status = document.getElementById("customer-credit-status");
  if (!status) {
    status = document.createElement("p");
    status.id = "customer-credit-status";
    status.className = "form-message";
    status.setAttribute("role", "status");
    list.before(status);
  }
  status.textContent = message;
  status.dataset.tone = tone;
}

async function load() {
  const requestId = ++loadSequence;
  if (!hasLoadedCreditNotes) list.innerHTML = '<div class="customer-credit-empty">Loading credit notes…</div>';
  const [receiptsResult, balancesResult, movementsResult, targetsResult, authResult] = await Promise.all([
    supabase.from("quotation_deposit_receipts")
      .select("id, credit_note_number, quotation_id, customer_id, customer_name, customer_phone, amount, payment_method, payment_date, reference, created_at, journal_entry_id, quotations(quotation_number, created_at, repair_job_id), customers(email)")
      .order("created_at", { ascending: false }),
    supabase.from("customer_credit_balances").select("deposit_receipt_id, available_amount"),
    supabase.from("customer_credit_movements")
      .select("id, deposit_receipt_id, movement_type, amount, target_type, target_id, payment_account_id, reason, journal_entry_id, created_at, reversed_at, reversal_reason, reversal_journal_entry_id")
      .order("created_at", { ascending: false }),
    supabase.from("customer_account_statement")
      .select("customer_id, customer_name, source_id, source_type, reference, balance_due")
      .gt("balance_due", 0.005),
    supabase.auth.getUser(),
  ]);

  if (requestId !== loadSequence) return;
  const failure = receiptsResult.error || balancesResult.error || movementsResult.error || targetsResult.error;
  if (failure) {
    if (!hasLoadedCreditNotes) list.innerHTML = `<div class="customer-credit-empty">Customer credit is unavailable: ${escapeHtml(failure.message)}</div>`;
    console.error("Customer credit refresh failed; keeping the last displayed credit notes:", failure);
    return;
  }

  const [overpaymentResult, overpaymentRefundsResult] = await Promise.all([
    supabase.from("customer_overpayment_credit_notes")
      .select("id,note_number,customer_id,invoice_id,customer_name,customer_phone,amount,issued_at,invoices(invoice_number,customer_email,total,subtotal,vat_rate,vat_base,repair_job_id,repair_jobs(checklist_number)),customer_overpayment_credits(available_amount,invoice_payments(payment_method)),customer_overpayment_credit_job_links(repair_job_id,applied_amount,repair_jobs(job_number,checklist_number,cro_number))")
      .order("issued_at", { ascending: false }).limit(500),
    supabase.from("customer_overpayment_credit_refunds")
      .select("credit_note_id,amount,voided_at"),
  ]);
  overpaymentRefunds = overpaymentRefundsResult.error ? [] : (overpaymentRefundsResult.data || []);
  if (overpaymentRefundsResult.error) console.error("Could not load customer credit refund history:", overpaymentRefundsResult.error);
  if (overpaymentResult.error) {
    console.error("Could not load invoice overpayment credit notes:", overpaymentResult.error);
    if (!hasLoadedCreditNotes) overpaymentCreditNotes = [];
  } else {
    overpaymentCreditNotes = overpaymentResult.data || [];
  }

  if (requestId !== loadSequence) return;
  const userId = authResult.data.user?.id;
  const profileResult = userId
    ? await supabase.from("profiles").select("role, access_level").eq("id", userId).maybeSingle()
    : { data: null, error: null };
  const role = String(profileResult.data?.role || "").toLowerCase();
  canRefund = role === "accounting" || role === "super_admin" || role === "superadmin" || Number(profileResult.data?.access_level || 0) >= 2;

  creditNotes = receiptsResult.data || [];
  const balanceById = new Map((balancesResult.data || []).map(row => [row.deposit_receipt_id, Number(row.available_amount) || 0]));
  creditNotes = creditNotes.map(row => ({ ...row, available_amount: balanceById.get(row.id) || 0 }));
  movements = movementsResult.data || [];
  targets = (targetsResult.data || []).filter(row => ["Repair job", "Sales order", "Invoice"].includes(row.source_type));

  const jobIds = [...new Set(creditNotes.map(note => note.quotations?.repair_job_id).filter(Boolean))];
  jobsById = new Map();
  if (jobIds.length) {
    const { data: jobs, error } = await supabase.from("repair_jobs")
      .select("id, job_number, cro_number, checklist_number, status, vehicle_id, vehicles(make, model, year, license_plate)")
      .in("id", jobIds);
    if (!error) (jobs || []).forEach(job => jobsById.set(job.id, job));
  }
  const unpaidJobIds = [...new Set(targets.filter(row => row.source_type === "Repair job").map(row => row.source_id).filter(Boolean))];
  unpaidJobs = [];
  if (unpaidJobIds.length) {
    const { data: jobs, error } = await supabase.from("repair_jobs")
      .select("id, job_number, cro_number, checklist_number, status, customer_id, vehicle_id, vehicles(make, model, year, license_plate)")
      .in("id", unpaidJobIds);
    if (!error) unpaidJobs = jobs || [];
  }
  if (requestId !== loadSequence) return;
  hasLoadedCreditNotes = true;
  render();

  const requestedId = new URLSearchParams(location.search).get("credit_note_id");
  if (requestedId && !requestedCreditNoteHandled) {
    requestedCreditNoteHandled = true;
    const cleanParams = new URLSearchParams(location.search);
    cleanParams.delete("credit_note_id");
    history.replaceState(null, "", `${location.pathname}${cleanParams.toString() ? "?" + cleanParams.toString() : ""}${location.hash}`);
    const card = list.querySelector(`[data-credit-note-id="${CSS.escape(requestedId)}"]`);
    if (card) openCreditDetails(card);
    else showMessage("The requested quotation credit note could not be found. You can still view all previous receipts below.", "error");
  }
}

function noteStatus(note, noteMovements) {
  const refunded = noteMovements.filter(item => item.movement_type === "refund" && !item.reversed_at)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const applied = noteMovements.filter(item => item.movement_type === "application" && !item.reversed_at)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (note.available_amount <= 0.005 && refunded > 0) return { label: "Refunded", tone: "refunded", refunded, applied };
  if (refunded > 0) return { label: "Partially refunded", tone: "partial", refunded, applied };
  if (note.available_amount <= 0.005 && applied > 0) return { label: "Fully applied", tone: "applied", refunded, applied };
  if (applied > 0) return { label: "Partially applied", tone: "partial", refunded, applied };
  return { label: "Available", tone: "available", refunded, applied };
}

function printCreditNote(note) {
  const quote = note.quotations || {};
  const job = quote.repair_job_id ? jobsById.get(quote.repair_job_id) : null;
  const number = `QCN-${String(note.credit_note_number).padStart(6, "0")}`;
  const movementsForNote = movements.filter(item => item.deposit_receipt_id === note.id);
  const status = noteStatus(note, movementsForNote);
  const vehicle = job?.vehicles || {};
  const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const jobRef = job ? (job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : "Not created yet";
  const activityRows = movementsForNote.map(item => `<tr><td>${escapeHtml(item.movement_type === "refund" ? "Refund" : "Credit applied")}</td><td>${dateLabel(item.created_at)}</td><td>${money(item.amount)}</td><td>${escapeHtml(item.reason || "—")}</td></tr>`).join("");
  const popup = window.open("", "_blank", "width=900,height=720");
  if (!popup) { showMessage("Allow pop-ups for this site to print the credit note.", "error"); return; }
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${number} · Centric Auto Mobile</title>
  <style>
    *{box-sizing:border-box}body{margin:0;padding:28px;background:#eef1f4;color:#17212b;font:14px/1.5 Inter,Arial,sans-serif}
    .sheet{max-width:820px;margin:auto;background:#fff;border:1px solid #dce2e8;border-radius:12px;overflow:hidden}
    .hero{padding:28px 30px;background:#27364d;color:#fff}.hero-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
    .hero h1{font-size:23px;margin:0}.hero .amount{font-size:27px;font-weight:800;white-space:nowrap}
    .hero .sub{display:flex;justify-content:space-between;gap:10px;margin-top:8px;color:#c8d2df}
    .pill{display:inline-block;margin-top:18px;padding:6px 14px;border-radius:99px;background:#fff2df;color:#94431f;font-weight:800}
    .customer{margin-top:18px;font-size:22px}.vehicle{color:#c8d2df;font-size:16px}
    .section{padding:0 30px}.section h2{margin:22px 0 0;padding:12px 16px;background:#f1f3f6;color:#596779;font-size:13px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #dce2e8}
    .line{display:flex;justify-content:space-between;gap:14px;padding:15px 16px;border-bottom:1px solid #e2e6eb;font-size:15px}
    .line strong{font-variant-numeric:tabular-nums;text-align:right}.line.total{font-weight:800;border-top:2px solid #cbd3dc}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:18px 0}.meta div{padding:12px;background:#f5f7f9;border-radius:8px;min-width:0}.meta small{display:block;color:#687789;font-size:10px;text-transform:uppercase;letter-spacing:.07em}.meta strong{display:block;margin-top:4px;overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;margin:12px 0 24px}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e9ed}th{background:#f5f7f9;font-size:10px;text-transform:uppercase;color:#64748b}
    footer{margin:0 30px 24px;padding-top:14px;border-top:1px solid #e5e9ed;text-align:center;color:#657384;font-size:11px}
    .print{display:block;margin:0 auto 14px;padding:10px 16px;border:0;border-radius:8px;background:#17212b;color:#fff;font-weight:700;cursor:pointer}
    @page{size:auto;margin:0}
    @media print{html,body{margin:0!important;padding:10mm!important;background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{max-width:none!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}.print{display:none!important}}
    @media(max-width:600px){body{padding:10px}.hero{padding:20px}.hero-top{flex-direction:column}.hero .amount{font-size:23px}.section{padding:0 16px}.meta{grid-template-columns:1fr}}
  </style></head><body><button class="print" onclick="window.print()">Print credit note</button><main class="sheet">
    <header class="hero"><div class="hero-top"><div><h1>${number}</h1><div class="sub"><span>Quotation #${escapeHtml(quote.quotation_number ?? "—")}</span><span>${dateLabel(note.payment_date)}</span></div></div><div class="amount">${money(note.amount)}</div></div>
    <div class="pill">${status.label}</div><div class="customer">${escapeHtml(note.customer_name || "Customer")}</div>
    <div class="vehicle">${escapeHtml(vehicleLabel || "Quotation deposit")} · ${escapeHtml(vehicle.license_plate || (job ? "Registration not recorded" : "Job card pending"))}</div></header>
    <section class="section"><h2>Credit note details</h2><div class="meta">
      <div><small>Job card</small><strong>${escapeHtml(jobRef)}</strong></div>
      <div><small>Checklist number</small><strong>${job?.checklist_number ? "#" + escapeHtml(job.checklist_number) : "Pending"}</strong></div>
      <div><small>Job status</small><strong>${escapeHtml(job?.status || "Awaiting job card")}</strong></div>
      <div><small>Payment method / reference</small><strong>${escapeHtml(note.payment_method)} · ${escapeHtml(note.reference || "No reference")}</strong></div>
      <div><small>Customer phone</small><strong>${escapeHtml(note.customer_phone || "—")}</strong></div>
      <div><small>Quotation issued</small><strong>${dateLabel(quote.created_at)}</strong></div>
    </div></section>
    <section class="section"><h2>Credit summary</h2>
      <div class="line"><span>Original deposit</span><strong>${money(note.amount)}</strong></div>
      <div class="line"><span>Refunded</span><strong>${money(status.refunded)}</strong></div>
      <div class="line"><span>Applied to customer work</span><strong>${money(status.applied)}</strong></div>
      <div class="line total"><span>Available credit</span><strong>${money(note.available_amount)}</strong></div>
    </section>
    <section class="section"><h2>Credit activity</h2><table><thead><tr><th>Action</th><th>Date</th><th>Amount</th><th>Details</th></tr></thead><tbody>${activityRows || '<tr><td colspan="4">No credit movements recorded.</td></tr>'}</tbody></table></section>
    <footer>Customer deposit liability account 2300 · Retain this document for your records.<br>CENTRIC AUTO MOBILE · Auto Parts &amp; Repairs · Norton, Zimbabwe</footer>
  </main></body></html>`);
  popup.document.close(); popup.focus(); setTimeout(() => popup.print(), 350);
}

function renderUnpaidJobs(note) {
  const name = String(note.customer_name || "").trim().toLocaleLowerCase();
  const rows = targets.filter(row => row.source_type === "Repair job" && (
    note.customer_id ? row.customer_id === note.customer_id :
      String(row.customer_name || "").trim().toLocaleLowerCase() === name
  ));
  if (!rows.length) return '<section class="credit-unpaid-jobs"><h4>Unpaid job cards</h4><p>This customer has no unpaid job cards.</p></section>';
  const byId = new Map(unpaidJobs.map(job => [job.id, job]));
  return `<section class="credit-unpaid-jobs"><h4>Unpaid job cards <span>${rows.length}</span></h4>
    <div class="credit-job-table-wrap"><table class="credit-job-table">
    <thead><tr><th>Job card</th><th>Checklist</th><th>Vehicle</th><th>Job status</th><th>Balance due</th></tr></thead>
    <tbody>${rows.map(row => {
      const job = byId.get(row.source_id);
      const vehicle = job?.vehicles || {};
      const vehicleName = [vehicle.year, vehicle.make, vehicle.model, vehicle.license_plate].filter(Boolean).join(" ");
      const number = job ? (job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : row.reference;
      return `<tr><td><a href="repairs.html?highlight=${encodeURIComponent(row.source_id)}">${escapeHtml(number || "Job card")}</a></td>
      <td>${job?.checklist_number ? "#" + escapeHtml(job.checklist_number) : "—"}</td>
      <td>${escapeHtml(vehicleName || "—")}</td><td><span class="credit-job-status">${escapeHtml(job?.status || "Job card")}</span></td>
      <td class="credit-job-balance">${money(row.balance_due)}</td></tr>`;
    }).join("")}</tbody></table></div></section>`;
}

function render() {
  const query = document.getElementById("customer-credit-search")?.value.trim().toLocaleLowerCase() || "";
  const from = document.getElementById("customer-credit-from")?.value || "";
  const to = document.getElementById("customer-credit-to")?.value || "";
  const statusFilter = document.getElementById("customer-credit-status")?.value || "";
  const methodFilter = document.getElementById("customer-credit-method")?.value.trim().toLocaleLowerCase() || "";
  const min = document.getElementById("customer-credit-min")?.value === "" ? null : Number(document.getElementById("customer-credit-min")?.value);
  const max = document.getElementById("customer-credit-max")?.value === "" ? null : Number(document.getElementById("customer-credit-max")?.value);
  const dateKey = value => value ? String(value).slice(0, 10) : "";
  const matches = (note, kind) => {
    const invoice = note.invoices || {};
    const noteNumber = kind === "deposit" ? `QCN-${note.credit_note_number}` : `CN-${note.note_number}`;
    const checklist = kind === "deposit" ? jobsById.get(note.quotations?.repair_job_id)?.checklist_number : invoice.repair_jobs?.checklist_number;
    const paymentMethod = kind === "deposit" ? note.payment_method : note.customer_overpayment_credits?.invoice_payments?.payment_method;
    const haystack = [noteNumber, note.customer_name, note.customer_phone, note.customers?.email, invoice.invoice_number, invoice.customer_email, note.reference, paymentMethod, checklist, kind === "deposit" ? note.quotations?.quotation_number : "invoice overpayment"].filter(Boolean).join(" ").toLocaleLowerCase();
    const date = dateKey(kind === "deposit" ? note.payment_date || note.created_at : note.issued_at);
    const amount = Number(kind === "deposit" ? note.available_amount ?? note.amount : note.customer_overpayment_credits?.available_amount ?? note.amount) || 0;
    const refunded = kind === "overpayment" ? overpaymentRefunds
      .filter(refund => refund.credit_note_id === note.id && !refund.voided_at)
      .reduce((sum, refund) => sum + Number(refund.amount || 0), 0) : 0;
    const status = kind === "deposit" ? noteStatus(note, movements.filter(item => item.deposit_receipt_id === note.id)).tone
      : refunded > 0 && amount <= 0.005 ? "refunded"
        : refunded > 0 || amount < Number(note.amount || 0) - 0.005 ? "partial"
          : amount <= 0.005 ? "applied" : "available";
    return (!query || haystack.includes(query)) && (!from || date >= from) && (!to || date <= to)
      && (min === null || amount >= min) && (max === null || amount <= max)
      && (!statusFilter || status === statusFilter) && (!methodFilter || String(paymentMethod || "").toLocaleLowerCase().includes(methodFilter));
  };
  const filteredCreditNotes = creditNotes.filter(note => matches(note, "deposit"));
  const filteredOverpaymentNotes = overpaymentCreditNotes.filter(note => matches(note, "overpayment"));
  if (!filteredCreditNotes.length && !filteredOverpaymentNotes.length) {
    const hasFilters = query || from || to || statusFilter || methodFilter || min !== null || max !== null;
    list.innerHTML = `<div class="customer-credit-empty">${hasFilters ? "No credit notes match these filters." : "No customer credit notes have been issued yet."}</div>`;
    return;
  }
  const totalOriginal = creditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);
  const totalAvailable = creditNotes.reduce((sum, note) => sum + Number(note.available_amount || 0), 0);
  const totalRefunded = creditNotes.reduce((sum, note) => sum + noteStatus(note, movements.filter(m => m.deposit_receipt_id === note.id)).refunded, 0);
  list.innerHTML = `
    <div class="customer-credit-summary"><div><small>Deposits issued</small><strong>${money(totalOriginal)}</strong></div><div><small>Refunded</small><strong>${money(totalRefunded)}</strong></div><div><small>Credit remaining</small><strong>${money(totalAvailable)}</strong></div></div>
    <div class="customer-credit-records">${filteredCreditNotes.map(note => {
      const quote = note.quotations || {};
      const job = quote.repair_job_id ? jobsById.get(quote.repair_job_id) : null;
      const quoteNumber = quote.quotation_number ?? "—";
      const noteName = note.customer_name || "Customer";
      const quoteTargets = targets.filter(target => note.customer_id
        ? target.customer_id === note.customer_id
        : String(target.customer_name || "").trim().toLocaleLowerCase() === noteName.trim().toLocaleLowerCase());
      const targetOptions = quoteTargets.map(target => {
        const type = target.source_type === "Repair job" ? "repair_job" : target.source_type === "Sales order" ? "sales_order" : "invoice";
        return `<option value="${type}|${escapeHtml(target.source_id)}">${escapeHtml(target.reference)} · due ${money(target.balance_due)}</option>`;
      }).join("");
      const noteMovements = movements.filter(movement => movement.deposit_receipt_id === note.id);
      const status = noteStatus(note, noteMovements);
      const expired = quote.created_at && Date.now() > Date.parse(quote.created_at) + 7 * 86400000;
      const history = noteMovements.length ? `<details class="customer-credit-history"><summary>Activity history · ${noteMovements.length}</summary>${noteMovements.map(movement => {
        const label = movement.movement_type === "refund" ? "Refund" : "Credit applied";
        const reversed = movement.reversed_at ? ` · Reversed: ${escapeHtml(movement.reversal_reason || "")}` : "";
        const reverseAction = canRefund && !movement.reversed_at
          ? ` <button type="button" class="btn customer-credit-reverse" data-movement-id="${escapeHtml(movement.id)}">Reverse</button>`
          : "";
        return `<div class="credit-history-row"><span>${label} · ${dateLabel(movement.created_at)}</span><strong>${money(movement.amount)}</strong><small>${escapeHtml(movement.reason || "")}${reversed}</small>${reverseAction}</div>`;
      }).join("")}</details>` : '<small class="customer-credit-history">No payments have been applied or refunded against this credit note yet.</small>';
      const applyFields = note.available_amount > 0.005
        ? `<div class="customer-credit-actions" data-credit-id="${escapeHtml(note.id)}" data-action="apply">
            <select class="credit-target" aria-label="Apply credit to" ${quoteTargets.length ? "" : "disabled"}><option value="">${quoteTargets.length ? "Apply to customer balance…" : "No same-customer balance"}</option>${targetOptions}</select>
            <input class="credit-amount" type="number" min="0.01" max="${note.available_amount}" step="0.01" placeholder="Amount" aria-label="Credit amount">
            <button type="button" class="btn customer-credit-apply" ${quoteTargets.length ? "" : "disabled"} aria-disabled="${quoteTargets.length ? "false" : "true"}">Apply credit</button>
          </div>` : "";
      return `<details class="customer-credit-record" data-credit-note-id="${escapeHtml(note.id)}">
        <summary class="customer-credit-record__summary">
          <span class="credit-note-id">QCN-${String(note.credit_note_number).padStart(6, "0")}</span>
          <span class="credit-note-customer"><strong>${escapeHtml(noteName)}</strong><small>Quotation #${escapeHtml(quoteNumber)} · ${dateLabel(note.payment_date)}</small></span>
          <span class="credit-note-balance"><strong>${money(note.available_amount)}</strong><small>Available</small></span>
          <span class="credit-note-status status-${status.tone}">${status.label}</span>
        </summary>
        <div class="customer-credit-document">
          <header class="credit-modal-header">
            <div class="credit-modal-title"><small>CENTRIC AUTO MOBILE · CUSTOMER CREDIT NOTE</small><h3>QCN-${String(note.credit_note_number).padStart(6, "0")}</h3></div>
            
          </header>
          <section class="credit-available-card">
            <div><small>Available credit</small><strong>${money(note.available_amount)}</strong></div>
            <span class="credit-unused-badge">${status.applied > 0.005 || status.refunded > 0.005 ? escapeHtml(status.label) : "Unused"}</span>
          </section>
          <section class="credit-details-card" aria-label="Credit note details">
            <h4>Credit note details</h4>
            <div class="credit-detail-row"><span>Customer name</span><strong>${escapeHtml(noteName)}<small>${escapeHtml(note.customer_phone || "No phone number recorded")}</small></strong></div>
            <div class="credit-detail-row"><span>Deposit source</span><strong>Quotation #${escapeHtml(quoteNumber)}</strong></div>
            <div class="credit-detail-row"><span>Payment received</span><strong>${escapeHtml(note.payment_method || "Payment method not recorded")} on ${dateLabel(note.payment_date)}</strong></div>
            <div class="credit-detail-row"><span>Original deposit</span><strong>${money(note.amount)}</strong></div>
            <div class="credit-detail-row"><span>Credit applied to customer work</span><strong>${money(status.applied)}</strong></div>
            <div class="credit-detail-row"><span>Amount refunded</span><strong>${money(status.refunded)}</strong></div>
            <div class="credit-detail-row"><span>Linked job card</span><strong>${job ? escapeHtml(job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : "No job card created yet"}</strong></div>
          </section>
          <p class="credit-note-validity">${expired ? "The seven-day quotation deposit period has ended. Any unused credit is still available." : "This quotation deposit can be used for seven days after it was issued."}</p>
          <section class="credit-apply-section">
            <h4>Apply this credit</h4>
            ${applyFields || '<p class="credit-apply-empty">There is no available credit to apply at this time.</p>'}
          </section>
          ${history}
          ${renderUnpaidJobs(note)}
          <div class="credit-doc-actions credit-doc-actions--footer">
            <button type="button" class="btn credit-refund-placeholder" disabled title="Quotation deposit refunds are not yet supported by the current accounting workflow">Refund</button>
            <button type="button" class="btn customer-credit-print" data-credit-print="${escapeHtml(note.id)}"><i data-lucide="printer"></i> Print</button>
          </div>
        </div>
      </details>`;
    }).join("")}</div>`;
  if (filteredOverpaymentNotes.length) {
    const overpaymentTotal = overpaymentCreditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);
    const invoiceNotesHtml = filteredOverpaymentNotes.map(note => {
      const invoice = Array.isArray(note.invoices) ? (note.invoices[0] || {}) : (note.invoices || {});
      const number = "CN-" + String(note.note_number).padStart(5, "0");
      const invoiceNumber = invoice.invoice_number ? "INV-" + String(invoice.invoice_number).padStart(5, "0") : "Original invoice";
      const available = Number(note.customer_overpayment_credits?.available_amount ?? note.amount) || 0;
      const refunded = overpaymentRefunds.filter(row => row.credit_note_id === note.id && !row.voided_at).reduce((sum,row) => sum + Number(row.amount || 0),0);
      const applied = Math.max(0, Number(note.amount || 0) - available - refunded);
      const status = available <= .005 ? "Used / refunded" : available < Number(note.amount || 0) - .005 ? "Partially used" : "Available";
      const tone = available <= .005 ? "applied" : available < Number(note.amount || 0) - .005 ? "partial" : "available";
      const phone = String(note.customer_phone || "").replace(/\D/g,"");
      const message = `Centric Auto Mobile credit note CN-${String(note.note_number).padStart(5,"0")}. Customer: ${note.customer_name || "Customer"}. Invoice: ${invoiceNumber}. Amount: ${money(note.amount)}. Carried forward: ${money(available)}.`;
      const wa = phone ? "https://wa.me/" + phone + "?text=" + encodeURIComponent(message) : "";
      const mail = invoice.customer_email ? "mailto:" + encodeURIComponent(invoice.customer_email) + "?subject=" + encodeURIComponent("Centric Auto Mobile " + number) + "&body=" + encodeURIComponent(message) : "";
      const jobLink = Array.isArray(note.customer_overpayment_credit_job_links) ? (note.customer_overpayment_credit_job_links[0] || {}) : (note.customer_overpayment_credit_job_links || {});
      const linked = jobLink.repair_job_id || "";
      const link = linked ? '<a class="btn" href="repairs.html?highlight=' + encodeURIComponent(linked) + '">Open linked job card</a>' :
        '<section class="overpayment-job-link"><h4>Link carried-forward amount to the next job card</h4><p>Enter the customer name, email, phone number and checklist number. The name, email and phone must match the original credit note.</p><div class="overpayment-job-link__fields" data-overpayment-link="' + escapeHtml(note.id) + '" data-credit-note-id="' + escapeHtml(note.id) + '"><input data-match="name" placeholder="Customer full name" required><input data-match="email" type="email" placeholder="Customer email address" required><input data-match="phone" type="tel" placeholder="Customer phone number" required><input data-match="checklist" placeholder="Next job card checklist number" required><button class="btn btn--primary" type="button" data-link-overpayment-job>Verify and link next job card</button></div></section>';
      return '<details class="customer-credit-record overpayment-credit-record" style="margin-top:10px"><summary class="overpayment-credit-record__summary"><span><strong>' + number + '</strong><small>' + escapeHtml(note.customer_name || "Customer") + ' · ' + escapeHtml(invoiceNumber) + '</small></span><span class="credit-note-status status-' + tone + '">' + status + '</span><strong>' + money(available) + '<small>Carried forward</small></strong></summary><div class="overpayment-credit-record__body"><div class="credit-doc-heading"><div><small>CENTRIC AUTO MOBILE · INVOICE OVERPAYMENT</small><h3>' + number + '</h3></div><span class="credit-note-status status-' + tone + '">' + status + '</span></div><div class="credit-doc-facts"><div><small>Customer name</small><strong>' + escapeHtml(note.customer_name || "—") + '</strong></div><div><small>Phone</small><strong>' + escapeHtml(note.customer_phone || "—") + '</strong></div><div><small>Email</small><strong>' + escapeHtml(invoice.customer_email || "—") + '</strong></div><div><small>Original invoice</small><strong>' + escapeHtml(invoiceNumber) + '</strong></div><div><small>Original invoice total</small><strong>' + money(invoice.total) + '</strong></div><div><small>Issued</small><strong>' + dateLabel(note.issued_at) + '</strong></div><div><small>Original job card</small><strong>' + (linked ? "Linked" : "Not linked") + '</strong></div><div><small>Status</small><strong>' + status + '</strong></div></div><div class="credit-doc-totals"><div><small>Credit note amount</small><strong>' + money(note.amount) + '</strong></div><div><small>Refunded</small><strong>' + money(refunded) + '</strong></div><div><small>Applied</small><strong>' + money(applied) + '</strong></div><div><small>Amount carried forward</small><strong>' + money(available) + '</strong></div></div><div class="credit-doc-actions"><button class="btn" type="button" data-overpayment-print="' + escapeHtml(note.id) + '"><i data-lucide="printer"></i> Print</button>' + (wa ? '<a class="btn" href="' + wa + '" target="_blank" rel="noopener"><i data-lucide="message-circle"></i> WhatsApp</a>' : '<button class="btn" disabled>WhatsApp unavailable</button>') + (mail ? '<a class="btn" href="' + mail + '"><i data-lucide="mail"></i> Email</a>' : '<button class="btn" disabled>Email unavailable</button>') + '</div>' + link + '</div></details>';
    }).join("");
    list.insertAdjacentHTML("beforeend",
      '<section style="margin-top:24px"><div class="rc-tabs"><div><p class="section-kicker">Invoice overpayments</p><h3 style="margin:0">Overpayment Credit Notes</h3></div><span class="grow"></span><strong>' + money(overpaymentTotal) + ' carried forward</strong></div>' +
      '<p class="invoice-billing-note">Credit notes issued when a customer pays more than the invoice or job total. These amounts remain customer credit and are not counted as new income.</p><div class="customer-credit-records">' + invoiceNotesHtml + '</div>' + '</section>');
  }
  window.lucide?.createIcons();
}

let activeCreditDialog = null;
let activeCreditPlaceholder = null;
let activeCreditRecord = null;

function closeCreditDetails() {
  if (!activeCreditDialog) return;
  const documentPanel = activeCreditDialog.querySelector(".credit-dialog-content");
  if (documentPanel && activeCreditPlaceholder?.parentNode) {
    activeCreditPlaceholder.parentNode.insertBefore(documentPanel.firstElementChild, activeCreditPlaceholder);
    activeCreditPlaceholder.remove();
  }
  activeCreditDialog.remove();
  activeCreditDialog = null;
  activeCreditPlaceholder = null;
  if (activeCreditRecord) activeCreditRecord.open = false;
  activeCreditRecord = null;
  document.body.style.overflow = "";
}

function openCreditDetails(record) {
  if (!record) return;
  if (activeCreditDialog) closeCreditDetails();
  const details = record.querySelector(".customer-credit-document, .overpayment-credit-record__body");
  if (!details) return;
  const placeholder = document.createComment("credit note details return point");
  details.parentNode.insertBefore(placeholder, details);
  const overlay = document.createElement("div");
  overlay.className = "credit-note-dialog-overlay";
  overlay.setAttribute("role", "presentation");
  overlay.innerHTML = `<section class="credit-note-dialog" role="dialog" aria-modal="true" aria-label="Customer credit note details">
    <header class="credit-note-dialog-head"><strong>Customer credit note</strong><button type="button" class="credit-note-dialog-close" aria-label="Close credit note">×</button></header>
    <div class="credit-dialog-content"></div>
  </section>`;
  overlay.querySelector(".credit-dialog-content").appendChild(details);
  document.body.appendChild(overlay);
  record.open = false;
  activeCreditDialog = overlay;
  activeCreditPlaceholder = placeholder;
  activeCreditRecord = record;
  document.body.style.overflow = "hidden";
  overlay.querySelector(".credit-note-dialog-close").addEventListener("click", closeCreditDetails);
  overlay.addEventListener("click", event => { if (event.target === overlay) closeCreditDetails(); });
  requestAnimationFrame(() => overlay.querySelector(".credit-note-dialog-close")?.focus());
}

const creditInlineStyle = document.createElement("style");
creditInlineStyle.id = "customer-credit-inline-details";
creditInlineStyle.textContent = `
/* Fresh neutral credit note interface. No green theme, no modal layout. */
.customer-credit-panel-scope,
.customer-credit-panel-scope *{box-sizing:border-box!important}
.customer-credit-panel-scope{width:100%!important;max-width:100%!important;min-width:0!important;color:#e8edf3!important}
.customer-credit-panel-scope .customer-credit-summary{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important;width:100%!important;margin:0 0 18px!important}
.customer-credit-panel-scope .customer-credit-summary>div{min-width:0!important;padding:14px!important;border:1px solid #3b4654!important;border-radius:12px!important;background:#202833!important;color:#e8edf3!important}
.customer-credit-panel-scope .customer-credit-summary small{display:block!important;color:#aeb8c5!important;font-size:12px!important}
.customer-credit-panel-scope .customer-credit-summary strong{display:block!important;margin-top:5px!important;color:#fff!important;font-size:19px!important;font-weight:750!important}
.customer-credit-panel-scope .customer-credit-records{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:14px!important;width:100%!important;max-width:100%!important;min-width:0!important}
.customer-credit-panel-scope .customer-credit-record,
.customer-credit-panel-scope .overpayment-credit-record{display:block!important;position:relative!important;width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important;overflow:hidden!important;border:1px solid #465365!important;border-radius:14px!important;background:#1b232e!important;color:#edf1f6!important;box-shadow:0 8px 22px rgba(0,0,0,.16)!important}
.customer-credit-panel-scope .customer-credit-record__summary,
.customer-credit-panel-scope .overpayment-credit-record__summary{
 display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;
 gap:9px 12px!important;width:100%!important;min-width:0!important;margin:0!important;padding:16px!important;
 list-style:none!important;cursor:pointer!important;background:#252f3c!important;color:#f1f4f8!important;
}
.customer-credit-panel-scope .customer-credit-record__summary::-webkit-details-marker,
.customer-credit-panel-scope .overpayment-credit-record__summary::-webkit-details-marker{display:none!important}
.customer-credit-panel-scope .customer-credit-record__summary::after,
.customer-credit-panel-scope .overpayment-credit-record__summary::after{content:"+";position:absolute;right:12px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:24px;height:24px;color:#c5ced9;font-size:22px;font-weight:500;pointer-events:none}
.customer-credit-panel-scope details[open]>.customer-credit-record__summary::after,
.customer-credit-panel-scope details[open]>.overpayment-credit-record__summary::after{content:"−"}
.customer-credit-panel-scope .overpayment-credit-record__summary{padding-right:42px!important}
.customer-credit-panel-scope .overpayment-credit-record__summary>span:first-child{grid-column:1!important;grid-row:1!important;display:grid!important;gap:4px!important;min-width:0!important}
.customer-credit-panel-scope .overpayment-credit-record__summary>span:nth-child(2){grid-column:1!important;grid-row:2!important;justify-self:start!important}
.customer-credit-panel-scope .overpayment-credit-record__summary>strong{grid-column:2!important;grid-row:1/3!important;min-width:0!important;padding-right:12px!important;text-align:right!important}
.customer-credit-panel-scope .credit-note-id{display:inline-flex!important;grid-column:1!important;grid-row:1!important;width:max-content!important;max-width:100%!important;padding:6px 10px!important;border:1px solid #566477!important;border-radius:7px!important;background:#303c4b!important;color:#f1f4f8!important;font-size:13px!important;font-weight:800!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-note-customer{grid-column:1!important;grid-row:2!important;display:grid!important;gap:3px!important;min-width:0!important}
.customer-credit-panel-scope .credit-note-customer strong,
.customer-credit-panel-scope .overpayment-credit-record__summary>span:first-child strong{color:#f4f6f9!important;font-size:16px!important;line-height:1.35!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-note-customer small,
.customer-credit-panel-scope .credit-note-balance small,
.customer-credit-panel-scope .overpayment-credit-record__summary small{display:block!important;color:#aeb9c6!important;font-size:12px!important;line-height:1.4!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-note-balance{grid-column:2!important;grid-row:1/3!important;display:grid!important;gap:4px!important;text-align:right!important;min-width:0!important;padding-right:24px!important}
.customer-credit-panel-scope .credit-note-balance strong,
.customer-credit-panel-scope .overpayment-credit-record__summary>strong{color:#fff!important;font-size:19px!important;font-weight:800!important;font-variant-numeric:tabular-nums!important}
.customer-credit-panel-scope .credit-note-status{display:inline-flex!important;align-items:center!important;justify-content:center!important;grid-column:1!important;grid-row:3!important;width:max-content!important;max-width:100%!important;padding:5px 9px!important;border:1px solid #536174!important;border-radius:7px!important;background:#303b49!important;color:#e2e8f0!important;font-size:11px!important;font-weight:750!important;white-space:normal!important}
.customer-credit-panel-scope .status-available,
.customer-credit-panel-scope .status-partial,
.customer-credit-panel-scope .status-refunded,
.customer-credit-panel-scope .status-applied{background:#303b49!important;border-color:#536174!important;color:#e2e8f0!important}
.customer-credit-panel-scope .customer-credit-document,
.customer-credit-panel-scope .overpayment-credit-record__body{
 display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:14px!important;
 position:static!important;inset:auto!important;float:none!important;transform:none!important;
 width:100%!important;max-width:100%!important;min-width:0!important;height:auto!important;max-height:none!important;
 margin:0!important;padding:16px!important;overflow:visible!important;visibility:visible!important;opacity:1!important;
 border-top:1px solid #3d4958!important;background:#151c25!important;color:#e9eef4!important;
 font-family:Inter,"Segoe UI",Arial,sans-serif!important;font-size:14px!important;line-height:1.5!important;
}
.customer-credit-panel-scope .credit-modal-header,
.customer-credit-panel-scope .credit-doc-heading{display:flex!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;width:100%!important;min-width:0!important;margin:0!important;padding:0 0 10px!important;border:0!important;background:transparent!important}
.customer-credit-panel-scope .credit-modal-title{display:grid!important;gap:5px!important;min-width:0!important}
.customer-credit-panel-scope .credit-modal-title small,
.customer-credit-panel-scope .credit-doc-heading small{color:#aeb9c6!important;font-size:10px!important;font-weight:750!important;letter-spacing:.08em!important}
.customer-credit-panel-scope .credit-modal-title h3,
.customer-credit-panel-scope .credit-doc-heading h3{margin:0!important;color:#f3f6fa!important;font-size:20px!important;line-height:1.25!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-available-card{display:flex!important;flex-wrap:wrap!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;width:100%!important;min-width:0!important;margin:0!important;padding:15px!important;border:1px solid #465365!important;border-radius:11px!important;background:#273241!important;color:#edf2f7!important}
.customer-credit-panel-scope .credit-available-card>div{display:grid!important;gap:4px!important;min-width:0!important}
.customer-credit-panel-scope .credit-available-card small,
.customer-credit-panel-scope .credit-unused-badge{color:#c3ccd7!important;font-size:12px!important}
.customer-credit-panel-scope .credit-available-card strong{color:#fff!important;font-size:24px!important;font-weight:800!important}
.customer-credit-panel-scope .credit-unused-badge{padding:5px 9px!important;border:1px solid #566477!important;border-radius:7px!important;background:#303c4b!important}
.customer-credit-panel-scope .credit-details-card,
.customer-credit-panel-scope .credit-apply-section,
.customer-credit-panel-scope .overpayment-job-link{display:grid!important;gap:10px!important;width:100%!important;min-width:0!important;margin:0!important;padding:14px!important;border:1px solid #3c4857!important;border-radius:11px!important;background:#202a36!important;color:#eaf0f6!important}
.customer-credit-panel-scope .credit-details-card h4,
.customer-credit-panel-scope .credit-apply-section h4,
.customer-credit-panel-scope .overpayment-job-link h4{margin:0!important;color:#f2f5f9!important;font-size:15px!important;font-weight:750!important}
.customer-credit-panel-scope .credit-detail-row{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)!important;gap:8px!important;align-items:start!important;width:100%!important;min-width:0!important;padding:9px 0!important;border-bottom:1px solid #3b4653!important}
.customer-credit-panel-scope .credit-detail-row:last-child{border-bottom:0!important}
.customer-credit-panel-scope .credit-detail-row>span{min-width:0!important;color:#aeb9c6!important;font-size:13px!important}
.customer-credit-panel-scope .credit-detail-row>strong{min-width:0!important;color:#f1f4f8!important;font-size:13px!important;text-align:right!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-detail-row>strong small{display:block!important;margin-top:3px!important;color:#aeb9c6!important;font-size:12px!important}
.customer-credit-panel-scope .credit-note-validity{margin:0!important;padding:11px 12px!important;border-left:3px solid #8291a4!important;background:#202a36!important;color:#c5cfda!important;font-size:12px!important;line-height:1.5!important}
.customer-credit-panel-scope .customer-credit-actions{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:9px!important;width:100%!important;min-width:0!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important}
.customer-credit-panel-scope .customer-credit-actions>*,
.customer-credit-panel-scope .overpayment-job-link__fields>*{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;min-height:44px!important;margin:0!important}
.customer-credit-panel-scope input,
.customer-credit-panel-scope select,
.customer-credit-panel-scope textarea{box-sizing:border-box!important;width:100%!important;min-width:0!important;max-width:100%!important;min-height:44px!important;padding:10px 12px!important;border:1px solid #566477!important;border-radius:8px!important;background:#111923!important;color:#f1f4f8!important;font:inherit!important;font-size:14px!important}
.customer-credit-panel-scope button,
.customer-credit-panel-scope a.btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;max-width:100%!important;min-height:42px!important;padding:10px 14px!important;border:1px solid #5b687a!important;border-radius:8px!important;background:#354253!important;color:#f5f7fa!important;font:inherit!important;font-size:13px!important;font-weight:700!important;text-decoration:none!important;white-space:normal!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope button:disabled{opacity:.48!important}
.customer-credit-panel-scope .credit-doc-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;width:100%!important;min-width:0!important;padding-top:10px!important;border-top:1px solid #3c4857!important}
.customer-credit-panel-scope .credit-doc-actions>*{width:100%!important;min-width:0!important}
.customer-credit-panel-scope .customer-credit-history{display:block!important;width:100%!important;min-width:0!important;margin:0!important;padding:12px!important;border:1px solid #3c4857!important;border-radius:10px!important;background:#202a36!important;color:#c5cfda!important}
.customer-credit-panel-scope .customer-credit-history>summary{cursor:pointer!important;color:#f0f3f7!important;font-weight:700!important}
.customer-credit-panel-scope .credit-history-row{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:6px 10px!important;padding:10px 0!important;border-bottom:1px solid #3b4653!important}
.customer-credit-panel-scope .credit-history-row>*{min-width:0!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-doc-facts,
.customer-credit-panel-scope .credit-doc-totals{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;width:100%!important;min-width:0!important}
.customer-credit-panel-scope .credit-doc-facts>div,
.customer-credit-panel-scope .credit-doc-totals>div{display:grid!important;gap:4px!important;min-width:0!important;padding:11px!important;border:1px solid #3c4857!important;border-radius:8px!important;background:#202a36!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .credit-doc-facts small,
.customer-credit-panel-scope .credit-doc-totals small{color:#aeb9c6!important;font-size:11px!important}
.customer-credit-panel-scope .credit-doc-facts strong,
.customer-credit-panel-scope .credit-doc-totals strong{color:#f1f4f8!important;font-size:13px!important;overflow-wrap:anywhere!important}
.customer-credit-panel-scope .overpayment-job-link p{margin:0!important;color:#c1cbd6!important;font-size:13px!important}
.customer-credit-panel-scope .overpayment-job-link__fields{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:9px!important;width:100%!important;min-width:0!important}
.customer-credit-panel-scope .customer-credit-empty{padding:18px!important;border:1px solid #3c4857!important;border-radius:10px!important;background:#202a36!important;color:#c5cfda!important}
@media(max-width:900px){
 .customer-credit-panel-scope .customer-credit-summary{grid-template-columns:minmax(0,1fr)!important}
 .customer-credit-panel-scope .customer-credit-document,
 .customer-credit-panel-scope .overpayment-credit-record__body{padding:13px!important}
 .customer-credit-panel-scope .credit-doc-facts,
 .customer-credit-panel-scope .credit-doc-totals{grid-template-columns:minmax(0,1fr)!important}
 .customer-credit-panel-scope .credit-doc-actions{grid-template-columns:minmax(0,1fr)!important}
 .customer-credit-panel-scope .credit-detail-row{grid-template-columns:minmax(0,1fr)!important;gap:3px!important}
 .customer-credit-panel-scope .credit-detail-row>strong{text-align:left!important}
}
html,body{max-width:100%!important;overflow-x:hidden!important}
`;
document.head.appendChild(creditInlineStyle);
creditInlineStyle.textContent += `
.credit-note-dialog-overlay{position:fixed!important;inset:0!important;z-index:2147483600!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:clamp(10px,3vw,24px)!important;background:rgba(5,9,14,.78)!important;backdrop-filter:blur(5px)!important;overflow-y:auto!important;overscroll-behavior:contain!important}
.credit-note-dialog{display:flex!important;flex-direction:column!important;width:min(760px,100%)!important;max-width:100%!important;max-height:calc(100dvh - 24px)!important;min-width:0!important;margin:auto!important;overflow:hidden!important;border:1px solid #526174!important;border-radius:16px!important;background:#1b232e!important;box-shadow:0 24px 80px rgba(0,0,0,.55)!important}
.credit-note-dialog-head{position:sticky!important;top:0!important;z-index:2!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;flex:none!important;padding:12px 16px!important;border-bottom:1px solid #3c4857!important;background:#252f3c!important;color:#f2f5f8!important;font-size:14px!important}
.credit-note-dialog-close{display:grid!important;place-items:center!important;width:38px!important;height:38px!important;flex:none!important;border:1px solid #566477!important;border-radius:9px!important;background:#354253!important;color:#fff!important;font-size:25px!important;line-height:1!important;cursor:pointer!important}
.credit-dialog-content{min-width:0!important;max-width:100%!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important}
.credit-note-dialog .customer-credit-document,.credit-note-dialog .overpayment-credit-record__body{width:100%!important;max-width:100%!important;min-width:0!important;max-height:none!important;overflow:visible!important;border:0!important;border-radius:0!important}
@media(max-width:600px){.credit-note-dialog-overlay{align-items:center!important;padding:10px!important}.credit-note-dialog{width:100%!important;max-height:calc(100dvh - 20px)!important;border-radius:14px!important}.credit-note-dialog .customer-credit-document,.credit-note-dialog .overpayment-credit-record__body{padding:12px!important}}
`;

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && activeCreditDialog) closeCreditDetails();
});

document.addEventListener("click", event => {
  const summary = event.target instanceof Element ? event.target.closest(".customer-credit-record__summary, .overpayment-credit-record__summary") : null;
  if (!summary) return;
  const record = summary.closest("details[data-credit-note-id], details[data-overpayment-credit-id]");
  if (!record) return;
  event.preventDefault();
  openCreditDetails(record);
}, true);

document.addEventListener("click", async event => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;
  const printButton = target.closest("[data-credit-print]");
  if (printButton) {
    const note = creditNotes.find(item => item.id === printButton.dataset.creditPrint);
    if (note) printCreditNote(note);
    return;
  }
  const overpaymentPrintButton = target.closest("[data-overpayment-print]");
  if (overpaymentPrintButton) {
    const note = overpaymentCreditNotes.find(item => item.id === overpaymentPrintButton.dataset.overpaymentPrint);
    if (!note) return;
    const invoice = Array.isArray(note.invoices) ? (note.invoices[0] || {}) : (note.invoices || {});
    const available = Number(note.customer_overpayment_credits?.available_amount ?? note.amount) || 0;
    const refunded = overpaymentRefunds.filter(row => row.credit_note_id === note.id && !row.voided_at)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const applied = Math.max(0, Number(note.amount || 0) - available - refunded);
    const popup = window.open("", "_blank", "width=900,height=720");
    if (!popup) { showMessage("Allow pop-ups for this site to print the credit note.", "error"); return; }
    popup.document.write("<!doctype html><html><head><meta charset='utf-8'><title>CN-" +
      String(note.note_number).padStart(5, "0") + " · Centric Auto Mobile</title><style>" +
      "*{box-sizing:border-box}body{margin:0;padding:28px;background:#eef1f4;color:#17212b;font:14px/1.5 Arial,sans-serif}.sheet{max-width:820px;margin:auto;background:#fff;border:1px solid #dce2e8}.hero{padding:28px;background:#27364d;color:#fff}.hero h1{margin:0}.amount{font-size:28px;font-weight:800}.facts{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:22px 28px}.facts div{padding:12px;background:#f5f7f9}.facts small{display:block;color:#687789;text-transform:uppercase;font-size:10px}.totals{padding:0 28px 24px}.line{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e2e6eb}footer{text-align:center;padding:18px;color:#657384}@page{size:auto;margin:0}@media print{body{padding:10mm;background:#fff}.sheet{border:0}}@media(max-width:600px){body{padding:10px}.facts{grid-template-columns:1fr}}</style></head><body>" +
      "<main class='sheet'><header class='hero'><h1>CN-" + String(note.note_number).padStart(5, "0") +
      "</h1><p>Invoice overpayment credit note</p><div class='amount'>" + money(note.amount) +
      "</div></header><section class='facts'><div><small>Customer</small><strong>" + escapeHtml(note.customer_name || "—") +
      "</strong></div><div><small>Phone</small><strong>" + escapeHtml(note.customer_phone || "—") +
      "</strong></div><div><small>Email</small><strong>" + escapeHtml(invoice.customer_email || "—") +
      "</strong></div><div><small>Original invoice</small><strong>" + escapeHtml(invoice.invoice_number || "—") +
      "</strong></div><div><small>Invoice total</small><strong>" + money(invoice.total) +
      "</strong></div><div><small>Issued</small><strong>" + dateLabel(note.issued_at) +
      "</strong></div></section><section class='totals'><div class='line'><span>Applied</span><strong>" + money(applied) +
      "</strong></div><div class='line'><span>Refunded</span><strong>" + money(refunded) +
      "</strong></div><div class='line'><span>Carried forward</span><strong>" + money(available) +
      "</strong></div></section><footer>CENTRIC AUTO MOBILE · Auto Parts &amp; Repairs · Norton, Zimbabwe</footer></main></body></html>");
    popup.document.close(); popup.focus(); setTimeout(() => popup.print(), 350);
    return;
  }
  const linkOverpaymentButton = target.closest("[data-link-overpayment-job]");
  if (linkOverpaymentButton) {
    const fields = linkOverpaymentButton.closest("[data-overpayment-link]");
    const note = overpaymentCreditNotes.find(item => item.id === fields?.dataset.overpaymentLink);
    if (!note || !fields) return;
    const value = key => fields.querySelector('[data-match="' + key + '"]')?.value.trim() || "";
    const name = value("name"), email = value("email"), phone = value("phone");
    const checklist = value("checklist").replace(/^#/, "").trim();
    const invoice = Array.isArray(note.invoices) ? (note.invoices[0] || {}) : (note.invoices || {});
    const digits = value => String(value || "").replace(/\D/g, "");
    const normalName = value => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (!name || !email || !phone || !checklist) {
      showMessage("Enter the customer name, email, phone number and checklist number.", "error");
      return;
    }
    if (normalName(name) !== normalName(note.customer_name) ||
        email.toLocaleLowerCase() !== String(invoice.customer_email || "").trim().toLocaleLowerCase() ||
        digits(phone) !== digits(note.customer_phone)) {
      showMessage("Customer details do not match the original credit note. Check the name, email and phone.", "error");
      return;
    }
    linkOverpaymentButton.disabled = true;
    linkOverpaymentButton.textContent = "Verifying job card…";
    try {
      const { data: job, error: jobError } = await supabase.from("repair_jobs")
        .select("id, checklist_number").eq("checklist_number", checklist).maybeSingle();
      if (jobError) throw jobError;
      if (!job) throw new Error("No job card was found with that checklist number.");
      const { error } = await supabase.rpc("link_overpayment_credit_to_job", {
        p_credit_note_id: note.id, p_repair_job_id: job.id,
      });
      if (error) throw error;
      await load();
      showMessage("Customer credit note verified and linked to the job card.", "success");
    } catch (error) {
      showMessage(error.message || "The credit note could not be linked.", "error");
      linkOverpaymentButton.disabled = false;
      linkOverpaymentButton.textContent = "Verify and link next job card";
    }
    return;
  }
  const applyButton = target.closest(".customer-credit-apply");
  const reverseButton = target.closest(".customer-credit-reverse");
  if (!applyButton && !reverseButton) return;

  if (reverseButton) {
    const reason = prompt("Reason for reversing this customer-credit transaction:")?.trim();
    if (!reason) return;
    reverseButton.disabled = true;
    const { error } = await supabase.rpc("reverse_customer_credit_movement", {
      p_movement_id: reverseButton.dataset.movementId,
      p_reason: reason,
    });
    if (error) {
      showMessage(error.message, "error");
      reverseButton.disabled = false;
      return;
    }
    await load();
    showMessage("Credit transaction reversed with a compensating journal entry.", "success");
    return;
  }

  const action = applyButton.closest("[data-action]");
  const amount = Number(action.querySelector(".credit-amount")?.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showMessage("Enter an amount greater than zero.", "error");
    return;
  }
  const idempotencyKey = action.dataset.idempotencyKey || crypto.randomUUID();
  action.dataset.idempotencyKey = idempotencyKey;
  applyButton.disabled = true;
  try {
    const [targetType, targetId] = (action.querySelector(".credit-target")?.value || "").split("|");
    if (!targetType || !targetId) throw new Error("Choose a same-customer repair job, sale or invoice.");
    const result = await supabase.rpc("apply_customer_credit", {
      p_deposit_receipt_id: action.dataset.creditId,
      p_amount: amount,
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: "Staff-applied quotation deposit",
      p_idempotency_key: idempotencyKey,
    });
    if (result.error) throw result.error;
    await load();
    showMessage("Credit applied to the customer balance.", "success");
  } catch (error) {
    showMessage(error.message || "The customer-credit transaction could not be completed.", "error");
    applyButton.disabled = false;
  }
}, true);

["customer-credit-search","customer-credit-from","customer-credit-to","customer-credit-status","customer-credit-method","customer-credit-min","customer-credit-max"].forEach(id => {
  const field = document.getElementById(id);
  field?.addEventListener("input", render);
  field?.addEventListener("change", render);
});
document.getElementById("customer-credit-clear")?.addEventListener("click", () => {
  ["customer-credit-search","customer-credit-from","customer-credit-to","customer-credit-status","customer-credit-method","customer-credit-min","customer-credit-max"].forEach(id => { const field = document.getElementById(id); if (field) field.value = ""; });
  render();
});
async function safeLoad() {
  let timer;
  try {
    await Promise.race([
      load(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Customer credit request timed out. Check your connection and tap refresh to try again.")), 15000);
      }),
    ]);
  } catch (error) {
    console.error("Customer credit notes failed to load:", error);
    list.innerHTML = '<div class="customer-credit-empty">Could not load credit notes: ' + escapeHtml(error?.message || String(error)) + '<br><button type="button" class="btn" id="customer-credit-load-retry" style="margin-top:12px">Try again</button></div>';
    document.getElementById("customer-credit-load-retry")?.addEventListener("click", safeLoad);
  } finally {
    clearTimeout(timer);
  }
}
refreshButton?.addEventListener("click", safeLoad);
safeLoad();

const creditLiveChannel = supabase.channel("customer-credit-job-status")
  .on("postgres_changes", { event: "*", schema: "public", table: "repair_jobs" }, () => load())
  .on("postgres_changes", { event: "*", schema: "public", table: "quotations" }, () => load())
  .subscribe();
window.addEventListener("focus", () => load());
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
