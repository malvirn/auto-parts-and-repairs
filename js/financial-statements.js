import supabase from "./supabaseClient.js";

const plStart = document.getElementById("pl-start");
const plEnd = document.getElementById("pl-end");
const plBody = document.getElementById("pl-body");
const plRefreshBtn = document.getElementById("pl-refresh-btn");

const bsAsOf = document.getElementById("bs-asof");
const bsBody = document.getElementById("bs-body");
const bsRefreshBtn = document.getElementById("bs-refresh-btn");
const bsBalanceStatus = document.getElementById("bs-balance-status");

let accounts = [];
let lines = []; // { account_id, debit, credit, entry_date }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ---------- Shared data load ----------
// Both statements are derived from the same underlying ledger activity —
// fetched once here, filtered differently below for each report, so
// there's exactly one source of truth for both.

async function loadLedgerData() {
  const [{ data: acctData, error: acctError }, { data: lineData, error: lineError }] = await Promise.all([
    supabase.from("accounts").select("id, code, name, type, normal_balance").eq("is_active", true).order("code"),
    supabase.from("journal_lines").select("account_id, debit, credit, journal_entries(entry_date)"),
  ]);

  if (acctError || lineError) {
    const msg = (acctError || lineError).message;
    plBody.innerHTML = `<tr><td colspan="2" style="color:var(--danger)">Failed to load: ${escapeHtml(msg)}. If you're not logged in as an admin, this is expected.</td></tr>`;
    bsBody.innerHTML = `<tr><td colspan="2" style="color:var(--danger)">Failed to load: ${escapeHtml(msg)}</td></tr>`;
    return false;
  }

  accounts = acctData || [];
  lines = (lineData || []).map(l => ({
    account_id: l.account_id, debit: Number(l.debit || 0), credit: Number(l.credit || 0),
    entry_date: l.journal_entries?.entry_date,
  }));
  return true;
}

function accountsByType(...types) {
  return accounts.filter(a => types.includes(a.type));
}

// ---------- Profit & Loss (period report) ----------

function renderProfitLoss() {
  const start = plStart.value;
  const end = plEnd.value;
  const periodLines = lines.filter(l => (!start || l.entry_date >= start) && (!end || l.entry_date <= end));

  const revenueAccounts = accountsByType("revenue");
  const expenseAccounts = accountsByType("expense");

  const sumFor = (accountId) => {
    const forAccount = periodLines.filter(l => l.account_id === accountId);
    return { debit: forAccount.reduce((s, l) => s + l.debit, 0), credit: forAccount.reduce((s, l) => s + l.credit, 0) };
  };

  let totalRevenue = 0, totalExpense = 0;
  const revenueRows = revenueAccounts.map(a => {
    const { debit, credit } = sumFor(a.id);
    const net = credit - debit; // revenue is credit-normal
    totalRevenue += net;
    return { name: `${a.code} — ${a.name}`, amount: net };
  }).filter(r => Math.abs(r.amount) > 0.001);

  const expenseRows = expenseAccounts.map(a => {
    const { debit, credit } = sumFor(a.id);
    const net = debit - credit; // expense is debit-normal
    totalExpense += net;
    return { name: `${a.code} — ${a.name}`, amount: net };
  }).filter(r => Math.abs(r.amount) > 0.001);

  const netProfit = totalRevenue - totalExpense;

  plBody.innerHTML = `
    <tr class="statement-section-label"><td colspan="2">Revenue</td></tr>
    ${revenueRows.length ? revenueRows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${money(r.amount)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty-state">No revenue this period</td></tr>`}
    <tr class="statement-total-row"><td>Total Revenue</td><td>${money(totalRevenue)}</td></tr>

    <tr class="statement-section-label"><td colspan="2">Expenses</td></tr>
    ${expenseRows.length ? expenseRows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${money(r.amount)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty-state">No expenses this period</td></tr>`}
    <tr class="statement-total-row"><td>Total Expenses</td><td>${money(totalExpense)}</td></tr>

    <tr class="statement-net-row"><td>${netProfit >= 0 ? "Net Profit" : "Net Loss"}</td><td>${money(Math.abs(netProfit))}</td></tr>
  `;
}

document.querySelectorAll("[data-pl-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    const now = new Date();
    if (btn.dataset.plPreset === "month") {
      plStart.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      plEnd.value = todayStr();
    } else if (btn.dataset.plPreset === "year") {
      plStart.value = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
      plEnd.value = todayStr();
    } else {
      plStart.value = ""; plEnd.value = "";
    }
    renderProfitLoss();
  });
});
plRefreshBtn.addEventListener("click", renderProfitLoss);

// ---------- Balance Sheet (point-in-time snapshot) ----------

function renderBalanceSheet() {
  const asOf = bsAsOf.value || todayStr();
  const cumulativeLines = lines.filter(l => !l.entry_date || l.entry_date <= asOf);

  const sumFor = (accountId) => {
    const forAccount = cumulativeLines.filter(l => l.account_id === accountId);
    return { debit: forAccount.reduce((s, l) => s + l.debit, 0), credit: forAccount.reduce((s, l) => s + l.credit, 0) };
  };

  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;

  const assetRows = accountsByType("asset").map(a => {
    const { debit, credit } = sumFor(a.id);
    const net = a.normal_balance === "debit" ? debit - credit : credit - debit; // handles contra-assets like Accumulated Depreciation correctly
    totalAssets += net;
    return { name: `${a.code} — ${a.name}`, amount: net };
  }).filter(r => Math.abs(r.amount) > 0.001);

  const liabilityRows = accountsByType("liability").map(a => {
    const { debit, credit } = sumFor(a.id);
    const net = credit - debit;
    totalLiabilities += net;
    return { name: `${a.code} — ${a.name}`, amount: net };
  }).filter(r => Math.abs(r.amount) > 0.001);

  const equityRows = accountsByType("equity").map(a => {
    const { debit, credit } = sumFor(a.id);
    const net = credit - debit;
    totalEquity += net;
    return { name: `${a.code} — ${a.name}`, amount: net };
  }).filter(r => Math.abs(r.amount) > 0.001);

  // Net income since inception folds into Equity here, the standard way
  // to present an interim balance sheet without running a formal
  // period-end closing process — revenue and expense accounts are, in
  // effect, temporary equity accounts until closed.
  let netIncomeToDate = 0;
  accountsByType("revenue").forEach(a => { const { debit, credit } = sumFor(a.id); netIncomeToDate += credit - debit; });
  accountsByType("expense").forEach(a => { const { debit, credit } = sumFor(a.id); netIncomeToDate -= debit - credit; });
  totalEquity += netIncomeToDate;

  bsBody.innerHTML = `
    <tr class="statement-section-label"><td colspan="2">Assets</td></tr>
    ${assetRows.length ? assetRows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${money(r.amount)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty-state">No asset activity</td></tr>`}
    <tr class="statement-total-row"><td>Total Assets</td><td>${money(totalAssets)}</td></tr>

    <tr class="statement-section-label"><td colspan="2">Liabilities</td></tr>
    ${liabilityRows.length ? liabilityRows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${money(r.amount)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty-state">No liability activity</td></tr>`}
    <tr class="statement-total-row"><td>Total Liabilities</td><td>${money(totalLiabilities)}</td></tr>

    <tr class="statement-section-label"><td colspan="2">Equity</td></tr>
    ${equityRows.length ? equityRows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${money(r.amount)}</td></tr>`).join("") : ""}
    <tr><td>Net Income to Date</td><td>${money(netIncomeToDate)}</td></tr>
    <tr class="statement-total-row"><td>Total Equity</td><td>${money(totalEquity)}</td></tr>
  `;

  const diff = totalAssets - (totalLiabilities + totalEquity);
  if (Math.abs(diff) < 0.01) {
    bsBalanceStatus.className = "balance-status ok";
    bsBalanceStatus.textContent = `Balances ✓ — Assets ${money(totalAssets)} = Liabilities + Equity ${money(totalLiabilities + totalEquity)}`;
  } else {
    bsBalanceStatus.className = "balance-status off";
    bsBalanceStatus.textContent = `Does not balance — off by ${money(diff)}. This should never happen given the Ledger's balance enforcement; if you see this, check for a manually edited row outside the app.`;
  }
}

document.querySelectorAll("[data-bs-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    const now = new Date();
    if (btn.dataset.bsPreset === "today") bsAsOf.value = todayStr();
    else if (btn.dataset.bsPreset === "month-end") bsAsOf.value = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    else if (btn.dataset.bsPreset === "year-end") bsAsOf.value = new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10);
    renderBalanceSheet();
  });
});
bsRefreshBtn.addEventListener("click", renderBalanceSheet);

document.addEventListener("DOMContentLoaded", async () => {
  const now = new Date();
  plStart.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  plEnd.value = todayStr();
  bsAsOf.value = todayStr();

  const ok = await loadLedgerData();
  if (ok) { renderProfitLoss(); renderBalanceSheet(); }
});