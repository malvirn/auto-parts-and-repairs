import supabase from "./supabaseClient.js";

const panel = document.getElementById("customer-credit-panel");
const list = document.getElementById("customer-credit-list");
const refreshButton = document.getElementById("customer-credit-refresh");
if (!panel || !list) throw new Error("Customer credit panel is missing from the Receipts page.");

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
  list.innerHTML = '<div class="customer-credit-empty">Loading quotation credit notes…</div>';
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

  const failure = receiptsResult.error || balancesResult.error || movementsResult.error || targetsResult.error;
  if (failure) {
    list.innerHTML = `<div class="customer-credit-empty">Customer credit is unavailable: ${escapeHtml(failure.message)}</div>`;
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
    overpaymentCreditNotes = [];
  } else {
    overpaymentCreditNotes = overpaymentResult.data || [];
  }

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
  render();

  const requestedId = new URLSearchParams(location.search).get("credit_note_id");
  if (requestedId) {
    const card = list.querySelector(`[data-credit-note-id="${CSS.escape(requestedId)}"]`);
    if (card) {
      card.open = true;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.querySelector(".customer-credit-print")?.focus({ preventScroll: true });
    } else {
      showMessage("The requested quotation credit note could not be found. You can still view all previous receipts below.", "error");
    }
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
    @media print{body{padding:0;background:#fff}.sheet{border:0;border-radius:0}.print{display:none}}
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
  if (!rows.length) return '<section class="credit-unpaid-jobs"><h4>Unpaid job cards</h4><p>No unpaid job cards for this customer.</p></section>';
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
  const openModalRecord = document.querySelector(".credit-note-modal[open]");
  if (openModalRecord) closeCreditModal(openModalRecord);
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
      }).join("")}</details>` : '<small class="customer-credit-history">No applications or refunds recorded.</small>';
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
            <button type="button" class="credit-modal-close" data-credit-modal-close aria-label="Close credit note">×</button>
          </header>
          <section class="credit-available-card">
            <div><small>Available credit</small><strong>${money(note.available_amount)}</strong></div>
            <span class="credit-unused-badge">Unused</span>
          </section>
          <section class="credit-details-card" aria-label="Credit note details">
            <h4>Credit note details</h4>
            <div class="credit-detail-row"><span>Customer</span><strong>${escapeHtml(noteName)}<small>${escapeHtml(note.customer_phone || "No phone recorded")}</small></strong></div>
            <div class="credit-detail-row"><span>Source</span><strong>Deposit · Quotation #${escapeHtml(quoteNumber)}</strong></div>
            <div class="credit-detail-row"><span>Paid by</span><strong>${escapeHtml(note.payment_method || "Not recorded")} · ${dateLabel(note.payment_date)}</strong></div>
            <div class="credit-detail-row"><span>Original deposit</span><strong>${money(note.amount)}</strong></div>
            <div class="credit-detail-row"><span>Applied</span><strong>${money(status.applied)}</strong></div>
            <div class="credit-detail-row"><span>Refunded</span><strong>${money(status.refunded)}</strong></div>
            <div class="credit-detail-row"><span>Job card</span><strong>${job ? escapeHtml(job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : "Pending"}</strong></div>
          </section>
          <p class="credit-note-validity">${expired ? "Quotation deposit window expired. Existing credit remains available." : "Quotation deposit valid for seven days from issue."}</p>
          <section class="credit-apply-section">
            <h4>Apply this credit</h4>
            ${applyFields || '<p class="credit-apply-empty">No credit is currently available to apply.</p>'}
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
      const phone = String(note.customer_phone || "").replace(/\\D/g,"");
      const message = `Centric Auto Mobile credit note CN-${String(note.note_number).padStart(5,"0")}. Customer: ${note.customer_name || "Customer"}. Invoice: ${invoiceNumber}. Amount: ${money(note.amount)}. Carried forward: ${money(available)}.`;
      const wa = phone ? "https://wa.me/" + phone + "?text=" + encodeURIComponent(message) : "";
      const mail = invoice.customer_email ? "mailto:" + encodeURIComponent(invoice.customer_email) + "?subject=" + encodeURIComponent("Centric Auto Mobile " + number) + "&body=" + encodeURIComponent(message) : "";
      const jobLink = Array.isArray(note.customer_overpayment_credit_job_links) ? (note.customer_overpayment_credit_job_links[0] || {}) : (note.customer_overpayment_credit_job_links || {});
      const linked = jobLink.repair_job_id || "";
      const link = linked ? '<a class="btn" href="repairs.html?highlight=' + encodeURIComponent(linked) + '">Open linked job card</a>' :
        '<section class="overpayment-job-link"><h4>Link carried-forward amount to the next job card</h4><p>Enter the customer name, phone and checklist number from the next job card. All three must match.</p><div class="overpayment-job-link__fields" data-overpayment-link="' + escapeHtml(note.id) + '" data-credit-note-id="' + escapeHtml(note.id) + '"><input data-match="name" placeholder="Customer full name" required><input data-match="phone" type="tel" placeholder="Customer phone number" required><input data-match="checklist" placeholder="Next job card checklist number" required><button class="btn btn--primary" type="button" data-link-overpayment-job>Verify and link next job card</button></div></section>';
      return '<details class="customer-credit-record overpayment-credit-record" style="margin-top:10px"><summary class="overpayment-credit-record__summary"><span><strong>' + number + '</strong><small>' + escapeHtml(note.customer_name || "Customer") + ' · ' + escapeHtml(invoiceNumber) + '</small></span><span class="credit-note-status status-' + tone + '">' + status + '</span><strong>' + money(available) + '<small>Carried forward</small></strong></summary><div class="overpayment-credit-record__body"><div class="credit-doc-heading"><div><small>CENTRIC AUTO MOBILE · INVOICE OVERPAYMENT</small><h3>' + number + '</h3><button type="button" class="credit-modal-close" data-credit-modal-close aria-label="Close credit note">×</button></div><span class="credit-note-status status-' + tone + '">' + status + '</span></div><div class="credit-doc-facts"><div><small>Customer name</small><strong>' + escapeHtml(note.customer_name || "—") + '</strong></div><div><small>Phone</small><strong>' + escapeHtml(note.customer_phone || "—") + '</strong></div><div><small>Email</small><strong>' + escapeHtml(invoice.customer_email || "—") + '</strong></div><div><small>Original invoice</small><strong>' + escapeHtml(invoiceNumber) + '</strong></div><div><small>Original invoice total</small><strong>' + money(invoice.total) + '</strong></div><div><small>Issued</small><strong>' + dateLabel(note.issued_at) + '</strong></div><div><small>Original job card</small><strong>' + (linked ? "Linked" : "Not linked") + '</strong></div><div><small>Status</small><strong>' + status + '</strong></div></div><div class="credit-doc-totals"><div><small>Credit note amount</small><strong>' + money(note.amount) + '</strong></div><div><small>Refunded</small><strong>' + money(refunded) + '</strong></div><div><small>Applied</small><strong>' + money(applied) + '</strong></div><div><small>Amount carried forward</small><strong>' + money(available) + '</strong></div></div><div class="credit-doc-actions"><button class="btn" type="button" data-overpayment-print="' + escapeHtml(note.id) + '"><i data-lucide="printer"></i> Print</button>' + (wa ? '<a class="btn" href="' + wa + '" target="_blank" rel="noopener"><i data-lucide="message-circle"></i> WhatsApp</a>' : '<button class="btn" disabled>WhatsApp unavailable</button>') + (mail ? '<a class="btn" href="' + mail + '"><i data-lucide="mail"></i> Email</a>' : '<button class="btn" disabled>Email unavailable</button>') + '</div>' + link + '</div></details>';
    }).join("");
    list.insertAdjacentHTML("beforeend",
      '<section style="margin-top:24px"><div class="rc-tabs"><div><p class="section-kicker">Invoice overpayments</p><h3 style="margin:0">Overpayment Credit Notes</h3></div><span class="grow"></span><strong>' + money(overpaymentTotal) + ' carried forward</strong></div>' +
      '<p class="invoice-billing-note">Credit notes issued when a customer pays more than the invoice or job total. These amounts remain customer credit and are not counted as new income.</p><div class="customer-credit-records">' + invoiceNotesHtml + '</div>' + '</section>');
  }
  window.lucide?.createIcons();
}

function closeCreditModal(record) {
  if (!record) return;
  record.open = false;
  record.classList.remove("credit-note-modal");
  const overlay = record._creditModalOverlay;
  const placeholder = record._creditModalPlaceholder;
  if (placeholder?.parentNode) placeholder.replaceWith(record);
  if (overlay?.isConnected) overlay.remove();
  delete record._creditModalPlaceholder;
  delete record._creditModalOverlay;
  document.body.classList.remove("credit-modal-open");
  document.body.style.overflow = record._creditPreviousBodyOverflow || "";
  delete record._creditPreviousBodyOverflow;
}

function openCreditModal(record) {
  if (!record || record._creditModalOverlay) return;
  const overlay = document.createElement("div");
  overlay.className = "credit-modal-overlay";
  overlay.setAttribute("role", "presentation");
  const sheet = document.createElement("div");
  sheet.className = "credit-modal-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", "Customer credit note");
  record._creditModalPlaceholder = document.createComment("Credit note location");
  record.parentNode?.insertBefore(record._creditModalPlaceholder, record);
  record._creditPreviousBodyOverflow = document.body.style.overflow;
  record._creditModalOverlay = overlay;
  record.open = true;
  record.classList.add("credit-note-modal");
  sheet.appendChild(record);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  document.body.classList.add("credit-modal-open");
  document.body.style.overflow = "hidden";
  overlay.querySelector(".credit-modal-close")?.focus({ preventScroll: true });
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeCreditModal(document.querySelector(".credit-note-modal[open]"));
});

document.addEventListener("click", async event => {
  const closeButton = event.target.closest("[data-credit-modal-close]");
  if (closeButton) {
    closeCreditModal(closeButton.closest(".credit-note-modal"));
    return;
  }
  if (event.target.classList?.contains("credit-modal-overlay")) {
    closeCreditModal(event.target.querySelector(".credit-note-modal"));
    return;
  }
  const creditSummary = event.target.closest(".customer-credit-record:not(.overpayment-credit-record) > summary");
  if (creditSummary) {
    event.preventDefault();
    openCreditModal(creditSummary.parentElement);
    return;
  }
  const printButton = event.target.closest("[data-credit-print]");
  if (printButton) {
    const note = creditNotes.find(item => item.id === printButton.dataset.creditPrint);
    if (note) printCreditNote(note);
    return;
  }
  const applyButton = event.target.closest(".customer-credit-apply");
  const reverseButton = event.target.closest(".customer-credit-reverse");
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
});

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
  try {
    await load();
  } catch (error) {
    console.error("Customer credit notes failed to load:", error);
    list.innerHTML = `<div class="customer-credit-empty">Couldn't load credit notes: ${escapeHtml(error?.message || String(error))}. Tap refresh to try again.</div>`;
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
