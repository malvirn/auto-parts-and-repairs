import supabase from "./supabaseClient.js";

const payableForm = document.getElementById("payable-form");
const payableFormMessage = document.getElementById("payable-form-message");
const supplierNameInput = document.getElementById("pay-supplier-name");
const supplierOptions = document.getElementById("pay-supplier-options");
const debitAccountSelect = document.getElementById("pay-debit-account");
const billDateInput = document.getElementById("pay-bill-date");
const dueDateInput = document.getElementById("pay-due-date");
const agingCards = document.getElementById("aging-cards");
const payablesTable = document.getElementById("payables-table");
const overdueNotice = document.getElementById("payables-overdue");

const paymentModal = document.getElementById("payment-modal");
const paymentSummary = document.getElementById("payment-modal-summary");
const paymentAmountInput = document.getElementById("payment-amount");
const paymentDateInput = document.getElementById("payment-date");
const paymentCreditAccountSelect = document.getElementById("payment-credit-account");
const paymentSaveBtn = document.getElementById("payment-save");
const paymentCancelBtn = document.getElementById("payment-cancel");
const paymentFormMessage = document.getElementById("payment-form-message");

let suppliers = [];
let accounts = [];
let payables = [];
let payablePayments = [];
let paymentReversals = new Map();
let payableJournalLines = new Map();
let paymentJournalLines = new Map();
let currentPayable = null;
let expandedPayableId = null;
let initialHighlightApplied = false;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function harareDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Harare" }).format(date);
}
function paymentIsReversed(paymentId) { return paymentReversals.has(paymentId); }

async function fetchAllPages(buildQuery, label) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await buildQuery().range(offset, offset + 999);
    if (error) throw new Error(`Couldn't load ${label}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function fetchLedgerLines(entryIds) {
  const rows = [];
  for (let index = 0; index < entryIds.length; index += 500) {
    const batch = entryIds.slice(index, index + 500);
    rows.push(...await fetchAllPages(() => supabase.from("journal_lines")
      .select("journal_entry_id,debit,credit,accounts(code,name)")
      .in("journal_entry_id", batch), "payable ledger details"));
  }
  return rows;
}

// ---------- Load reference data ----------

async function loadSuppliers() {
  const { data, error } = await supabase.from("suppliers").select("id, name, payment_terms_days").order("name");
  if (error) {
    console.error("Error loading suppliers:", error);
    payableFormMessage.textContent = `Couldn't load supplier suggestions: ${error.message}`;
    payableFormMessage.dataset.tone = "error";
    return;
  }
  suppliers = data || [];
  supplierOptions.innerHTML = suppliers.map(s => `<option value="${escapeHtml(s.name)}"></option>`).join("");
}

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("id, code, name, type").eq("is_active", true).order("code");
  if (error) {
    console.error("Error loading accounts:", error);
    payableFormMessage.textContent = `Couldn't load Ledger accounts: ${error.message}`;
    payableFormMessage.dataset.tone = "error";
    return;
  }
  accounts = data || [];
  const debitOptions = accounts
    .filter(account => ["asset", "expense"].includes(account.type))
    .map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join("");
  const paymentOptions = accounts
    .filter(account => account.type === "asset")
    .map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join("");
  debitAccountSelect.innerHTML = `<option value="">Select account…</option>${debitOptions}`;
  paymentCreditAccountSelect.innerHTML = `<option value="">Select cash/bank account…</option>${paymentOptions}`;
}

function updateDueDateFromSupplier() {
  const supplierName = supplierNameInput.value.trim().toLowerCase();
  const supplier = suppliers.find(s => s.name.trim().toLowerCase() === supplierName);
  if (billDateInput.value) {
    const due = new Date(`${billDateInput.value}T00:00:00`);
    due.setDate(due.getDate() + (supplier?.payment_terms_days ?? 30));
    dueDateInput.value = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  }
}
supplierNameInput.addEventListener("change", updateDueDateFromSupplier);
billDateInput.addEventListener("change", updateDueDateFromSupplier);

// ---------- Add Payable (posts: debit chosen account, credit Accounts Payable) ----------

payableForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const supplierName = supplierNameInput.value.trim();
  const debitAccountId = debitAccountSelect.value;
  const amount = parseFloat(document.getElementById("pay-amount").value);
  const billDate = billDateInput.value;
  const dueDate = dueDateInput.value;
  const description = document.getElementById("pay-description").value.trim() || null;

  if (!supplierName || !debitAccountId || !amount || amount <= 0 || !billDate || !dueDate) {
    payableFormMessage.textContent = "Enter a supplier, amount, bill date, due date, and expense or purchase category.";
    payableFormMessage.dataset.tone = "error";
    return;
  }
  if (dueDate < billDate) {
    payableFormMessage.textContent = "The due date cannot be before the bill date.";
    payableFormMessage.dataset.tone = "error";
    return;
  }

  payableFormMessage.textContent = "Posting bill…";
  payableFormMessage.dataset.tone = "info";
  const submitButton = payableForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const { data, error } = await supabase.rpc("create_supplier_payable", {
      p_supplier_name: supplierName,
      p_debit_account_id: debitAccountId,
      p_amount: amount,
      p_bill_date: billDate,
      p_due_date: dueDate,
      p_description: description,
    });
    if (error) throw new Error(error.message);
    if (!data?.id || !data.bill_number || !data.supplier_name) {
      throw new Error("The bill was posted but the system did not return its bill number. Refresh Payables before retrying.");
    }

    payableForm.reset();
    billDateInput.value = harareDate();
    updateDueDateFromSupplier();
    payableFormMessage.textContent = `Bill ${data.bill_number} added for ${data.supplier_name} and posted to the ledger.`;
    payableFormMessage.dataset.tone = "success";
    await loadPayables();
    expandedPayableId = data.id;
    renderPayablesTable();
  } catch (error) {
    console.error("Couldn't create supplier payable:", error);
    payableFormMessage.textContent = `Failed to post bill: ${error.message || String(error)}`;
    payableFormMessage.dataset.tone = "error";
  } finally {
    submitButton.disabled = false;
  }
});

// ---------- Load payables + aging ----------

function agingBucket(dueDate, balance) {
  if (balance <= 0) return null;
  const days = Math.floor((new Date(`${harareDate()}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) / 86400000);
  if (days < 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

async function loadPayables() {
  const queryPayables = () => supabase.from("payables")
    .select("id, supplier_id, bill_number, bill_date, due_date, amount, amount_paid, status, description, restock_id, journal_entry_id, created_at, voided_at, void_reason, void_journal_entry_id, suppliers(id, name, contact_person, phone, email)")
    .order("due_date");
  let loadedPayables;
  try {
    loadedPayables = await fetchAllPages(queryPayables, "supplier bills");
  } catch (error) {
    console.error("Could not load supplier bills:", error);
    payablesTable.innerHTML = `<tr><td colspan="9" style="color:var(--danger)">${escapeHtml(error.message)}. Apply supabase/migrations/shop-restock-payables.sql, supabase/migrations/payable-payment-reversals.sql, and supabase/migrations/supplier-payables-workflow.sql in order.</td></tr>`;
    agingCards.innerHTML = "";
    overdueNotice.hidden = true;
    overdueNotice.textContent = "";
    return;
  }

  payables = loadedPayables;
  const [paymentsResult, reversalsResult] = await Promise.all([
    fetchAllPages(() => supabase.from("payable_payments")
      .select("id, payable_id, payment_date, amount, payment_method, journal_entry_id")
      .order("payment_date", { ascending: false }), "payable payments")
      .then(data => ({ data, error: null }))
      .catch(error => ({ data: null, error })),
    fetchAllPages(() => supabase.from("payable_payment_reversals")
      .select("payable_payment_id, journal_entry_id, reversal_date, reason"), "payment reversals")
      .then(data => ({ data, error: null }))
      .catch(error => ({ data: null, error })),
  ]);
  if (paymentsResult.error || reversalsResult.error) {
    const error = paymentsResult.error || reversalsResult.error;
    console.error("Could not load payable payment history:", error);
    payablePayments = paymentsResult.data || [];
    paymentReversals = new Map((reversalsResult.data || []).map(row => [row.payable_payment_id, row]));
    payablesTable.dataset.paymentHistoryError = error.message;
  } else {
    payablePayments = paymentsResult.data || [];
    paymentReversals = new Map((reversalsResult.data || []).map(row => [row.payable_payment_id, row]));
    delete payablesTable.dataset.paymentHistoryError;
  }

  const entryIds = [
    ...payables.map(payable => payable.journal_entry_id),
    ...payables.map(payable => payable.void_journal_entry_id),
    ...payablePayments.map(payment => payment.journal_entry_id),
    ...[...paymentReversals.values()].map(reversal => reversal.journal_entry_id),
  ].filter(Boolean);
  let journalLines = [];
  try {
    journalLines = entryIds.length ? await fetchLedgerLines([...new Set(entryIds)]) : [];
    delete payablesTable.dataset.ledgerDetailsError;
  } catch (error) {
    console.error("Could not load payable ledger details:", error);
    payablesTable.dataset.ledgerDetailsError = error.message;
  }
  payableJournalLines = new Map();
  paymentJournalLines = new Map();
  for (const line of journalLines) {
    const target = payablePayments.some(payment => payment.journal_entry_id === line.journal_entry_id)
      || [...paymentReversals.values()].some(reversal => reversal.journal_entry_id === line.journal_entry_id)
      ? paymentJournalLines
      : payableJournalLines;
    const lines = target.get(line.journal_entry_id) || [];
    lines.push(line);
    target.set(line.journal_entry_id, lines);
  }

  renderAging();
  renderOverdueNotice();
  renderPayablesTable();
}

function renderAging() {
  const buckets = { current: { count: 0, total: 0 }, "1-30": { count: 0, total: 0 }, "31-60": { count: 0, total: 0 }, "61-90": { count: 0, total: 0 }, "90+": { count: 0, total: 0 } };
  payables.forEach(p => {
    if (p.voided_at) return;
    const balance = Number(p.amount) - Number(p.amount_paid);
    const bucket = agingBucket(p.due_date, balance);
    if (bucket) { buckets[bucket].count += 1; buckets[bucket].total += balance; }
  });

  const labels = { current: "Not Yet Due", "1-30": "1–30 Days", "31-60": "31–60 Days", "61-90": "61–90 Days", "90+": "90+ Days" };
  const classes = { current: "aging-current", "1-30": "", "31-60": "aging-warn", "61-90": "aging-warn", "90+": "aging-danger" };

  agingCards.innerHTML = Object.keys(buckets).map(key => `
    <div class="stat-card">
      <div class="stat-card__label">${labels[key]}</div>
      <div class="stat-card__value ${classes[key]}">${money(buckets[key].total)}</div>
      <div style="font-size:.75rem; color:var(--text-muted);">${buckets[key].count} bill${buckets[key].count === 1 ? "" : "s"}</div>
    </div>
  `).join("");
}

function getOverduePayables() {
  const today = harareDate();
  return payables.filter(payable => !payable.voided_at
    && payable.due_date < today
    && Number(payable.amount) - Number(payable.amount_paid) > 0.01);
}

function renderOverdueNotice() {
  const overdue = getOverduePayables();
  if (!overdue.length) {
    overdueNotice.hidden = true;
    overdueNotice.textContent = "";
    return;
  }
  const overdueTotal = overdue.reduce((sum, payable) =>
    sum + Number(payable.amount) - Number(payable.amount_paid), 0);
  overdueNotice.hidden = false;
  overdueNotice.innerHTML = `<strong>Overdue payable alert:</strong> ${overdue.length} unpaid/partially paid bill${overdue.length === 1 ? "" : "s"} past due, with ${money(overdueTotal)} outstanding. Select a bill to expand its details: ${overdue.map(payable => `<button type="button" class="btn" data-overdue-payable-id="${escapeHtml(payable.id)}">${escapeHtml(payable.bill_number || "Bill")} — ${escapeHtml(payable.suppliers?.name || "Supplier")} (due ${escapeHtml(dateLabel(payable.due_date))})</button>`).join(" ")}`;
}

function journalSummary(lines) {
  if (!lines?.length) return "Ledger details unavailable";
  return lines.map(line => `${line.accounts?.code || ""} ${line.accounts?.name || "Account"}: Dr ${money(line.debit)} / Cr ${money(line.credit)}`).join(" · ");
}

function renderPayableDetails(payable, payments, activePayments) {
  const balance = Number(payable.amount) - Number(payable.amount_paid);
  const billLines = payableJournalLines.get(payable.journal_entry_id);
  const paymentsHtml = payments.length ? payments.map(payment => {
    const reversal = paymentReversals.get(payment.id);
    const paymentLines = paymentJournalLines.get(payment.journal_entry_id);
    const reversalLines = reversal ? paymentJournalLines.get(reversal.journal_entry_id) : null;
    return `<article class="payable-payment${reversal ? " is-reversed" : ""}">
      <div>
        <strong>${money(payment.amount)} · ${escapeHtml(dateLabel(payment.payment_date))}${reversal ? ' <span class="payable-voided-label">REVERSED</span>' : ""}</strong>
        <small>${escapeHtml(payment.payment_method || "Payment method not recorded")}</small>
        <span class="payable-payment-details">Ledger: ${escapeHtml(journalSummary(paymentLines))}${reversal ? `<br>Reversal (${escapeHtml(dateLabel(reversal.reversal_date))}): ${escapeHtml(reversal.reason)}: ${escapeHtml(journalSummary(reversalLines))}` : ""}</span>
      </div>
      <div class="payable-payment-actions">
        <button type="button" class="btn" data-action="print-receipt" data-payment-id="${escapeHtml(payment.id)}"><i data-lucide="printer"></i> Receipt</button>
        ${reversal ? '<span class="reversal-status">Reversed</span>' : payablesTable.dataset.paymentHistoryError ? '<span class="reversal-status">Reversal status unavailable</span>' : `<button type="button" class="btn reverse-payment-btn" data-action="reverse-payment" data-payment-id="${escapeHtml(payment.id)}" data-amount="${Number(payment.amount)}" data-bill="${escapeHtml(payable.bill_number || payable.id.slice(0, 8))}"><i data-lucide="rotate-ccw"></i> Reverse payment</button>`}
      </div>
    </article>`;
  }).join("") : '<p class="empty-state">No payments have been recorded for this bill.</p>';
  const voidDisabled = payablesTable.dataset.paymentHistoryError
    ? "Payment history is unavailable; refresh it before voiding this bill."
    : payable.restock_id
    ? "This bill is linked to a stock purchase; reverse that purchase first."
    : activePayments.length
      ? "Reverse every payment before voiding this bill."
      : "";
  const statusText = payable.voided_at
    ? `VOIDED ${dateLabel(payable.voided_at)}${payable.void_reason ? ` — ${payable.void_reason}` : ""}`
    : `${payable.status.replace("_", " ")} · ${balance > 0.01 ? `${money(balance)} still due` : "fully paid"}`;

  return `<tr class="payable-details-row"><td colspan="9"><div class="payable-details">
    <div class="payable-details-grid">
      <div class="payable-detail-item"><small>Supplier</small><strong>${escapeHtml(payable.suppliers?.name || "Supplier not recorded")}</strong></div>
      <div class="payable-detail-item"><small>Supplier contact</small><strong>${escapeHtml([payable.suppliers?.contact_person, payable.suppliers?.phone, payable.suppliers?.email].filter(Boolean).join(" · ") || "No contact details recorded")}</strong></div>
      <div class="payable-detail-item"><small>Bill number</small><strong>${escapeHtml(payable.bill_number || "—")}</strong></div>
      <div class="payable-detail-item"><small>Bill date</small><strong>${escapeHtml(dateLabel(payable.bill_date))}</strong></div>
      <div class="payable-detail-item"><small>Recorded on</small><strong>${escapeHtml(dateLabel(payable.created_at))}</strong></div>
      <div class="payable-detail-item"><small>Due date</small><strong>${escapeHtml(dateLabel(payable.due_date))}</strong></div>
      <div class="payable-detail-item"><small>Bill status</small><strong>${escapeHtml(statusText)}</strong></div>
      <div class="payable-detail-item"><small>Description</small><strong>${escapeHtml(payable.description || "No description recorded")}</strong></div>
      <div class="payable-detail-item"><small>Bill total · paid · balance</small><strong>${money(payable.amount)} · ${money(payable.amount_paid)} · ${money(balance)}</strong></div>
      <div class="payable-detail-item"><small>Source</small><strong>${payable.restock_id ? "Shop stock purchase" : "Manually entered bill"}</strong></div>
      <div class="payable-detail-item"><small>Bill ledger posting</small><strong>${escapeHtml(journalSummary(billLines))}</strong></div>
      ${payable.journal_entry_id ? `<div class="payable-detail-item"><small>Ledger reference</small><strong>${escapeHtml(payable.journal_entry_id)}</strong></div>` : ""}
      ${payable.voided_at ? `<div class="payable-detail-item"><small>Void reason</small><strong>${escapeHtml(payable.void_reason || "No reason recorded")}</strong></div>` : ""}
      ${payable.void_journal_entry_id ? `<div class="payable-detail-item"><small>Bill reversal posting</small><strong>${escapeHtml(journalSummary(payableJournalLines.get(payable.void_journal_entry_id)))}</strong></div>` : ""}
    </div>
    <div><h4>Payment history (${payments.length})</h4><div class="payable-payment-list">${paymentsHtml}</div>
      ${payablesTable.dataset.paymentHistoryError ? `<p class="payment-history-error">Payment reversal status couldn't be loaded: ${escapeHtml(payablesTable.dataset.paymentHistoryError)}</p>` : ""}
      ${payablesTable.dataset.ledgerDetailsError ? `<p class="payment-history-error">Ledger lines couldn't be loaded: ${escapeHtml(payablesTable.dataset.ledgerDetailsError)}</p>` : ""}
    </div>
    ${!payable.voided_at && !payable.restock_id ? `<button type="button" class="btn reverse-payment-btn" data-action="void-payable" data-payable-id="${escapeHtml(payable.id)}" ${voidDisabled ? `disabled title="${escapeHtml(voidDisabled)}"` : ""}><i data-lucide="ban"></i> Void bill</button>${voidDisabled ? `<small>${escapeHtml(voidDisabled)}</small>` : ""}` : ""}
    ${payable.restock_id && !payable.voided_at ? '<small>A stock-linked payable must be reversed with its stock purchase; it cannot be voided here.</small>' : ""}
  </div></td></tr>`;
}

function renderPayablesTable() {
  const requestedId = new URLSearchParams(window.location.search).get("highlight")
    || window.location.hash.match(/^#payable-(.+)$/)?.[1];
  const applyInitialHighlight = !initialHighlightApplied && payables.length > 0;
  if (applyInitialHighlight) {
    initialHighlightApplied = true;
    if (requestedId && payables.some(payable => payable.id === requestedId)) {
      expandedPayableId = requestedId;
    }
  }
  if (!payables.length) {
    payablesTable.innerHTML = `<tr><td colspan="9" class="empty-state">No payables recorded yet</td></tr>`;
    return;
  }
  payablesTable.innerHTML = payables.map(p => {
    const balance = Number(p.amount) - Number(p.amount_paid);
    const payments = payablePayments.filter(payment => payment.payable_id === p.id);
    const activePayments = payments.filter(payment => !paymentIsReversed(payment.id));
    const expanded = expandedPayableId === p.id;
    const row = `
      <tr id="payable-${escapeHtml(p.id)}" class="payable-row${expanded ? " is-expanded" : ""}${p.voided_at ? " is-voided" : ""}" data-payable-id="${escapeHtml(p.id)}" tabindex="0" aria-expanded="${expanded}">
        <td>${escapeHtml(p.suppliers?.name || "—")}${p.voided_at ? '<small class="payable-voided-label">VOIDED</small>' : ""}</td>
        <td>${escapeHtml(p.bill_number || "—")}</td>
        <td>${escapeHtml(dateLabel(p.due_date))}${!p.voided_at && balance > 0.01 && p.due_date < harareDate() ? '<small class="payable-voided-label">OVERDUE</small>' : ""}</td>
        <td>${money(p.amount)}</td>
        <td>${money(p.amount_paid)}</td>
        <td>${money(balance)}</td>
        <td>${p.voided_at ? '<span class="status-badge voided">voided</span>' : `<span class="status-badge ${escapeHtml(p.status || "unpaid")}">${escapeHtml(String(p.status || "unpaid").replace("_", " "))}</span>`}</td>
        <td>${p.restock_id ? "Shop restock" : "Manual bill"}</td>
        <td class="payable-actions">
          ${!p.voided_at && balance > 0.01 ? `<button type="button" class="btn pay-btn" data-action="pay" data-payable-id="${escapeHtml(p.id)}"><i data-lucide="banknote"></i> Pay</button>` : ""}
          <button type="button" class="btn" data-action="toggle-details" data-payable-id="${escapeHtml(p.id)}">${expanded ? "Close details" : "View details"}</button>
        </td>
      </tr>
    `;
    return row + (expanded ? renderPayableDetails(p, payments, activePayments) : "");
  }).join("");
  if (window.lucide) lucide.createIcons();
  if (!payablesTable.dataset.actionsBound) {
    payablesTable.addEventListener("click", handlePayablesClick);
    payablesTable.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("tr.payable-row")) {
        event.preventDefault();
        togglePayableDetails(event.target.dataset.payableId);
      }
    });
    payablesTable.dataset.actionsBound = "true";
  }
  const target = requestedId ? document.getElementById(`payable-${requestedId}`) : null;
  if (applyInitialHighlight && requestedId) {
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.classList.add("highlight-flash");
  }
}

function togglePayableDetails(id) {
  expandedPayableId = expandedPayableId === id ? null : id;
  renderPayablesTable();
}

function handlePayablesClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const { action, paymentId, payableId } = actionButton.dataset;
    if (action === "pay") openPaymentModal(payableId);
    else if (action === "toggle-details") togglePayableDetails(payableId);
    else if (action === "reverse-payment") reversePayment(actionButton);
    else if (action === "void-payable") voidPayable(actionButton);
    else if (action === "print-receipt") printPaymentReceipt(paymentId);
    return;
  }
  const row = event.target.closest("tr.payable-row");
  if (row) togglePayableDetails(row.dataset.payableId);
}

overdueNotice.addEventListener("click", event => {
  const button = event.target.closest("[data-overdue-payable-id]");
  if (!button) return;
  expandedPayableId = button.dataset.overduePayableId;
  renderPayablesTable();
  document.getElementById(`payable-${expandedPayableId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
});

async function reversePayment(button) {
  const paymentId = button.dataset.paymentId;
  const amount = Number(button.dataset.amount);
  const billNumber = button.dataset.bill || "this bill";
  const reason = window.prompt(`Why are you reversing the ${money(amount)} payment for bill ${billNumber}?`);
  if (!reason?.trim()) return;
  if (!await window.aprConfirm(`Post a reversing ledger transaction for ${money(amount)}? This cannot be undone.`, { title: "Reverse payment", confirmLabel: "Reverse payment", danger: true })) return;

  button.disabled = true;
  try {
    const { error } = await supabase.rpc("reverse_payable_payment", {
      p_payment_id: paymentId,
      p_reason: reason.trim(),
    });
    if (error) throw new Error(error.message);
    await loadPayables();
    window.aprToast?.("Payment reversed and the ledger updated.", "success");
  } catch (error) {
    console.error("Couldn't reverse payable payment:", error);
    window.aprToast?.("Couldn't reverse payment: " + (error.message || String(error)), "error");
    button.disabled = false;
  }
}

async function voidPayable(button) {
  const payableId = button.dataset.payableId;
  const payable = payables.find(item => item.id === payableId);
  if (!payable) return;
  const reason = window.prompt(`Why are you voiding bill ${payable.bill_number || "—"}? This keeps the bill and posts a reversing ledger entry.`);
  if (!reason?.trim()) return;
  if (!await window.aprConfirm(`Void bill ${payable.bill_number || "—"} for ${money(payable.amount)}? This cannot be undone.`, { title: "Void supplier bill", confirmLabel: "Void bill", danger: true })) return;

  button.disabled = true;
  try {
    const { error } = await supabase.rpc("void_supplier_payable", {
      p_payable_id: payableId,
      p_reason: reason.trim(),
    });
    if (error) throw new Error(error.message);
    await loadPayables();
    expandedPayableId = payableId;
    renderPayablesTable();
    window.aprToast?.("Bill voided and the reversing entry posted. The audit history was retained.", "success");
  } catch (error) {
    console.error("Couldn't void supplier bill:", error);
    window.aprToast?.(`Couldn't void bill: ${error.message || String(error)}`, "error");
    button.disabled = false;
  }
}

function printPaymentReceipt(paymentId) {
  const payment = payablePayments.find(item => item.id === paymentId);
  const payable = payables.find(item => item.id === payment?.payable_id);
  if (!payment || !payable) {
    window.aprToast?.("Payment receipt details are unavailable. Refresh the payable list and try again.", "error");
    return;
  }
  const reversal = paymentReversals.get(payment.id);
  const supplierName = payable.suppliers?.name || "Supplier";
  const receiptNumber = `PAY-${String(payable.bill_number || "BILL").replace(/[^a-zA-Z0-9-]/g, "")}-${payment.id.slice(0, 8).toUpperCase()}`;
  const popup = window.open("", "_blank");
  if (!popup) {
    window.aprToast?.("The receipt window was blocked. Allow pop-ups for this site and try again.", "error");
    return;
  }
  popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(receiptNumber)}</title>
    <style>body{font:14px Arial,sans-serif;color:#111;max-width:680px;margin:32px auto;padding:0 20px}h1{text-align:center;font-size:23px;margin-bottom:4px}.muted{color:#555}.void{color:#b42318;border:2px solid #b42318;padding:8px;text-align:center;font-weight:bold;font-size:20px}table{width:100%;border-collapse:collapse;margin:22px 0}td{padding:9px 5px;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-weight:bold}.total{font-size:18px;font-weight:bold;text-align:right}.footer{margin-top:32px;border-top:1px solid #ddd;padding-top:12px;color:#555}@media print{body{margin:12mm auto}}</style></head>
    <body>${reversal ? '<div class="void">PAYMENT REVERSED</div>' : ""}<h1>PAYMENT RECEIPT</h1><p style="text-align:center"><strong>Centric Auto Mobile</strong></p>
    <p><strong>Receipt:</strong> ${escapeHtml(receiptNumber)}</p><p><strong>Supplier:</strong> ${escapeHtml(supplierName)}</p>
    <p><strong>Bill:</strong> ${escapeHtml(payable.bill_number || "—")}</p><p><strong>Payment date:</strong> ${escapeHtml(dateLabel(payment.payment_date))}</p>
    <table><tr><td>Paid from</td><td>${escapeHtml(payment.payment_method || "Not recorded")}</td></tr><tr><td>Amount received</td><td>${money(payment.amount)}</td></tr></table>
    ${reversal ? `<p><strong>Reversal date:</strong> ${escapeHtml(dateLabel(reversal.reversal_date))}</p><p><strong>Reversal reason:</strong> ${escapeHtml(reversal.reason)}</p>` : ""}
    <p class="total">${reversal ? "Reversed amount" : "Payment received"}: ${money(payment.amount)}</p>
    <p class="footer">This receipt records a supplier payment. Bill balance at print time: ${money(Number(payable.amount) - Number(payable.amount_paid))}.</p>
    <script>window.addEventListener("load",()=>window.print());<\/script></body></html>`);
  popup.document.close();
}

// ---------- Record Payment (posts: debit Accounts Payable, credit chosen cash/bank account) ----------

function openPaymentModal(id) {
  currentPayable = payables.find(p => p.id === id);
  if (!currentPayable) return;
  const balance = Number(currentPayable.amount) - Number(currentPayable.amount_paid);
  paymentSummary.textContent = `${currentPayable.suppliers?.name || "Supplier"} — Bill ${currentPayable.bill_number || "—"} — Balance ${money(balance)}`;
  paymentAmountInput.value = balance.toFixed(2);
  paymentAmountInput.max = balance;
  paymentDateInput.value = harareDate();
  paymentFormMessage.textContent = "";
  paymentModal.classList.remove("hidden");
  paymentModal.style.display = "flex";
}
function closePaymentModal() {
  paymentModal.classList.add("hidden");
  paymentModal.style.display = "none";
  currentPayable = null;
}
paymentCancelBtn.addEventListener("click", closePaymentModal);
paymentModal.addEventListener("click", (e) => { if (e.target === paymentModal) closePaymentModal(); });

paymentSaveBtn.addEventListener("click", async () => {
  if (!currentPayable) return;
  const creditAccountId = paymentCreditAccountSelect.value;
  const amount = parseFloat(paymentAmountInput.value);
  const paymentDate = paymentDateInput.value;
  const balance = Number(currentPayable.amount) - Number(currentPayable.amount_paid);

  if (!creditAccountId || !amount || amount <= 0 || !paymentDate) { paymentFormMessage.textContent = "Select an account, payment date, and valid amount."; paymentFormMessage.dataset.tone = "error"; return; }
  if (amount > balance + 0.01) { paymentFormMessage.textContent = `Amount can't exceed the remaining balance of ${money(balance)}.`; paymentFormMessage.dataset.tone = "error"; return; }

  paymentFormMessage.textContent = "Saving payment…";
  paymentFormMessage.dataset.tone = "info";
  paymentSaveBtn.disabled = true;
  try {
    const { error } = await supabase.rpc("record_supplier_payable_payment", {
      p_payable_id: currentPayable.id,
      p_amount: amount,
      p_payment_date: paymentDate,
      p_credit_account_id: creditAccountId,
    });
    if (error) throw new Error(error.message);
    const payableId = currentPayable.id;
    closePaymentModal();
    expandedPayableId = payableId;
    await loadPayables();
    window.aprToast?.("Payment recorded in the ledger. Open the bill details to print its receipt.", "success");
  } catch (error) {
    console.error("Couldn't record supplier payment:", error);
    paymentFormMessage.textContent = `Couldn't record payment: ${error.message || String(error)}`;
    paymentFormMessage.dataset.tone = "error";
  } finally {
    paymentSaveBtn.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  billDateInput.value = harareDate();
  updateDueDateFromSupplier();
  await Promise.all([loadSuppliers(), loadAccounts()]);
  updateDueDateFromSupplier();
  await loadPayables();
});