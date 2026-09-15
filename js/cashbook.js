import supabase from "./supabaseClient.js";

const cashForm = document.getElementById("cash-form");
const cashFormMessage = document.getElementById("cash-form-message");
const cashDateInput = document.getElementById("cash-date");
const cashAccountSelect = document.getElementById("cash-account");
const cashContraAccountSelect = document.getElementById("cash-contra-account");
const cashbookFilter = document.getElementById("cashbook-filter");
const cashbookSummary = document.getElementById("cashbook-summary");
const cashbookTableBody = document.querySelector("#cashbook-table tbody");

const pettyCashBalanceEl = document.getElementById("petty-cash-balance");
const pettyCashStatusEl = document.getElementById("petty-cash-status");
const pettyExpenseForm = document.getElementById("petty-expense-form");
const peAccountSelect = document.getElementById("pe-account");
const peFormMessage = document.getElementById("pe-form-message");
const pettyTopupForm = document.getElementById("petty-topup-form");
const ptAccountSelect = document.getElementById("pt-account");
const ptFormMessage = document.getElementById("pt-form-message");
const pettyCashTableBody = document.querySelector("#petty-cash-table tbody");

const CASH_BANK_CODES = ["1000", "1010"];
const PETTY_CASH_CODE = "1050";

let accounts = [];

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function findAccountByCode(code) { return accounts.find(a => a.code === code); }

// ---------- Load accounts, populate all the selects ----------

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("id, code, name, type").eq("is_active", true).order("code");
  if (error) { console.error("Error loading accounts:", error); return; }
  accounts = data || [];

  const cashBankAccounts = accounts.filter(a => [...CASH_BANK_CODES, PETTY_CASH_CODE].includes(a.code));
  const fundingAccounts = accounts.filter(a => CASH_BANK_CODES.includes(a.code)); // top-ups come from real cash/bank, not petty cash itself
  const expenseAccounts = accounts.filter(a => a.type === "expense");
  const allAccounts = accounts;

  const opt = (list) => list.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join("");

  cashAccountSelect.innerHTML = `<option value="">Select…</option>${opt(cashBankAccounts)}`;
  cashContraAccountSelect.innerHTML = `<option value="">Select…</option>${opt(allAccounts)}`;
  peAccountSelect.innerHTML = `<option value="">Select…</option>${opt(expenseAccounts)}`;
  ptAccountSelect.innerHTML = `<option value="">Select…</option>${opt(fundingAccounts)}`;
}

// ---------- General cash transaction ----------

cashForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const direction = document.getElementById("cash-direction").value;
  const amount = parseFloat(document.getElementById("cash-amount").value);
  const cashAccountId = cashAccountSelect.value;
  const contraAccountId = cashContraAccountSelect.value;
  const description = document.getElementById("cash-description").value.trim();
  const date = cashDateInput.value;

  if (!amount || amount <= 0 || !cashAccountId || !contraAccountId) {
    cashFormMessage.textContent = "Fill in all fields with a valid amount.";
    cashFormMessage.dataset.tone = "error";
    return;
  }
  if (cashAccountId === contraAccountId) {
    cashFormMessage.textContent = "Choose two different accounts.";
    cashFormMessage.dataset.tone = "error";
    return;
  }

  cashFormMessage.textContent = "Posting…"; cashFormMessage.dataset.tone = "info";

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: date, description, source_type: "cash_transaction",
  }]).select().single();
  if (entryError) { cashFormMessage.textContent = "Failed to post: " + entryError.message; cashFormMessage.dataset.tone = "error"; return; }

  const lines = direction === "in"
    ? [{ account_id: cashAccountId, debit: amount, credit: 0 }, { account_id: contraAccountId, debit: 0, credit: amount }]
    : [{ account_id: contraAccountId, debit: amount, credit: 0 }, { account_id: cashAccountId, debit: 0, credit: amount }];

  const { error: linesError } = await supabase.from("journal_lines").insert(lines.map(l => ({ ...l, journal_entry_id: entry.id })));
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    cashFormMessage.textContent = "Failed to post: " + linesError.message;
    cashFormMessage.dataset.tone = "error";
    return;
  }

  cashForm.reset();
  cashDateInput.value = new Date().toISOString().slice(0, 10);
  cashFormMessage.textContent = "Posted to the ledger."; cashFormMessage.dataset.tone = "success";
  loadCashBook();
});

// ---------- Cash Book (live report over the ledger) ----------

async function loadCashBook() {
  const filter = cashbookFilter.value;
  const codes = filter === "all" ? CASH_BANK_CODES : [filter];
  const accountIds = accounts.filter(a => codes.includes(a.code)).map(a => a.id);
  if (!accountIds.length) return;

  const { data, error } = await supabase
    .from("journal_lines")
    .select("debit, credit, journal_entries(entry_date, description)")
    .in("account_id", accountIds)
    .order("journal_entries(entry_date)", { ascending: true });

  if (error) {
    cashbookTableBody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}. If you're not logged in as an admin, this is expected.</td></tr>`;
    cashbookSummary.innerHTML = "";
    return;
  }

  let running = 0;
  const rows = (data || []).map(row => {
    running += Number(row.debit || 0) - Number(row.credit || 0);
    return {
      date: row.journal_entries?.entry_date,
      description: row.journal_entries?.description || "—",
      inAmt: Number(row.debit || 0),
      outAmt: Number(row.credit || 0),
      balance: running,
    };
  });

  cashbookSummary.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Current Balance</div><div class="stat-card__value">${money(running)}</div></div>
  `;

  cashbookTableBody.innerHTML = rows.length
    ? rows.slice().reverse().map(r => `
        <tr>
          <td>${r.date}</td>
          <td>${escapeHtml(r.description)}</td>
          <td class="cash-in">${r.inAmt > 0 ? money(r.inAmt) : ""}</td>
          <td class="cash-out">${r.outAmt > 0 ? money(r.outAmt) : ""}</td>
          <td>${money(r.balance)}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="empty-state">No cash movements recorded yet</td></tr>`;
}
cashbookFilter.addEventListener("change", loadCashBook);

// ---------- Petty Cash ----------

async function loadPettyCashSettings() {
  const { data, error } = await supabase.from("petty_cash_settings").select("target_float").limit(1).maybeSingle();
  if (error) { console.error("Error loading petty cash settings:", error); return 100; }
  return data ? Number(data.target_float) : 100;
}

async function loadPettyCash() {
  const pettyAccount = findAccountByCode(PETTY_CASH_CODE);
  if (!pettyAccount) { pettyCashBalanceEl.textContent = "—"; return; }

  const [{ data: lines, error }, targetFloat] = await Promise.all([
    supabase.from("journal_lines").select("debit, credit, memo, journal_entries(entry_date, description)").eq("account_id", pettyAccount.id).order("journal_entries(entry_date)", { ascending: false }),
    loadPettyCashSettings(),
  ]);

  if (error) {
    pettyCashTableBody.innerHTML = `<tr><td colspan="3" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  const balance = (lines || []).reduce((sum, l) => sum + Number(l.debit || 0) - Number(l.credit || 0), 0);
  pettyCashBalanceEl.textContent = money(balance);

  if (balance < targetFloat * 0.3) {
    pettyCashStatusEl.textContent = `Running low — target float is ${money(targetFloat)}. Consider topping up ${money(targetFloat - balance)}.`;
    pettyCashStatusEl.className = "float-status low";
  } else {
    pettyCashStatusEl.textContent = `Target float: ${money(targetFloat)}`;
    pettyCashStatusEl.className = "float-status ok";
  }

  pettyCashTableBody.innerHTML = (lines || []).length
    ? lines.map(l => {
        const isExpense = Number(l.credit) > 0;
        return `<tr><td>${l.journal_entries?.entry_date || ""}</td><td>${escapeHtml(l.journal_entries?.description || "—")}</td><td class="${isExpense ? "cash-out" : "cash-in"}">${isExpense ? "-" : "+"}${money(isExpense ? l.credit : l.debit)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="3" class="empty-state">No petty cash activity yet</td></tr>`;
}

pettyExpenseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pettyAccount = findAccountByCode(PETTY_CASH_CODE);
  const expenseAccountId = peAccountSelect.value;
  const amount = parseFloat(document.getElementById("pe-amount").value);
  const description = document.getElementById("pe-description").value.trim();
  const date = document.getElementById("pe-date").value;

  if (!pettyAccount || !expenseAccountId || !amount || amount <= 0) {
    peFormMessage.textContent = "Fill in all fields with a valid amount."; peFormMessage.dataset.tone = "error"; return;
  }

  peFormMessage.textContent = "Saving…"; peFormMessage.dataset.tone = "info";
  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: date, description: `Petty cash: ${description}`, source_type: "petty_cash_expense",
  }]).select().single();
  if (entryError) { peFormMessage.textContent = "Failed: " + entryError.message; peFormMessage.dataset.tone = "error"; return; }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    { journal_entry_id: entry.id, account_id: expenseAccountId, debit: amount, credit: 0 },
    { journal_entry_id: entry.id, account_id: pettyAccount.id, debit: 0, credit: amount },
  ]);
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    peFormMessage.textContent = "Failed: " + linesError.message; peFormMessage.dataset.tone = "error";
    return;
  }

  pettyExpenseForm.reset();
  document.getElementById("pe-date").value = new Date().toISOString().slice(0, 10);
  peFormMessage.textContent = "Expense logged."; peFormMessage.dataset.tone = "success";
  loadPettyCash();
});

pettyTopupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pettyAccount = findAccountByCode(PETTY_CASH_CODE);
  const fundingAccountId = ptAccountSelect.value;
  const amount = parseFloat(document.getElementById("pt-amount").value);
  const date = document.getElementById("pt-date").value;

  if (!pettyAccount || !fundingAccountId || !amount || amount <= 0) {
    ptFormMessage.textContent = "Fill in all fields with a valid amount."; ptFormMessage.dataset.tone = "error"; return;
  }

  ptFormMessage.textContent = "Saving…"; ptFormMessage.dataset.tone = "info";
  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: date, description: "Petty cash top-up", source_type: "petty_cash_topup",
  }]).select().single();
  if (entryError) { ptFormMessage.textContent = "Failed: " + entryError.message; ptFormMessage.dataset.tone = "error"; return; }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    { journal_entry_id: entry.id, account_id: pettyAccount.id, debit: amount, credit: 0 },
    { journal_entry_id: entry.id, account_id: fundingAccountId, debit: 0, credit: amount },
  ]);
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    ptFormMessage.textContent = "Failed: " + linesError.message; ptFormMessage.dataset.tone = "error";
    return;
  }

  pettyTopupForm.reset();
  document.getElementById("pt-date").value = new Date().toISOString().slice(0, 10);
  ptFormMessage.textContent = "Float topped up."; ptFormMessage.dataset.tone = "success";
  loadPettyCash();
  loadCashBook(); // the funding side of this shows up here too
});

document.addEventListener("DOMContentLoaded", async () => {
  const today = new Date().toISOString().slice(0, 10);
  cashDateInput.value = today;
  document.getElementById("pe-date").value = today;
  document.getElementById("pt-date").value = today;

  await loadAccounts();
  loadCashBook();
  loadPettyCash();
});