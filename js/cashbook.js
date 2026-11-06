import supabase from "./supabaseClient.js";

const cashForm = document.getElementById("cash-form");
const cashFormMessage = document.getElementById("cash-form-message");
const cashDateInput = document.getElementById("cash-date");
const cashAccountSelect = document.getElementById("cash-account");
const cashContraAccountSelect = document.getElementById("cash-contra-account");
const cashbookFilter = document.getElementById("cashbook-filter");
const cashbookSummary = document.getElementById("cashbook-summary");
const cashbookTableBody = document.querySelector("#cashbook-table tbody");
const cashDrawerSummary = document.getElementById("cash-drawer-summary");
const cashDrawerTableBody = document.querySelector("#cash-drawer-table tbody");
const reconciliationExpected = document.getElementById("reconciliation-expected");
const reconciliationCounted = document.getElementById("reconciliation-counted");
const reconciliationNotes = document.getElementById("reconciliation-notes");
const reconciliationMessage = document.getElementById("reconciliation-message");
const reconciliationHistory = document.getElementById("reconciliation-history");
const reconciliationSaveButton = document.getElementById("reconciliation-save");
const staffAdvanceForm = document.getElementById("staff-advance-form");
const staffAdvanceMessage = document.getElementById("staff-advance-message");
const staffAdvanceRepaymentForm = document.getElementById("staff-advance-repayment-form");
const staffAdvanceRepaymentMessage = document.getElementById("staff-advance-repayment-message");
const staffAdvanceRepaymentSelect = document.getElementById("staff-advance-repayment-id");
const staffAdvancesSummary = document.getElementById("staff-advances-summary");
const staffAdvancesTableBody = document.querySelector("#staff-advances-table tbody");

const pettyCashBalanceEl = document.getElementById("petty-cash-balance");
const pettyCashStatusEl = document.getElementById("petty-cash-status");
const pettyExpenseForm = document.getElementById("petty-expense-form");
const peAccountSelect = document.getElementById("pe-account");
const peFormMessage = document.getElementById("pe-form-message");
const pettyTopupForm = document.getElementById("petty-topup-form");
const ptAccountSelect = document.getElementById("pt-account");
const ptFormMessage = document.getElementById("pt-form-message");
const pettyCashTableBody = document.querySelector("#petty-cash-table tbody");
let cashTransactionInProgress = false;
let pettyExpenseInProgress = false;
let pettyTopupInProgress = false;

const CASH_BANK_CODES = ["1000", "1010", "1020"];
const PETTY_CASH_CODE = "1050";
const STAFF_ADVANCES_CODE = "1150";
const ZIMBABWE_TIME_ZONE = "Africa/Harare";

let accounts = [];
let cashLedgerLines = [];
let supplementalCashTransactions = [];
let dailyCashSnapshot = null;
let staffAdvanceRows = [];

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function findAccountByCode(code) { return accounts.find(a => a.code === code); }
function dateInZimbabwe(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZIMBABWE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function selectedBusinessDate() {
  return document.getElementById("float-date").value || dateInZimbabwe();
}
function dateTimeInZimbabwe(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
      timeZone: ZIMBABWE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
}
function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00+02:00`);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
      timeZone: ZIMBABWE_TIME_ZONE, day: "2-digit", month: "short", year: "numeric",
    }).format(date);
}
function showFormMessage(element, message, tone) {
  element.textContent = message;
  element.dataset.tone = tone;
}
async function fetchAllPages(buildQuery, label) {
  const results = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await buildQuery().range(offset, offset + 999);
    if (error) throw new Error(`Couldn't load ${label}: ${error.message}`);
    results.push(...(data || []));
    if (!data || data.length < 1000) return results;
  }
}

// ---------- Load accounts, populate all the selects ----------

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("id, code, name, type").eq("is_active", true).order("code");
  if (error) throw new Error(`Couldn't load accounts: ${error.message}`);
  accounts = data || [];

  const cashBankAccounts = accounts.filter(a => [...CASH_BANK_CODES, PETTY_CASH_CODE].includes(a.code));
  const fundingAccounts = accounts.filter(a => CASH_BANK_CODES.includes(a.code)); // top-ups come from real cash/bank, not petty cash itself
  const expenseAccounts = accounts.filter(a => a.type === "expense");
  const allAccounts = accounts;

  const opt = (list) => list.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join("");

  cashAccountSelect.innerHTML = `<option value="">Select…</option>${opt(cashBankAccounts)}`;
  cashAccountSelect.value = findAccountByCode("1000")?.id || "";
  cashContraAccountSelect.innerHTML = `<option value="">Select…</option>${opt(allAccounts)}`;
  peAccountSelect.innerHTML = `<option value="">Select…</option>${opt(expenseAccounts)}`;
  ptAccountSelect.innerHTML = `<option value="">Select…</option>${opt(fundingAccounts)}`;
}

// ---------- General cash transaction ----------

cashForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (cashTransactionInProgress) return;
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

  cashTransactionInProgress = true;
  const submitButton = cashForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  cashFormMessage.textContent = "Posting…"; cashFormMessage.dataset.tone = "info";
  try {
  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: date, description, source_type: "cash_transaction",
  }]).select().single();
  if (entryError) {
    cashFormMessage.textContent = "Failed to post: " + entryError.message;
    cashFormMessage.dataset.tone = "error";
    return;
  }

  const lines = direction === "in"
    ? [{ account_id: cashAccountId, debit: amount, credit: 0 }, { account_id: contraAccountId, debit: 0, credit: amount }]
    : [{ account_id: contraAccountId, debit: amount, credit: 0 }, { account_id: cashAccountId, debit: 0, credit: amount }];

  const { error: linesError } = await supabase.from("journal_lines").insert(lines.map(l => ({ ...l, journal_entry_id: entry.id })));
  if (linesError) {
    const { error: cleanupError } = await supabase.from("journal_entries").delete().eq("id", entry.id);
    cashFormMessage.textContent = cleanupError
      ? `Transaction lines failed (${linesError.message}) and the incomplete journal entry could not be removed (${cleanupError.message}). Contact an administrator before retrying.`
      : "Failed to post: " + linesError.message + ". The incomplete journal entry was removed; you can safely retry.";
    cashFormMessage.dataset.tone = "error";
    return;
  }

  cashForm.reset();
  cashDateInput.value = dateInZimbabwe();
  cashFormMessage.textContent = "Posted to the ledger."; cashFormMessage.dataset.tone = "success";
  await loadDayActivity();
  } catch (error) {
    console.error("Cash transaction failed:", error);
    cashFormMessage.textContent = "Failed to post: " + (error.message || String(error));
    cashFormMessage.dataset.tone = "error";
  } finally {
    cashTransactionInProgress = false;
    if (submitButton) submitButton.disabled = false;
  }
});

// ---------- Zimbabwe-day cash reports ----------

function renderCashBook(date) {
  const filter = cashbookFilter.value;
  const codes = filter === "all" ? CASH_BANK_CODES : [filter];
  const selectedIds = new Set(accounts.filter(account => codes.includes(account.code)).map(account => account.id));
  const rows = cashLedgerLines
    .filter(row => selectedIds.has(row.account_id) && row.journal_entries?.entry_date === date)
    .sort((left, right) => {
      const byDate = String(left.journal_entries?.created_at || "").localeCompare(String(right.journal_entries?.created_at || ""));
      return byDate || String(left.id).localeCompare(String(right.id));
    });
  let opening = cashLedgerLines
    .filter(row => selectedIds.has(row.account_id) && row.journal_entries?.entry_date < date)
    .reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0);
  const openingBalance = opening;
  const tableRows = rows.map(row => {
    const inAmt = Number(row.debit || 0);
    const outAmt = Number(row.credit || 0);
    opening += inAmt - outAmt;
    return `<tr><td>${dateLabel(date)}</td><td>${escapeHtml(row.journal_entries?.description || "—")}</td><td class="cash-in">${inAmt ? money(inAmt) : ""}</td><td class="cash-out">${outAmt ? money(outAmt) : ""}</td><td>${money(opening)}</td></tr>`;
  });
  const dayIn = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  const dayOut = rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  cashbookSummary.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Opening balance · ${escapeHtml(dateLabel(date))}</div><div class="stat-card__value">${money(openingBalance)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Allocated money in</div><div class="stat-card__value cash-in">${money(dayIn)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Allocated money out</div><div class="stat-card__value cash-out">${money(dayOut)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Closing balance</div><div class="stat-card__value">${money(openingBalance + dayIn - dayOut)}</div></div>`;
  cashbookTableBody.innerHTML = tableRows.length
    ? tableRows.reverse().join("")
    : `<tr><td colspan="5" class="empty-state">No allocated cash-book movements on ${escapeHtml(dateLabel(date))}.</td></tr>`;
}

function renderCashDrawer(date) {
  const cashAccount = findAccountByCode("1000");
  if (!cashAccount) {
    cashDrawerSummary.innerHTML = '<div class="stat-card"><div class="stat-card__label">Cash on Hand account (1000) is missing.</div></div>';
    cashDrawerTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">Create or activate Cash on Hand in the chart of accounts.</td></tr>';
    return;
  }
  const ledgerRows = cashLedgerLines
    .filter(row => row.account_id === cashAccount.id && row.journal_entries?.entry_date === date)
    .map(row => ({
      timestamp: row.journal_entries?.created_at || `${date}T00:00:00+02:00`,
      description: row.journal_entries?.description || "Cash book transaction",
      inAmt: Number(row.debit || 0),
      outAmt: Number(row.credit || 0),
    }));
  const receiptRows = supplementalCashTransactions.filter(row => row.date === date);
  const rows = [...ledgerRows, ...receiptRows].sort((left, right) =>
    String(left.timestamp).localeCompare(String(right.timestamp)));
  const openingLedger = cashLedgerLines
    .filter(row => row.account_id === cashAccount.id && row.journal_entries?.entry_date < date)
    .reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0);
  const openingSupplemental = supplementalCashTransactions
    .filter(row => row.date < date)
    .reduce((sum, row) => sum + row.inAmt - row.outAmt, 0);
  const opening = openingLedger + openingSupplemental;
  const cashIn = rows.reduce((sum, row) => sum + row.inAmt, 0);
  const cashOut = rows.reduce((sum, row) => sum + row.outAmt, 0);
  const expected = opening + cashIn - cashOut;
  let running = opening;
  const tableRows = rows.map(row => {
    running += row.inAmt - row.outAmt;
    return `<tr><td>${dateTimeInZimbabwe(row.timestamp)}</td><td>${escapeHtml(row.description)}</td><td class="cash-in">${row.inAmt ? money(row.inAmt) : ""}</td><td class="cash-out">${row.outAmt ? money(row.outAmt) : ""}</td><td>${money(running)}</td></tr>`;
  });
  dailyCashSnapshot = { date, opening, cashIn, cashOut, expected };
  reconciliationExpected.textContent = money(expected);
  cashDrawerSummary.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Opening drawer</div><div class="stat-card__value">${money(opening)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Cash received</div><div class="stat-card__value cash-in">${money(cashIn)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Cash paid out</div><div class="stat-card__value cash-out">${money(cashOut)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Expected drawer</div><div class="stat-card__value">${money(expected)}</div></div>`;
  cashDrawerTableBody.innerHTML = tableRows.length
    ? tableRows.reverse().join("")
    : `<tr><td colspan="5" class="empty-state">No cash drawer transactions on ${escapeHtml(dateLabel(date))}.</td></tr>`;
}

function renderDailyFloat(date) {
  const cashAccount = findAccountByCode("1000");
  const bankAccount = findAccountByCode("1010");
  const ids = new Set([cashAccount?.id, bankAccount?.id].filter(Boolean));
  const before = cashLedgerLines.filter(row => ids.has(row.account_id) && row.journal_entries?.entry_date < date);
  const today = cashLedgerLines.filter(row => ids.has(row.account_id) && row.journal_entries?.entry_date === date);
  const opening = before.reduce((sum, row) => sum + Number(row.debit || 0) - Number(row.credit || 0), 0)
    + supplementalCashTransactions.filter(row => row.date < date).reduce((sum, row) => sum + row.inAmt - row.outAmt, 0);
  const cashIn = today.reduce((sum, row) => sum + Number(row.debit || 0), 0)
    + supplementalCashTransactions.filter(row => row.date === date).reduce((sum, row) => sum + row.inAmt, 0);
  const cashOut = today.reduce((sum, row) => sum + Number(row.credit || 0), 0);
  const closing = opening + cashIn - cashOut;
  document.getElementById("daily-float-summary").innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Opening cash, bank &amp; EcoCash</div><div class="stat-card__value">${money(opening)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Money received</div><div class="stat-card__value cash-in">${money(cashIn)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Money paid out</div><div class="stat-card__value cash-out">${money(cashOut)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Expected closing cash, bank &amp; EcoCash</div><div class="stat-card__value">${money(closing)}</div></div>`;
}

async function loadDayActivity() {
  const date = selectedBusinessDate();
  const reconciliationLocked = date >= dateInZimbabwe();
  if (reconciliationSaveButton) {
    reconciliationSaveButton.disabled = reconciliationLocked;
    reconciliationSaveButton.title = reconciliationLocked ? "Available after the selected Zimbabwe business day has ended." : "Save end-of-day reconciliation";
  }
  const reportAccountIds = accounts.filter(account => [...CASH_BANK_CODES, PETTY_CASH_CODE, STAFF_ADVANCES_CODE].includes(account.code)).map(account => account.id);
  try {
    const [journalLines, saleReceipts, jobPayments, postedOrders] = await Promise.all([
      fetchAllPages(() => supabase.from("journal_lines")
        .select("id, account_id, debit, credit, journal_entries!inner(entry_date, created_at, description, source_type)")
        .in("account_id", reportAccountIds)
        .order("id", { ascending: true }), "cash-book ledger activity"),
      fetchAllPages(() => supabase.from("receipts")
        .select("id, sales_order_id, amount, issued_at, voided_at, sales_orders!inner(order_number, payment_method)")
        .eq("sales_orders.payment_method", "Cash")
        .is("voided_at", null)
        .order("issued_at", { ascending: true })
        .order("id", { ascending: true }), "cash sale receipts"),
      fetchAllPages(() => supabase.from("repair_job_payments")
        .select("id, amount, payment_method, paid_at, voided_at, repair_jobs(job_number, customers(full_name))")
        .eq("payment_method", "Cash")
        .is("voided_at", null)
        .order("paid_at", { ascending: true })
        .order("id", { ascending: true }), "cash job payments"),
      fetchAllPages(() => supabase.from("quick_sale_order_postings")
        .select("sales_order_id"), "posted Quick Sale orders"),
    ]);
    cashLedgerLines = journalLines || [];
    const postedOrderIds = new Set((postedOrders || []).map(posting => posting.sales_order_id));
    supplementalCashTransactions = [
      ...(saleReceipts || []).filter(receipt => !postedOrderIds.has(receipt.sales_order_id)).map(receipt => ({
        id: receipt.id, timestamp: receipt.issued_at, date: dateInZimbabwe(new Date(receipt.issued_at)),
        description: `Quick Sale · Order ${receipt.sales_orders?.order_number ?? "—"}`,
        inAmt: Number(receipt.amount) || 0, outAmt: 0,
      })),
      ...(jobPayments || []).map(payment => ({
        id: payment.id, timestamp: payment.paid_at, date: dateInZimbabwe(new Date(payment.paid_at)),
        description: `Job card · ${payment.repair_jobs?.job_number ?? "—"} · ${payment.repair_jobs?.customers?.full_name || "Customer payment"}`,
        inAmt: Number(payment.amount) || 0, outAmt: 0,
      })),
    ];
    renderCashBook(date);
    renderCashDrawer(date);
    renderDailyFloat(date);
  } catch (error) {
    console.error("Couldn't load daily cash activity:", error);
    cashbookTableBody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">${escapeHtml(error.message || String(error))}</td></tr>`;
    cashDrawerTableBody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">${escapeHtml(error.message || String(error))}</td></tr>`;
    cashbookSummary.innerHTML = "";
    cashDrawerSummary.innerHTML = "";
    document.getElementById("daily-float-summary").innerHTML = "";
    showFormMessage(reconciliationMessage, error.message || String(error), "error");
    return;
  }

  await Promise.all([
    loadLatestReconciliation(date).catch(error => {
      console.error("Couldn't load the saved reconciliation:", error);
      reconciliationHistory.textContent = `Couldn't load saved reconciliation: ${error.message || String(error)}`;
      showFormMessage(reconciliationMessage, error.message || String(error), "error");
    }),
    loadPettyCash().catch(error => {
      console.error("Couldn't load petty cash:", error);
      pettyCashStatusEl.textContent = `Couldn't load petty cash: ${error.message || String(error)}`;
      pettyCashStatusEl.className = "float-status low";
      pettyCashTableBody.innerHTML = `<tr><td colspan="3" style="color:var(--danger)">${escapeHtml(error.message || String(error))}</td></tr>`;
    }),
    loadStaffAdvances().catch(error => {
      console.error("Couldn't load staff advances:", error);
      staffAdvancesSummary.textContent = `Couldn't load staff advances: ${error.message || String(error)}`;
      staffAdvancesTableBody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">${escapeHtml(error.message || String(error))}</td></tr>`;
    }),
  ]);
}

document.getElementById("float-date")?.addEventListener("change", loadDayActivity);
cashbookFilter.addEventListener("change", () => renderCashBook(selectedBusinessDate()));

// ---------- Petty Cash ----------

async function loadPettyCashSettings() {
  const { data, error } = await supabase.from("petty_cash_settings").select("target_float").limit(1).maybeSingle();
  if (error) throw new Error(`Couldn't load petty-cash settings: ${error.message}`);
  return data ? Number(data.target_float) : 100;
}

async function loadPettyCash() {
  const pettyAccount = findAccountByCode(PETTY_CASH_CODE);
  if (!pettyAccount) { pettyCashBalanceEl.textContent = "—"; return; }

  const lines = cashLedgerLines.filter(line => line.account_id === pettyAccount.id);
  const targetFloat = await loadPettyCashSettings();
  const balance = (lines || []).reduce((sum, l) => sum + Number(l.debit || 0) - Number(l.credit || 0), 0);
  pettyCashBalanceEl.textContent = money(balance);

  if (balance < targetFloat * 0.3) {
    pettyCashStatusEl.textContent = `Running low — target float is ${money(targetFloat)}. Consider topping up ${money(targetFloat - balance)}.`;
    pettyCashStatusEl.className = "float-status low";
  } else {
    pettyCashStatusEl.textContent = `Target float: ${money(targetFloat)}`;
    pettyCashStatusEl.className = "float-status ok";
  }

  const dayLines = lines.filter(line => line.journal_entries?.entry_date === selectedBusinessDate());
  pettyCashTableBody.innerHTML = dayLines.length
    ? dayLines.map(l => {
        const isExpense = Number(l.credit) > 0;
        return `<tr><td>${l.journal_entries?.entry_date || ""}</td><td>${escapeHtml(l.journal_entries?.description || "—")}</td><td class="${isExpense ? "cash-out" : "cash-in"}">${isExpense ? "-" : "+"}${money(isExpense ? l.credit : l.debit)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="3" class="empty-state">No petty cash activity on ${escapeHtml(dateLabel(selectedBusinessDate()))}.</td></tr>`;
}

async function loadLatestReconciliation(date) {
  const { data, error } = await supabase.from("cash_reconciliations")
    .select("id,business_date,opening_cash,cash_received,cash_paid,expected_cash,counted_cash,variance,notes,created_at")
    .eq("business_date", date)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the saved reconciliation: ${error.message}`);
  if (!data) {
    reconciliationHistory.innerHTML = `<p class="section-note">No reconciliation has been saved for ${escapeHtml(dateLabel(date))}.</p>`;
    return;
  }
  const variance = Number(data.variance) || 0;
  const varianceLabel = Math.abs(variance) < 0.005
    ? "Balanced"
    : `${variance > 0 ? "Over" : "Short"} by ${money(Math.abs(variance))}`;
  reconciliationHistory.innerHTML = `<div class="panel" style="margin-top:12px;padding:12px;">
    <strong>Latest reconciliation · ${escapeHtml(dateLabel(data.business_date))}</strong>
    <span>Expected ${money(data.expected_cash)} · Counted ${money(data.counted_cash)} · <b>${escapeHtml(varianceLabel)}</b></span>
    <small>Saved ${escapeHtml(dateTimeInZimbabwe(data.created_at))} Zimbabwe time${data.notes ? ` · ${escapeHtml(data.notes)}` : ""}</small>
  </div>`;
}

reconciliationSaveButton.addEventListener("click", async () => {
  const snapshot = dailyCashSnapshot;
  const rawCounted = reconciliationCounted.value;
  const counted = Number(rawCounted);
  if (!snapshot) return showFormMessage(reconciliationMessage, "Daily cash activity is not loaded yet. Refresh and try again.", "error");
  const today = dateInZimbabwe();
  if (snapshot.date >= today) {
    return showFormMessage(reconciliationMessage, "Daily reconciliation can only be saved after the Zimbabwe business day has ended. Select a completed prior day.", "error");
  }
  if (rawCounted === "" || !Number.isFinite(counted) || counted < 0) {
    return showFormMessage(reconciliationMessage, "Enter the actual cash counted in the drawer.", "error");
  }
  reconciliationSaveButton.disabled = true;
  showFormMessage(reconciliationMessage, "Saving the daily reconciliation…", "info");
  try {
    const { error } = await supabase.rpc("save_cash_reconciliation", {
      p_business_date: snapshot.date,
      p_opening_cash: snapshot.opening,
      p_cash_received: snapshot.cashIn,
      p_cash_paid: snapshot.cashOut,
      p_expected_cash: snapshot.expected,
      p_counted_cash: counted,
      p_notes: reconciliationNotes.value.trim() || null,
    });
    if (error) throw new Error(error.message);
    showFormMessage(reconciliationMessage, "Reconciliation saved as an audit record.", "success");
    reconciliationCounted.value = "";
    reconciliationNotes.value = "";
    await loadLatestReconciliation(snapshot.date);
  } catch (error) {
    console.error("Couldn't save the cash reconciliation:", error);
    showFormMessage(reconciliationMessage, `Couldn't save reconciliation: ${error.message || String(error)}. Apply supabase/migrations/cashbook-daily-reconciliation-advances.sql if this feature is not installed.`, "error");
  } finally {
    reconciliationSaveButton.disabled = false;
  }
});

document.getElementById("generate-daily-summary")?.addEventListener("click", () => {
  const snapshot = dailyCashSnapshot;
  const output = document.getElementById("daily-summary-output");
  if (!snapshot || !output) {
    showFormMessage(reconciliationMessage, "Daily activity is still loading. Try again in a moment.", "error");
    return;
  }
  const date = snapshot.date;
  const pettyRows = Array.from(pettyCashTableBody?.querySelectorAll("tr") || []);
  const staffText = staffAdvancesSummary?.textContent?.replace(/\s+/g, " ").trim() || "No staff advances loaded.";
  const reconciliationText = reconciliationHistory?.textContent?.replace(/\s+/g, " ").trim() || "No reconciliation recorded for this day.";
  const topups = cashLedgerLines.filter(row =>
    row.journal_entries?.entry_date === date &&
    String(row.journal_entries?.source_type || "").includes("topup")
  );
  const topupTotal = topups.reduce((sum, row) => sum + Number(row.debit || 0), 0);
  output.style.display = "block";
  output.textContent =
    `DAILY CASH BOOK SUMMARY - ${date}\n\n` +
    `Opening drawer cash: ${money(snapshot.opening)}\n` +
    `Cash received: ${money(snapshot.cashIn)}\n` +
    `Cash paid out: ${money(snapshot.cashOut)}\n` +
    `Expected closing drawer: ${money(snapshot.expected)}\n` +
    `Actual cash counted: ${reconciliationCounted.value ? money(reconciliationCounted.value) : "Not entered"}\n\n` +
    `Float top-ups and other funding received: ${money(topupTotal)}\n` +
    `Petty-cash activity: ${pettyRows.length ? `${pettyRows.length - 1} recorded line(s)` : "No recorded activity"}\n` +
    `Staff advances: ${staffText}\n` +
    `Reconciliation: ${reconciliationText}\n\n` +
    `This summary reflects the actual journal, receipt, payment, petty-cash, staff-advance and reconciliation activity loaded for the selected Zimbabwe business date.`;
});

async function loadStaffAdvances() {
  const { data, error } = await supabase.from("staff_cash_advances")
    .select("id,staff_name,amount,advance_date,staff_cash_advance_repayments(amount)")
    .order("advance_date", { ascending: false });
  if (error) throw new Error(`Couldn't load staff advances: ${error.message}`);
  staffAdvanceRows = (data || []).map(advance => {
    const repaid = (advance.staff_cash_advance_repayments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return { ...advance, repaid, outstanding: Math.max(0, Number(advance.amount) - repaid) };
  });
  const outstanding = staffAdvanceRows.reduce((sum, row) => sum + row.outstanding, 0);
  staffAdvancesSummary.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Advances issued</div><div class="stat-card__value">${money(staffAdvanceRows.reduce((sum, row) => sum + Number(row.amount), 0))}</div></div>
    <div class="stat-card"><div class="stat-card__label">Repaid</div><div class="stat-card__value">${money(staffAdvanceRows.reduce((sum, row) => sum + row.repaid, 0))}</div></div>
    <div class="stat-card"><div class="stat-card__label">Outstanding staff advances</div><div class="stat-card__value">${money(outstanding)}</div></div>`;
  staffAdvancesTableBody.innerHTML = staffAdvanceRows.length
    ? staffAdvanceRows.map(row => `<tr><td>${escapeHtml(row.staff_name)}</td><td>${escapeHtml(dateLabel(row.advance_date))}</td><td>${money(row.amount)}</td><td>${money(row.repaid)}</td><td>${money(row.outstanding)}</td></tr>`).join("")
    : '<tr><td colspan="5" class="empty-state">No staff cash advances have been recorded.</td></tr>';
  const outstandingRows = staffAdvanceRows.filter(row => row.outstanding > 0.005);
  staffAdvanceRepaymentSelect.innerHTML = `<option value="">Select outstanding advance…</option>${outstandingRows.map(row => `<option value="${escapeHtml(row.id)}" data-outstanding="${row.outstanding}">${escapeHtml(row.staff_name)} · ${dateLabel(row.advance_date)} · ${money(row.outstanding)} remaining</option>`).join("")}`;
  staffAdvanceRepaymentForm.querySelector("#staff-advance-repayment-amount").max =
    outstandingRows.length ? String(Math.max(...outstandingRows.map(row => row.outstanding))) : "";
}
staffAdvanceRepaymentSelect.addEventListener("change", () => {
  const selected = staffAdvanceRepaymentSelect.selectedOptions[0];
  const amountInput = staffAdvanceRepaymentForm.querySelector("#staff-advance-repayment-amount");
  amountInput.max = selected?.dataset.outstanding || "";
});

staffAdvanceForm.addEventListener("submit", async event => {
  event.preventDefault();
  const name = document.getElementById("staff-advance-name").value.trim();
  const amount = Number(document.getElementById("staff-advance-amount").value);
  const date = document.getElementById("staff-advance-date").value;
  if (!name || !date || !Number.isFinite(amount) || amount <= 0) {
    return showFormMessage(staffAdvanceMessage, "Enter a staff member, date, and amount greater than zero.", "error");
  }
  const submitButton = staffAdvanceForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showFormMessage(staffAdvanceMessage, "Recording the advance…", "info");
  try {
    const { error } = await supabase.rpc("issue_staff_cash_advance", {
      p_staff_name: name, p_amount: amount, p_advance_date: date,
    });
    if (error) throw new Error(error.message);
    staffAdvanceForm.reset();
    document.getElementById("staff-advance-date").value = dateInZimbabwe();
    showFormMessage(staffAdvanceMessage, "Staff advance recorded and posted to Cash on Hand.", "success");
    await loadDayActivity();
  } catch (error) {
    console.error("Couldn't issue staff cash advance:", error);
    showFormMessage(staffAdvanceMessage, `Couldn't issue advance: ${error.message || String(error)}. Apply supabase/migrations/cashbook-daily-reconciliation-advances.sql if this feature is not installed.`, "error");
  } finally {
    submitButton.disabled = false;
  }
});

staffAdvanceRepaymentForm.addEventListener("submit", async event => {
  event.preventDefault();
  const advanceId = staffAdvanceRepaymentSelect.value;
  const amount = Number(document.getElementById("staff-advance-repayment-amount").value);
  const date = document.getElementById("staff-advance-repayment-date").value;
  if (!advanceId || !date || !Number.isFinite(amount) || amount <= 0) {
    return showFormMessage(staffAdvanceRepaymentMessage, "Select an advance and enter a repayment date and amount greater than zero.", "error");
  }
  const submitButton = staffAdvanceRepaymentForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showFormMessage(staffAdvanceRepaymentMessage, "Recording repayment…", "info");
  try {
    const { error } = await supabase.rpc("repay_staff_cash_advance", {
      p_advance_id: advanceId, p_amount: amount, p_repayment_date: date,
    });
    if (error) throw new Error(error.message);
    staffAdvanceRepaymentForm.reset();
    document.getElementById("staff-advance-repayment-date").value = dateInZimbabwe();
    showFormMessage(staffAdvanceRepaymentMessage, "Repayment recorded and posted to Cash on Hand.", "success");
    await loadDayActivity();
  } catch (error) {
    console.error("Couldn't record staff advance repayment:", error);
    showFormMessage(staffAdvanceRepaymentMessage, `Couldn't record repayment: ${error.message || String(error)}. Apply supabase/migrations/cashbook-daily-reconciliation-advances.sql if this feature is not installed.`, "error");
  } finally {
    submitButton.disabled = false;
  }
});

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

  if (pettyExpenseInProgress) return;
  pettyExpenseInProgress = true;
  const submitButton = pettyExpenseForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
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
    const { error: cleanupError } = await supabase.from("journal_entries").delete().eq("id", entry.id);
    peFormMessage.textContent = cleanupError
      ? `Expense lines failed (${linesError.message}) and the incomplete journal entry could not be removed (${cleanupError.message}). Contact an administrator before retrying.`
      : "Failed: " + linesError.message + ". The incomplete journal entry was removed; you can safely retry.";
    peFormMessage.dataset.tone = "error";
    return;
  }

  pettyExpenseForm.reset();
  document.getElementById("pe-date").value = dateInZimbabwe();
  peFormMessage.textContent = "Expense logged."; peFormMessage.dataset.tone = "success";
  await loadDayActivity();
  } catch (error) {
    console.error("Petty-cash expense failed:", error);
    peFormMessage.textContent = "Failed: " + (error.message || String(error));
    peFormMessage.dataset.tone = "error";
  } finally {
    pettyExpenseInProgress = false;
    if (submitButton) submitButton.disabled = false;
  }
});

pettyTopupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const pettyAccount = findAccountByCode(PETTY_CASH_CODE);
  const fundingAccountId = ptAccountSelect.value;
  const supplier = document.getElementById("pt-supplier")?.value.trim();
  const amount = parseFloat(document.getElementById("pt-amount").value);
  const date = document.getElementById("pt-date").value;

  if (!pettyAccount || !fundingAccountId || !supplier || !amount || amount <= 0) {
    ptFormMessage.textContent = "Fill in all fields with a valid amount."; ptFormMessage.dataset.tone = "error"; return;
  }

  const sourceAccount = accounts.find(account => account.id === fundingAccountId);
  const revenueAccount = accounts.find(account => account.type === "income" && /other|revenue|income/i.test(`${account.code} ${account.name}`))
    || accounts.find(account => account.type === "income");
  if (!revenueAccount) {
    ptFormMessage.textContent = "No income account is configured. Add an active Income / Other Income account before recording the float top-up.";
    ptFormMessage.dataset.tone = "error";
    return;
  }

  if (pettyTopupInProgress) return;
  pettyTopupInProgress = true;
  const submitButton = pettyTopupForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
  ptFormMessage.textContent = "Saving…"; ptFormMessage.dataset.tone = "info";
  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: date,
    description: `Float top-up supplied by ${supplier}; issuing account/source: ${sourceAccount ? `${sourceAccount.code} — ${sourceAccount.name}` : "Not specified"}`,
    source_type: "petty_cash_topup",
  }]).select().single();
  if (entryError) { ptFormMessage.textContent = "Failed: " + entryError.message; ptFormMessage.dataset.tone = "error"; return; }

  const { error: linesError } = await supabase.from("journal_lines").insert([
    { journal_entry_id: entry.id, account_id: pettyAccount.id, debit: amount, credit: 0 },
    { journal_entry_id: entry.id, account_id: revenueAccount.id, debit: 0, credit: amount },
  ]);
  if (linesError) {
    const { error: cleanupError } = await supabase.from("journal_entries").delete().eq("id", entry.id);
    ptFormMessage.textContent = cleanupError
      ? `Top-up lines failed (${linesError.message}) and the incomplete journal entry could not be removed (${cleanupError.message}). Contact an administrator before retrying.`
      : "Failed: " + linesError.message + ". The incomplete journal entry was removed; you can safely retry.";
    ptFormMessage.dataset.tone = "error";
    return;
  }

  pettyTopupForm.reset();
  document.getElementById("pt-date").value = dateInZimbabwe();
  ptFormMessage.textContent = "Float topped up."; ptFormMessage.dataset.tone = "success";
  await loadDayActivity();
  } catch (error) {
    console.error("Petty-cash top-up failed:", error);
    ptFormMessage.textContent = "Failed: " + (error.message || String(error));
    ptFormMessage.dataset.tone = "error";
  } finally {
    pettyTopupInProgress = false;
    if (submitButton) submitButton.disabled = false;
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const today = dateInZimbabwe();
  cashDateInput.value = today;
  document.getElementById("pe-date").value = today;
  document.getElementById("pt-date").value = today;
  document.getElementById("staff-advance-date").value = today;
  document.getElementById("staff-advance-repayment-date").value = today;
  const floatDateInput = document.getElementById("float-date");
  if (floatDateInput) floatDateInput.value = today;

  try {
    await loadAccounts();
    await loadDayActivity();
  } catch (error) {
    console.error("Cash Book setup failed:", error);
    cashFormMessage.textContent = `Cash Book setup failed: ${error.message || String(error)}`;
    cashFormMessage.dataset.tone = "error";
  }
});
