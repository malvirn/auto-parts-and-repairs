import supabase from "./supabaseClient.js";

const tbody = document.getElementById("customer-accounts-body");
const message = document.getElementById("customer-accounts-message");
const searchInput = document.getElementById("customer-account-search");
const filterSelect = document.getElementById("customer-account-filter");
const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

let entries = [];
let expandedCustomerId = null;

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function money(value) {
  return moneyFormat.format(Number(value) || 0);
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
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
    ...customer.entries.map(entry => `${dateLabel(entry.entry_date)} | ${entry.reference} (${entry.source_type}) | Charge ${money(entry.total_amount)} | Paid ${money(entry.amount_paid)} | Balance ${money(entry.balance_due)}`),
    "",
    customer.balance > 0.01
      ? `Amount outstanding: ${money(customer.balance)}`
      : customer.balance < -0.01
        ? `Customer credit: ${money(Math.abs(customer.balance))}`
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
    <td>${escapeHtml(entry.source_type)}</td><td>${money(entry.total_amount)}</td>
    <td>${money(entry.amount_paid)}</td><td>${money(entry.balance_due)}</td></tr>`).join("");
  printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account statement - ${escapeHtml(customer.name)}</title>
    <style>body{font:14px Arial,sans-serif;color:#202720;margin:36px}h1{font-size:22px}p{margin:6px 0}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:9px 7px;border-bottom:1px solid #ccd3ce;text-align:left}th{background:#edf1ee}.total{margin-top:22px;text-align:right;font-size:18px;font-weight:bold}@media print{body{margin:12mm}}</style>
    </head><body><h1>Customer Account Statement</h1><p><strong>${escapeHtml(customer.name)}</strong></p>
    <p>${escapeHtml(customer.phone)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ""}</p>
    <p>Statement date: ${escapeHtml(new Date().toLocaleDateString())}</p>
    <table><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Charge</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table>
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
    const matchesFilter = filter === "owed" ? customer.balance > 0.01
      : filter === "credit" ? customer.balance < -0.01
        : true;
    return matchesQuery && matchesFilter;
  });

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${entries.length ? "No customer accounts match this filter." : "No repair or confirmed sales account activity yet."}</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(customer => {
    const openItems = customer.entries.filter(entry => entry.balance_due > 0.01).length;
    const balanceClass = customer.balance > 0.01 ? "customer-balance--due" : customer.balance < -0.01 ? "customer-balance--credit" : "";
    const balanceText = customer.balance < -0.01 ? `Credit ${money(Math.abs(customer.balance))}` : money(customer.balance);
    const expanded = expandedCustomerId === customer.id;
    const detail = expanded ? `<tr class="customer-account-detail-row"><td colspan="6"><div class="customer-transaction-list">
      <div class="customer-transaction"><strong>Reference and date</strong><strong>Charge</strong><strong>Paid</strong><strong>Balance</strong></div>
      ${customer.entries.map(entry => `<div class="customer-transaction"><span>${escapeHtml(entry.reference)} · ${escapeHtml(dateLabel(entry.entry_date))} · ${escapeHtml(entry.source_type)}</span><span>${money(entry.total_amount)}</span><span>${money(entry.amount_paid)}</span><span>${money(entry.balance_due)}</span></div>`).join("")}
      </div></td></tr>` : "";
    return `<tr>
      <td><strong>${escapeHtml(customer.name)}</strong><div class="customer-contact">${escapeHtml(customer.phone)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ""}</div></td>
      <td><button type="button" class="btn account-detail-toggle" data-customer-id="${escapeHtml(customer.id)}" aria-expanded="${expanded}">${openItems} due · ${customer.entries.length} total</button></td>
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
    .select("customer_id, customer_name, phone, email, source_id, source_type, reference, entry_date, total_amount, amount_paid, balance_due")
    .order("customer_name")
    .order("entry_date", { ascending: false });
  if (error) {
    entries = [];
    render();
    message.textContent = `Couldn't load customer balances: ${error.message}. Run supabase/migrations/customer-account-statement-view.sql in the Supabase SQL Editor.`;
    message.dataset.tone = "error";
    return;
  }
  entries = data || [];
  message.textContent = entries.length ? `Updated ${new Date().toLocaleTimeString()}.` : "No customer account activity found.";
  message.dataset.tone = "info";
  render();
}

tbody.addEventListener("click", event => {
  const button = event.target.closest("button[data-customer-id]");
  if (!button) return;
  const customer = groupEntries().find(account => account.id === button.dataset.customerId);
  if (!customer) return;
  const action = button.dataset.action;
  if (!action) {
    expandedCustomerId = expandedCustomerId === customer.id ? null : customer.id;
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

searchInput.addEventListener("input", render);
filterSelect.addEventListener("change", render);
document.getElementById("refresh-customer-accounts").addEventListener("click", loadCustomerAccounts);
loadCustomerAccounts();