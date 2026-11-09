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
let movements = [];
let targets = [];
let accounts = [];
let jobsById = new Map();
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
  const [receiptsResult, balancesResult, movementsResult, targetsResult, accountsResult, authResult] = await Promise.all([
    supabase.from("quotation_deposit_receipts")
      .select("id, credit_note_number, quotation_id, customer_id, customer_name, customer_phone, amount, payment_method, payment_date, reference, created_at, journal_entry_id, quotations(quotation_number, created_at, repair_job_id)")
      .order("created_at", { ascending: false }),
    supabase.from("customer_credit_balances").select("deposit_receipt_id, available_amount"),
    supabase.from("customer_credit_movements")
      .select("id, deposit_receipt_id, movement_type, amount, target_type, target_id, payment_account_id, reason, journal_entry_id, created_at, reversed_at, reversal_reason, reversal_journal_entry_id")
      .order("created_at", { ascending: false }),
    supabase.from("customer_account_statement")
      .select("customer_id, customer_name, source_id, source_type, reference, balance_due")
      .gt("balance_due", 0.005),
    supabase.from("accounts").select("id, code, name")
      .eq("is_active", true).eq("type", "asset").like("code", "10%").order("code"),
    supabase.auth.getUser(),
  ]);

  const failure = receiptsResult.error || balancesResult.error || movementsResult.error || targetsResult.error;
  if (failure) {
    list.innerHTML = `<div class="customer-credit-empty">Customer credit is unavailable: ${escapeHtml(failure.message)}</div>`;
    return;
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
  accounts = accountsResult.error ? [] : (accountsResult.data || []);

  const jobIds = [...new Set(creditNotes.map(note => note.quotations?.repair_job_id).filter(Boolean))];
  jobsById = new Map();
  if (jobIds.length) {
    const { data: jobs, error } = await supabase.from("repair_jobs")
      .select("id, job_number, cro_number, checklist_number")
      .in("id", jobIds);
    if (!error) (jobs || []).forEach(job => jobsById.set(job.id, job));
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
  const applied = noteMovements.filter(item => item.movement_type === "apply" && !item.reversed_at)
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
  const popup = window.open("", "_blank", "width=900,height=720");
  if (!popup) {
    showMessage("Allow pop-ups for this site to print the credit note.", "error");
    return;
  }
  const rows = movementsForNote.map(item => `<tr><td>${escapeHtml(item.movement_type === "refund" ? "Refund" : "Credit applied")}</td><td>${dateLabel(item.created_at)}</td><td>${money(item.amount)}</td><td>${escapeHtml(item.reason || "—")}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${number} · Centric Auto Mobile</title>
  <style>
    *{box-sizing:border-box}body{margin:0;padding:32px;background:#eef1f4;color:#17212b;font:14px/1.5 Inter,Arial,sans-serif}
    .sheet{max-width:820px;margin:auto;padding:38px;background:#fff;border:1px solid #dce2e8;border-radius:14px}
    .top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:3px solid #16a05a;padding-bottom:20px}
    .brand{display:flex;gap:14px;align-items:center}.brand img{width:74px;height:74px;object-fit:contain}.brand h1{font-size:20px;margin:0}.muted{color:#657384}
    .doc{text-align:right}.doc h2{font-size:23px;margin:0 0 5px}.pill{display:inline-block;padding:5px 11px;border-radius:99px;background:#e8f7ee;color:#167342;font-weight:700}
    .facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:24px 0}.fact{padding:12px 14px;background:#f6f8fa;border:1px solid #e3e8ed;border-radius:9px}.fact small{display:block;color:#64748b;text-transform:uppercase;font-size:10px;font-weight:700;letter-spacing:.08em}.fact strong{display:block;margin-top:4px}
    .amount{display:flex;justify-content:space-between;align-items:center;margin:20px 0;padding:18px 20px;background:#f0f8f3;border:1px solid #cdebd8;border-radius:10px}.amount strong{font-size:26px}
    table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e9ed}th{background:#f5f7f9;font-size:11px;text-transform:uppercase;color:#64748b}
    footer{margin-top:28px;padding-top:14px;border-top:1px solid #e5e9ed;text-align:center;color:#657384;font-size:12px}
    .print{margin:0 0 18px;padding:10px 16px;border:0;border-radius:8px;background:#17212b;color:#fff;font-weight:700;cursor:pointer}
    @media print{body{padding:0;background:#fff}.sheet{border:0;border-radius:0;padding:0}.print{display:none}}
    @media(max-width:600px){body{padding:10px}.sheet{padding:18px}.top{flex-direction:column}.doc{text-align:left}.facts{grid-template-columns:1fr}}
  </style></head><body><button class="print" onclick="window.print()">Print credit note</button><main class="sheet">
    <header class="top"><div class="brand"><img src="../assets/logo.png" alt="Centric Auto Mobile"><div><h1>CENTRIC AUTO MOBILE</h1><div class="muted">Auto Parts &amp; Repairs</div><div class="muted">Norton, Zimbabwe</div></div></div>
    <div class="doc"><h2>CUSTOMER CREDIT NOTE</h2><strong>${number}</strong><div class="pill">${status.label}</div></div></header>
    <section class="facts">
      <div class="fact"><small>Customer</small><strong>${escapeHtml(note.customer_name || "Customer")}</strong><span class="muted">${escapeHtml(note.customer_phone || "—")}</span></div>
      <div class="fact"><small>Quotation</small><strong>${escapeHtml(quote.quotation_number ?? "—")}</strong><span class="muted">Issued ${dateLabel(quote.created_at)}</span></div>
      <div class="fact"><small>Checklist number</small><strong>${job?.checklist_number ? `#${escapeHtml(job.checklist_number)}` : "Not linked yet"}</strong><span class="muted">${job ? escapeHtml(job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : "A checklist appears when the quotation creates a job card"}</span></div>
      <div class="fact"><small>Payment details</small><strong>${escapeHtml(note.payment_method)}</strong><span class="muted">${dateLabel(note.payment_date)} · ${escapeHtml(note.reference || "No reference")}</span></div>
    </section>
    <div class="amount"><div><small>Original deposit</small><div class="muted">Available balance after applications and refunds</div></div><strong>${money(note.amount)}</strong></div>
    <section class="facts"><div class="fact"><small>Applied to customer work</small><strong>${money(status.applied)}</strong></div><div class="fact"><small>Refunded</small><strong>${money(status.refunded)}</strong></div><div class="fact"><small>Available credit</small><strong>${money(note.available_amount)}</strong></div><div class="fact"><small>Issued</small><strong>${dateLabel(note.payment_date)}</strong></div></section>
    <h3>Credit note activity</h3><table><thead><tr><th>Action</th><th>Date</th><th>Amount</th><th>Details</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No credit movements recorded.</td></tr>'}</tbody></table>
    <footer>Customer deposit liability account 2300 · Retain this document for your records.<br>Centric Auto Mobile · ${new Date().getFullYear()}</footer>
  </main></body></html>`);
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 350);
}

function render() {
  if (!creditNotes.length) {
    list.innerHTML = '<div class="customer-credit-empty">No quotation deposit credit notes have been issued yet.</div>';
    return;
  }
  const accountOptions = accounts.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.code)} · ${escapeHtml(account.name)}</option>`).join("");
  const totalOriginal = creditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);
  const totalAvailable = creditNotes.reduce((sum, note) => sum + Number(note.available_amount || 0), 0);
  const totalRefunded = creditNotes.reduce((sum, note) => sum + noteStatus(note, movements.filter(m => m.deposit_receipt_id === note.id)).refunded, 0);
  list.innerHTML = `
    <div class="customer-credit-summary"><div><small>Deposits issued</small><strong>${money(totalOriginal)}</strong></div><div><small>Refunded</small><strong>${money(totalRefunded)}</strong></div><div><small>Credit remaining</small><strong>${money(totalAvailable)}</strong></div></div>
    <div class="customer-credit-records">${creditNotes.map(note => {
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
      const refundFields = canRefund && accounts.length && note.available_amount > 0.005
        ? `<div class="customer-credit-actions" data-credit-id="${escapeHtml(note.id)}" data-action="refund">
            <select class="credit-account" aria-label="Refund payment account"><option value="">Refund from…</option>${accountOptions}</select>
            <input class="credit-amount" type="number" min="0.01" max="${note.available_amount}" step="0.01" placeholder="Amount" aria-label="Refund amount">
            <input class="credit-reason" maxlength="240" placeholder="Refund reason" aria-label="Refund reason">
            <button type="button" class="btn btn--danger customer-credit-refund">Refund</button>
          </div>` : "";
      const refundNotice = canRefund && !accounts.length
        ? '<small>Refund accounts are unavailable; refunding is disabled.</small>'
        : canRefund ? "" : '<small>Refunds require Accounting or Super Admin access.</small>';
      const applyFields = note.available_amount > 0.005
        ? `<div class="customer-credit-actions" data-credit-id="${escapeHtml(note.id)}" data-action="apply">
            <select class="credit-target" aria-label="Apply credit to" ${quoteTargets.length ? "" : "disabled"}><option value="">${quoteTargets.length ? "Apply to customer balance…" : "No same-customer balance"}</option>${targetOptions}</select>
            <input class="credit-amount" type="number" min="0.01" max="${note.available_amount}" step="0.01" placeholder="Amount" aria-label="Credit amount">
            <button type="button" class="btn customer-credit-apply" ${quoteTargets.length ? "" : "disabled"}>Apply credit</button>
          </div>` : "";
      return `<details class="customer-credit-record" data-credit-note-id="${escapeHtml(note.id)}">
        <summary class="customer-credit-record__summary">
          <span class="credit-note-id">QCN-${String(note.credit_note_number).padStart(6, "0")}</span>
          <span class="credit-note-customer"><strong>${escapeHtml(noteName)}</strong><small>Quotation #${escapeHtml(quoteNumber)} · ${dateLabel(note.payment_date)}</small></span>
          <span class="credit-note-balance"><strong>${money(note.available_amount)}</strong><small>Available</small></span>
          <span class="credit-note-status status-${status.tone}">${status.label}</span>
        </summary>
        <div class="customer-credit-document">
          <div class="credit-doc-heading"><div><small>CENTRIC AUTO MOBILE · CUSTOMER CREDIT NOTE</small><h3>QCN-${String(note.credit_note_number).padStart(6, "0")}</h3></div><span class="credit-note-status status-${status.tone}">${status.label}</span></div>
          <div class="credit-doc-facts">
            <div><small>Customer</small><strong>${escapeHtml(noteName)}</strong><span>${escapeHtml(note.customer_phone || "—")}</span></div>
            <div><small>Quotation</small><strong>#${escapeHtml(quoteNumber)}</strong><span>Issued ${dateLabel(quote.created_at)}</span></div>
            <div><small>Checklist number</small><strong>${job?.checklist_number ? `#${escapeHtml(job.checklist_number)}` : "Pending job card"}</strong><span>${job ? escapeHtml(job.cro_number || `JC-${String(job.job_number).padStart(5, "0")}`) : "Updates when a job card is created"}</span></div>
            <div><small>Payment</small><strong>${escapeHtml(note.payment_method)}</strong><span>${dateLabel(note.payment_date)} · ${escapeHtml(note.reference || "No reference")}</span></div>
          </div>
          <div class="credit-doc-totals"><div><small>Original deposit</small><strong>${money(note.amount)}</strong></div><div><small>Refunded</small><strong>${money(status.refunded)}</strong></div><div><small>Applied</small><strong>${money(status.applied)}</strong></div><div><small>Available credit</small><strong>${money(note.available_amount)}</strong></div></div>
          <div class="credit-doc-actions"><button type="button" class="btn customer-credit-print" data-credit-print="${escapeHtml(note.id)}"><i data-lucide="printer"></i> Print receipt</button><span>${expired ? "Quotation deposit window expired. Existing credit remains available." : "Quotation deposit valid for seven days from issue."}</span></div>
          ${applyFields}${refundFields}${refundNotice}${history}
        </div>
      </details>`;
    }).join("")}</div>`;
  window.lucide?.createIcons();
}

list.addEventListener("input", event => {
  const action = event.target.closest("[data-action]");
  if (action) delete action.dataset.idempotencyKey;
});
list.addEventListener("change", event => {
  const action = event.target.closest("[data-action]");
  if (action) delete action.dataset.idempotencyKey;
});
list.addEventListener("click", async event => {
  const printButton = event.target.closest("[data-credit-print]");
  if (printButton) {
    const note = creditNotes.find(item => item.id === printButton.dataset.creditPrint);
    if (note) printCreditNote(note);
    return;
  }
  const applyButton = event.target.closest(".customer-credit-apply");
  const refundButton = event.target.closest(".customer-credit-refund");
  const reverseButton = event.target.closest(".customer-credit-reverse");
  if (!applyButton && !refundButton && !reverseButton) return;

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

  const action = (applyButton || refundButton).closest("[data-action]");
  const amount = Number(action.querySelector(".credit-amount")?.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showMessage("Enter an amount greater than zero.", "error");
    return;
  }
  const idempotencyKey = action.dataset.idempotencyKey || crypto.randomUUID();
  action.dataset.idempotencyKey = idempotencyKey;
  (applyButton || refundButton).disabled = true;
  try {
    let result;
    if (applyButton) {
      const [targetType, targetId] = (action.querySelector(".credit-target")?.value || "").split("|");
      if (!targetType || !targetId) throw new Error("Choose a same-customer repair job, sale or invoice.");
      result = await supabase.rpc("apply_customer_credit", {
        p_deposit_receipt_id: action.dataset.creditId,
        p_amount: amount,
        p_target_type: targetType,
        p_target_id: targetId,
        p_reason: "Staff-applied quotation deposit",
        p_idempotency_key: idempotencyKey,
      });
    } else {
      if (!canRefund) throw new Error("Only Accounting or Super Admin users can refund customer credit.");
      const accountId = action.querySelector(".credit-account")?.value;
      const reason = action.querySelector(".credit-reason")?.value.trim();
      if (!accountId || !reason) throw new Error("Choose a refund account and enter a reason.");
      result = await supabase.rpc("refund_customer_credit", {
        p_deposit_receipt_id: action.dataset.creditId,
        p_amount: amount,
        p_payment_account_id: accountId,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
      });
    }
    if (result.error) throw result.error;
    await load();
    showMessage(applyButton ? "Credit applied to the customer balance." : "Refund recorded. Available credit and dashboard totals have been reduced.", "success");
  } catch (error) {
    showMessage(error.message || "The customer-credit transaction could not be completed.", "error");
    (applyButton || refundButton).disabled = false;
  }
});

refreshButton?.addEventListener("click", load);
load();
