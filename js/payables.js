import supabase from "./supabaseClient.js";

const payableForm = document.getElementById("payable-form");
const payableFormMessage = document.getElementById("payable-form-message");
const supplierSelect = document.getElementById("pay-supplier");
const debitAccountSelect = document.getElementById("pay-debit-account");
const billDateInput = document.getElementById("pay-bill-date");
const dueDateInput = document.getElementById("pay-due-date");
const agingCards = document.getElementById("aging-cards");
const payablesTable = document.getElementById("payables-table");

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
let currentPayable = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function findAccountByCode(code) { return accounts.find(a => a.code === code); }

// ---------- Load reference data ----------

async function loadSuppliers() {
  const { data, error } = await supabase.from("suppliers").select("id, name, payment_terms_days").order("name");
  if (error) { console.error("Error loading suppliers:", error); return; }
  suppliers = data || [];
  supplierSelect.innerHTML = `<option value="">Select supplier…</option>` + suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("id, code, name, type").eq("is_active", true).order("code");
  if (error) { console.error("Error loading accounts:", error); return; }
  accounts = data || [];
  const options = accounts.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join("");
  debitAccountSelect.innerHTML = `<option value="">Select account…</option>${options}`;
  paymentCreditAccountSelect.innerHTML = `<option value="">Select account…</option>${options}`;
}

supplierSelect.addEventListener("change", () => {
  const supplier = suppliers.find(s => s.id === supplierSelect.value);
  if (supplier && billDateInput.value) {
    const due = new Date(billDateInput.value);
    due.setDate(due.getDate() + (supplier.payment_terms_days || 30));
    dueDateInput.value = due.toISOString().slice(0, 10);
  }
});
billDateInput.addEventListener("change", () => supplierSelect.dispatchEvent(new Event("change")));

// ---------- Add Payable (posts: debit chosen account, credit Accounts Payable) ----------

payableForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const apAccount = findAccountByCode("2000");
  if (!apAccount) {
    payableFormMessage.textContent = "Accounts Payable (code 2000) not found in your Chart of Accounts — check Ledger setup.";
    payableFormMessage.dataset.tone = "error";
    return;
  }

  const supplierId = supplierSelect.value;
  const debitAccountId = debitAccountSelect.value;
  const amount = parseFloat(document.getElementById("pay-amount").value);
  const billDate = billDateInput.value;
  const dueDate = dueDateInput.value;
  const billNumber = document.getElementById("pay-bill-number").value.trim() || null;
  const description = document.getElementById("pay-description").value.trim() || null;

  if (!supplierId || !debitAccountId || !amount || amount <= 0) {
    payableFormMessage.textContent = "Fill in supplier, amount, and what this was for.";
    payableFormMessage.dataset.tone = "error";
    return;
  }

  payableFormMessage.textContent = "Posting…"; payableFormMessage.dataset.tone = "info";
  const supplierName = suppliers.find(s => s.id === supplierId)?.name || "Supplier";

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: billDate,
    reference: billNumber,
    description: `Bill from ${supplierName}${description ? " — " + description : ""}`,
    source_type: "payable",
  }]).select().single();
  if (entryError) { payableFormMessage.textContent = "Failed to post: " + entryError.message; payableFormMessage.dataset.tone = "error"; return; }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    { journal_entry_id: entry.id, account_id: debitAccountId, debit: amount, credit: 0 },
    { journal_entry_id: entry.id, account_id: apAccount.id, debit: 0, credit: amount },
  ]);
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    payableFormMessage.textContent = "Failed to post: " + linesError.message;
    payableFormMessage.dataset.tone = "error";
    return;
  }

  const { error: payableError } = await supabase.from("payables").insert([{
    supplier_id: supplierId, bill_number: billNumber, bill_date: billDate, due_date: dueDate,
    amount, description, journal_entry_id: entry.id,
  }]);
  if (payableError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id); // cascades journal_lines
    payableFormMessage.textContent = "Failed to save payable: " + payableError.message;
    payableFormMessage.dataset.tone = "error";
    return;
  }

  payableForm.reset();
  billDateInput.value = new Date().toISOString().slice(0, 10);
  payableFormMessage.textContent = "Payable added and posted to the ledger."; payableFormMessage.dataset.tone = "success";
  loadPayables();
});

// ---------- Load payables + aging ----------

function agingBucket(dueDate, balance) {
  if (balance <= 0) return null;
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  if (days < 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

async function loadPayables() {
  const { data, error } = await supabase
    .from("payables")
    .select("id, bill_number, bill_date, due_date, amount, amount_paid, status, description, suppliers(name)")
    .order("due_date");

  if (error) {
    payablesTable.innerHTML = `<tr><td colspan="8" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}. If you're not logged in as an admin, this is expected — payables are admin-only.</td></tr>`;
    agingCards.innerHTML = "";
    return;
  }

  payables = data || [];
  renderAging();
  renderPayablesTable();
}

function renderAging() {
  const buckets = { current: { count: 0, total: 0 }, "1-30": { count: 0, total: 0 }, "31-60": { count: 0, total: 0 }, "61-90": { count: 0, total: 0 }, "90+": { count: 0, total: 0 } };
  payables.forEach(p => {
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

function renderPayablesTable() {
  if (!payables.length) {
    payablesTable.innerHTML = `<tr><td colspan="8" class="empty-state">No payables recorded yet</td></tr>`;
    return;
  }
  payablesTable.innerHTML = payables.map(p => {
    const balance = Number(p.amount) - Number(p.amount_paid);
    return `
      <tr>
        <td>${escapeHtml(p.suppliers?.name || "—")}</td>
        <td>${escapeHtml(p.bill_number || "—")}</td>
        <td>${p.due_date}</td>
        <td>${money(p.amount)}</td>
        <td>${money(p.amount_paid)}</td>
        <td>${money(balance)}</td>
        <td><span class="status-badge ${p.status}">${p.status.replace("_", " ")}</span></td>
        <td>${balance > 0 ? `<button type="button" class="btn pay-btn" data-id="${p.id}"><i data-lucide="banknote"></i> Pay</button>` : ""}</td>
      </tr>
    `;
  }).join("");
  if (window.lucide) lucide.createIcons();
  payablesTable.querySelectorAll(".pay-btn").forEach(btn => btn.addEventListener("click", () => openPaymentModal(btn.dataset.id)));
}

// ---------- Record Payment (posts: debit Accounts Payable, credit chosen cash/bank account) ----------

function openPaymentModal(id) {
  currentPayable = payables.find(p => p.id === id);
  if (!currentPayable) return;
  const balance = Number(currentPayable.amount) - Number(currentPayable.amount_paid);
  paymentSummary.textContent = `${currentPayable.suppliers?.name || "Supplier"} — Bill ${currentPayable.bill_number || "—"} — Balance ${money(balance)}`;
  paymentAmountInput.value = balance.toFixed(2);
  paymentAmountInput.max = balance;
  paymentDateInput.value = new Date().toISOString().slice(0, 10);
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
  const apAccount = findAccountByCode("2000");
  const creditAccountId = paymentCreditAccountSelect.value;
  const amount = parseFloat(paymentAmountInput.value);
  const paymentDate = paymentDateInput.value;
  const balance = Number(currentPayable.amount) - Number(currentPayable.amount_paid);

  if (!creditAccountId || !amount || amount <= 0) { paymentFormMessage.textContent = "Select an account and a valid amount."; paymentFormMessage.dataset.tone = "error"; return; }
  if (amount > balance + 0.01) { paymentFormMessage.textContent = `Amount can't exceed the remaining balance of ${money(balance)}.`; paymentFormMessage.dataset.tone = "error"; return; }

  paymentFormMessage.textContent = "Saving…"; paymentFormMessage.dataset.tone = "info";
  const supplierName = currentPayable.suppliers?.name || "Supplier";

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: paymentDate,
    reference: currentPayable.bill_number,
    description: `Payment to ${supplierName} — bill ${currentPayable.bill_number || currentPayable.id.slice(0, 8)}`,
    source_type: "payable_payment",
  }]).select().single();
  if (entryError) { paymentFormMessage.textContent = "Failed to post: " + entryError.message; paymentFormMessage.dataset.tone = "error"; return; }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    { journal_entry_id: entry.id, account_id: apAccount.id, debit: amount, credit: 0 },
    { journal_entry_id: entry.id, account_id: creditAccountId, debit: 0, credit: amount },
  ]);
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    paymentFormMessage.textContent = "Failed to post: " + linesError.message;
    paymentFormMessage.dataset.tone = "error";
    return;
  }

  const { error: paymentError } = await supabase.from("payable_payments").insert([{
    payable_id: currentPayable.id, payment_date: paymentDate, amount,
    payment_method: paymentCreditAccountSelect.selectedOptions[0]?.textContent || null,
    journal_entry_id: entry.id,
  }]);
  if (paymentError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    paymentFormMessage.textContent = "Failed to save payment: " + paymentError.message;
    paymentFormMessage.dataset.tone = "error";
    return;
  }

  const newAmountPaid = Number(currentPayable.amount_paid) + amount;
  const newStatus = newAmountPaid >= Number(currentPayable.amount) - 0.01 ? "paid" : "partially_paid";
  const { error: updateError } = await supabase.from("payables").update({ amount_paid: newAmountPaid, status: newStatus }).eq("id", currentPayable.id);
  if (updateError) console.error("Payment posted, but payable status update failed:", updateError);

  closePaymentModal();
  loadPayables();
});

document.addEventListener("DOMContentLoaded", async () => {
  billDateInput.value = new Date().toISOString().slice(0, 10);
  await Promise.all([loadSuppliers(), loadAccounts()]);
  loadPayables();
});