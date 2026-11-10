import supabase from "./supabaseClient.js";

const tbody = document.getElementById("customer-accounts-body");
const message = document.getElementById("customer-accounts-message");
const searchInput = document.getElementById("customer-account-search");
const filterSelect = document.getElementById("customer-account-filter");
const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const paymentModal = document.getElementById("quick-sale-payment-modal");
const paymentAmountInput = document.getElementById("quick-sale-payment-amount");
const paymentDateInput = document.getElementById("quick-sale-payment-date");
const paymentMethodInput = document.getElementById("quick-sale-payment-method");
const paymentSummary = document.getElementById("quick-sale-payment-summary");
const paymentMessage = document.getElementById("quick-sale-payment-message");
const paymentSaveButton = document.getElementById("quick-sale-payment-save");

let entries = [];
let overpaymentCredits = [];
let expandedCustomerId = null;
let selectedPaymentEntry = null;

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function linkedOverpaymentNote(credit) {
  const value = credit.customer_overpayment_credit_notes;
  return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function money(value) {
  return moneyFormat.format(Number(value) || 0);
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

function dateInZimbabwe() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function groupEntries() {
  const grouped = new Map();
  for (const entry of entries) {
    let customer = grouped.get(entry.customer_id);
    if (!customer) {
      customer = {
        id: entry.customer_id,
        name: entry.customer_name || "Unnamed customer",
        phone: entry.phone || "",
        email: entry.email || "",
        entries: [],
        charges: 0,
        payments: 0,
        balance: 0,
      };
      grouped.set(entry.customer_id, customer);
    }
    const total = Number(entry.total_amount) || 0;
    const paid = Number(entry.amount_paid) || 0;
    customer.entries.push({ ...entry, total_amount: total, amount_paid: paid, balance_due: Number(entry.balance_due) || 0 });
    customer.charges += total;
    customer.payments += paid;
    customer.balance += Number(entry.balance_due) || 0;
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function accountStatementText(customer) {
  const lines = [
    `Customer account statement: ${customer.name}`,
    customer.phone ? `Phone: ${customer.phone}` : "",
    `Date: ${new Date().toLocaleDateString()}`,
    "",
    "Account activity:",
    ...customer.entries.map(entry => `${dateLabel(entry.entry_date)} | ${entry.reference} (${entry.source_type}) |${entry.discount_amount ? ` Discount ${money(entry.discount_amount)} |` : ""}${entry.payment_method ? ` Payment ${entry.payment_method} |` : ""} Charge ${money(entry.total_amount)} | Paid ${money(entry.amount_paid)} | Balance ${money(entry.balance_due)}`),
    "",
    customer.balance > 0.01
      ? `Amount outstanding: ${money(customer.balance)}`
      : customer.balance < -0.01
        ? `Carry-forward customer credit: ${money(Math.abs(customer.balance))}`
        : "Account balance: $0.00",
    "Please contact Centric Auto Mobile if you have questions about this statement.",
  ];
  return lines.filter(Boolean).join("\n");
}

function printStatement(customer) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    message.textContent = "Allow pop-ups to print this account statement.";
    message.dataset.tone = "error";
    return;
  }
  const rows = customer.entries.map(entry => `
    <tr><td>${escapeHtml(dateLabel(entry.entry_date))}</td><td>${escapeHtml(entry.reference)}</td>
    <td>${escapeHtml(entry.source_type)}</td><td>${money(entry.discount_amount)}</td><td>${escapeHtml(entry.payment_method || "—")}</td><td>${money(entry.total_amount)}</td>
    <td>${money(entry.amount_paid)}</td><td>${money(entry.balance_due)}</td></tr>`).join("");
  printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account statement - ${escapeHtml(customer.name)}</title>
    <style>body{font:14px Arial,sans-serif;color:#202720;margin:36px}h1{font-size:22px}p{margin:6px 0}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:9px 7px;border-bottom:1px solid #ccd3ce;text-align:left}th{background:#edf1ee}.total{margin-top:22px;text-align:right;font-size:18px;font-weight:bold}@media print{body{margin:12mm}}</style>
    </head><body><h1>Customer Account Statement</h1><p><strong>${escapeHtml(customer.name)}</strong></p>
    <p>${escapeHtml(customer.phone)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ""}</p>
    <p>Statement date: ${escapeHtml(new Date().toLocaleDateString())}</p>
    <table><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Discount</th><th>Payment method</th><th>Charge</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="total">${customer.balance > 0.01 ? `Amount outstanding: ${money(customer.balance)}` : customer.balance < -0.01 ? `Customer credit: ${money(Math.abs(customer.balance))}` : "Account balance: $0.00"}</p>
    <p>Centric Auto Mobile · Auto Parts &amp; Repairs</p><script>window.addEventListener("load",()=>window.print());<\/script></body></html>`);
  printWindow.document.close();
}

function render() {
  const customers = groupEntries();
  const debt = customers.reduce((sum, customer) => sum + Math.max(customer.balance, 0), 0);
  const credits = customers.reduce((sum, customer) => sum + Math.max(-customer.balance, 0), 0);
  document.getElementById("customer-debt-total").textContent = money(debt);
  document.getElementById("customer-credit-total").textContent = money(credits);
  document.getElementById("customer-debt-count").textContent = String(customers.filter(customer => customer.balance > 0.01).length);
  const query = searchInput.value.trim().toLowerCase();
  const filter = filterSelect.value;
  const visible = customers.filter(customer => {
    const matchesQuery = [customer.name, customer.phone, customer.email].some(value => value.toLowerCase().includes(query));
    const matchesFilter = filter === "owed" ? customer.balance > 0.01 : filter === "credit" ? customer.balance < -0.01 : true;
    return matchesQuery && matchesFilter;
  });
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${entries.length ? "No customer accounts match this filter." : "No repair or confirmed sales account activity yet."}</td></tr>`;
    return;
  }
  tbody.innerHTML = visible.map(customer => {
    const openItems = customer.entries.filter(entry => entry.balance_due > 0.01).length;
    const balanceClass = customer.balance > 0.01 ? "customer-balance--due" : customer.balance < -0.01 ? "customer-balance--credit" : "";
    const balanceText = customer.balance < -0.01 ? `Credit carried forward ${money(Math.abs(customer.balance))}` : money(customer.balance);
    const expanded = expandedCustomerId === customer.id;
    const detail = expanded ? `<tr class="customer-account-detail-row"><td colspan="6"><div class="customer-transaction-list">
      <div class="customer-transaction"><strong>Reference and date</strong><strong>Discount</strong><strong>Payment</strong><strong>Charge</strong><strong>Paid</strong><strong>Balance</strong></div>
      ${customer.entries.map(entry => {
        const paying = selectedPaymentEntry?.source_id === entry.source_id;
        return `<div class="customer-transaction"><span>${escapeHtml(entry.reference)} · ${escapeHtml(dateLabel(entry.entry_date))} · ${escapeHtml(entry.source_type)}</span><span>${money(entry.discount_amount)}</span><span>${escapeHtml(entry.payment_method || "—")}</span><span>${money(entry.total_amount)}</span><span>${money(entry.amount_paid)}</span><span class="${entry.balance_due > 0.01 ? "is-outstanding" : ""}">${money(entry.balance_due)}${entry.can_record_payment && entry.balance_due > 0.01 ? paying ? "" : ` <button type="button" class="btn" data-action="pay-order" data-customer-id="${escapeHtml(customer.id)}" data-source-id="${escapeHtml(entry.source_id)}">Record payment</button>` : ""}</span></div>
        ${paying ? `<form class="customer-inline-payment" data-inline-payment><strong>Record payment · ${escapeHtml(entry.reference)}</strong><label>Amount<input name="amount" type="number" min="0.01" max="${Number(entry.balance_due).toFixed(2)}" step="0.01" value="${Number(entry.balance_due).toFixed(2)}" required></label><label>Date<input name="date" type="date" value="${dateInZimbabwe()}" required></label><label>Method<select name="method"><option value="Cash">Cash</option><option value="Card">Card</option><option value="Bank Transfer">Bank Transfer</option><option value="EcoCash">EcoCash</option><option value="Other">Other</option></select></label><p class="form-message" data-inline-payment-message></p><div class="customer-inline-payment-actions"><button type="button" class="btn" data-action="cancel-inline-payment">Cancel</button><button type="submit" class="btn btn--primary">Save payment</button></div></form>` : ""}`;
      }).join("")}
      ${overpaymentCredits.filter(credit => credit.customer_id === customer.id && (Number(credit.available_amount) > 0.005 || linkedOverpaymentNote(credit))).map(credit => `<div class="customer-transaction"><span>Invoice overpayment · ${escapeHtml(credit.invoices?.invoice_number ? `INV-${credit.invoices.invoice_number}` : "Invoice")} · ${escapeHtml(dateLabel(credit.payment_date))}${linkedOverpaymentNote(credit) ? ` · CN-${String(linkedOverpaymentNote(credit).note_number).padStart(5,"0")}` : ""}</span><span>—</span><span>Customer credit</span><span>${money(credit.amount)}</span><span>—</span><span>Amount carried forward ${money(credit.available_amount)} ${linkedOverpaymentNote(credit) ? `<span class="customer-credit-note-issued">CN-${String(linkedOverpaymentNote(credit).note_number).padStart(5,"0")} issued</span>` : `<button type="button" class="btn btn--primary" data-action="issue-overpayment-credit" data-customer-id="${escapeHtml(customer.id)}" data-overpayment-credit-id="${escapeHtml(credit.id)}">Issue credit note</button>`}</span></div>`).join("")}
      </div></td></tr>` : "";
    return `<tr class="customer-account-main-row" data-customer-row="${escapeHtml(customer.id)}" aria-expanded="${expanded}" tabindex="0">
      <td><strong>${escapeHtml(customer.name)}</strong><div class="customer-contact">${escapeHtml(customer.phone)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ""}</div></td>
      <td><span class="account-detail-count">${openItems} due · ${customer.entries.length} total</span></td>
      <td>${money(customer.charges)}</td><td>${money(customer.payments)}</td><td class="${balanceClass}">${balanceText}</td>
      <td><div class="customer-account-actions">
        <button type="button" class="btn" data-action="email" data-customer-id="${escapeHtml(customer.id)}" title="Email account statement" aria-label="Email account statement to ${escapeHtml(customer.name)}" ${customer.email ? "" : "disabled"}><i data-lucide="mail"></i></button>
        <button type="button" class="btn" data-action="whatsapp" data-customer-id="${escapeHtml(customer.id)}" title="Send account statement on WhatsApp" aria-label="Send account statement to ${escapeHtml(customer.name)} on WhatsApp" ${customer.phone ? "" : "disabled"}><i data-lucide="message-circle"></i></button>
        <button type="button" class="btn" data-action="print" data-customer-id="${escapeHtml(customer.id)}" title="Print account statement" aria-label="Print account statement for ${escapeHtml(customer.name)}"><i data-lucide="printer"></i></button>
      </div></td>
    </tr>${detail}`;
  }).join("");
  if (window.lucide) window.lucide.createIcons();
}
async function loadCustomerAccounts() {
  message.textContent = "Loading customer balances…";
  message.dataset.tone = "info";
  const { data, error } = await supabase.from("customer_account_statement")
    .select("customer_id, customer_name, phone, email, source_id, source_type, reference, entry_date, total_amount, amount_paid, balance_due, discount_amount, payment_method, can_record_payment")
    .order("customer_name")
    .order("entry_date", { ascending: false });
  if (error) {
    entries = [];
    render();
    message.textContent = `Couldn't load customer balances: ${error.message}. Apply the customer-account and Quick Sale payment migrations in the user guide.`;
    message.dataset.tone = "error";
    return;
  }
  entries = data || [];
  const overpaymentResult = await supabase.from("customer_overpayment_credits").select("id,customer_id,customer_name,customer_phone,invoice_id,amount,available_amount,payment_date,invoices(invoice_number),customer_overpayment_credit_notes(note_number,amount)").limit(500);
  overpaymentCredits = overpaymentResult.error ? [] : (overpaymentResult.data || []);
  message.textContent = entries.length ? `Updated ${new Date().toLocaleTimeString()}.` : "No customer account activity found.";
  message.dataset.tone = "info";
  render();
}

tbody.addEventListener("click", async event => {
  const button = event.target.closest("button[data-customer-id]");
  const row = event.target.closest("tr[data-customer-row]");
  if (!button && !row) return;
  if (button?.closest("[data-inline-payment]")) return;
  const customerId = button?.dataset.customerId || row?.dataset.customerRow;
  const customer = groupEntries().find(account => account.id === customerId);
  if (!customer) return;
  const action = button?.dataset.action;
  if (action === "issue-overpayment-credit") {
    const creditId = button.dataset.overpaymentCreditId;
    const credit = overpaymentCredits.find(row => row.id === creditId);
    if (!credit || !window.confirm("Issue a credit note for " + money(credit.available_amount) + " for " + customer.name + "?")) return;
    button.disabled = true;
    const { data, error } = await supabase.rpc("issue_overpayment_credit_note", { p_overpayment_credit_id: creditId });
    if (error) { message.textContent = "Could not issue credit note: " + error.message; message.dataset.tone = "error"; button.disabled = false; return; }
    const note = typeof data === "string" ? JSON.parse(data) : data;
    message.textContent = "Credit note CN-" + note.credit_note_number + " issued and saved. Refresh the customer account to see its status."; message.dataset.tone = "success";
    await loadCustomerAccounts();
    return;
  }
  if (action === "pay-order") {
    selectedPaymentEntry = customer.entries.find(entry => entry.source_id === button.dataset.sourceId && entry.source_type === "Sales order");
    if (!selectedPaymentEntry || selectedPaymentEntry.balance_due <= 0.01) return;
    expandedCustomerId = customer.id;
    render();
    tbody.querySelector("[data-inline-payment] input[name='amount']")?.focus();
    return;
  }
  if (action === "cancel-inline-payment") {
    selectedPaymentEntry = null;
    render();
    return;
  }
  if (!button) {
    expandedCustomerId = expandedCustomerId === customer.id ? null : customer.id;
    selectedPaymentEntry = null;
    render();
    return;
  }
  const text = accountStatementText(customer);
  if (action === "email") {
    window.location.href = `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent("Customer account statement")}&body=${encodeURIComponent(text)}`;
  } else if (action === "whatsapp") {
    let phone = customer.phone.replace(/\D/g, "");
    if (phone.startsWith("00")) phone = phone.slice(2);
    if (phone.startsWith("0")) phone = `263${phone.slice(1)}`;
    if (phone.length < 9) {
      message.textContent = "That customer's phone number is not valid for WhatsApp.";
      message.dataset.tone = "error";
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  } else if (action === "print") {
    printStatement(customer);
  }
});


tbody.addEventListener("submit", async event => {
  const form = event.target.closest("[data-inline-payment]");
  if (!form || !selectedPaymentEntry) return;
  event.preventDefault();
  const amount = Number(form.elements.amount.value);
  const paymentDate = form.elements.date.value;
  const paymentMethod = form.elements.method.value;
  const formMessage = form.querySelector("[data-inline-payment-message]");
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number(selectedPaymentEntry.balance_due) + 0.005) {
    formMessage.textContent = `Enter an amount greater than zero and no more than ${money(selectedPaymentEntry.balance_due)}.`;
    return;
  }
  if (!paymentDate) { formMessage.textContent = "Choose the date the payment was received."; return; }
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  formMessage.textContent = "Recording payment…";
  try {
    const { data: journalEntryId, error } = await supabase.rpc("record_quick_sale_payment", {
      p_sales_order_id: selectedPaymentEntry.source_id,
      p_amount: amount,
      p_payment_method: paymentMethod,
      p_payment_date: paymentDate,
    });
    if (error) throw new Error(error.message);
    if (!journalEntryId) throw new Error("The payment was recorded, but the ledger did not return a receipt reference. Verify the payment before retrying.");
    const receiptUrl = new URL("receipts.html", window.location.href);
    receiptUrl.searchParams.set("quickSalePayment", journalEntryId);
    receiptUrl.searchParams.set("paymentMethod", paymentMethod);
    receiptUrl.searchParams.set("from", "ledger");
    window.location.href = receiptUrl.href;
  } catch (error) {
    formMessage.textContent = `Couldn't record payment: ${error.message || String(error)}.`;
    submit.disabled = false;
  }
});

searchInput.addEventListener("input", render);
filterSelect.addEventListener("change", render);
document.getElementById("refresh-customer-accounts").addEventListener("click", loadCustomerAccounts);
loadCustomerAccounts();