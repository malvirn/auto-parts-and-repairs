import supabase from "./supabaseClient.js";

const accountForm = document.getElementById("account-form");
const accountsTable = document.getElementById("accounts-table");
const accountFormMessage = document.getElementById("account-form-message");

const journalForm = document.getElementById("journal-form");
const journalLinesContainer = document.getElementById("journal-lines");
const addLineBtn = document.getElementById("add-line-btn");
const balanceCheck = document.getElementById("balance-check");
const totalDebitEl = document.getElementById("total-debit");
const totalCreditEl = document.getElementById("total-credit");
const balanceStatusEl = document.getElementById("balance-status");
const postEntryBtn = document.getElementById("post-entry-btn");
const journalFormMessage = document.getElementById("journal-form-message");

const entriesTable = document.getElementById("entries-table");
const trialBalanceBody = document.getElementById("trial-balance-body");
const refreshTbBtn = document.getElementById("refresh-tb-btn");

const entryModal = document.getElementById("entry-modal");
const entryModalRef = document.getElementById("entry-modal-ref");
const entryModalLines = document.getElementById("entry-modal-lines");
const entryModalClose = document.getElementById("entry-modal-close");

let accounts = [];
let lineCount = 0;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }

// ---------- Chart of Accounts ----------

const TYPE_DEFAULT_NORMAL = { asset: "debit", liability: "credit", equity: "credit", revenue: "credit", expense: "debit" };
document.getElementById("acct-type").addEventListener("change", (e) => {
  document.getElementById("acct-normal").value = TYPE_DEFAULT_NORMAL[e.target.value] || "debit";
});

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("*").order("code");
  if (error) {
    console.error("Error loading accounts:", error);
    accountsTable.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}. If you're not logged in as an admin, this is expected — accounts are admin-only.</td></tr>`;
    return;
  }
  accounts = data || [];

  accountsTable.innerHTML = accounts.length ? accounts.map(a => `
    <tr>
      <td>${escapeHtml(a.code)}</td>
      <td>${escapeHtml(a.name)}</td>
      <td><span class="type-badge">${escapeHtml(a.type)}</span></td>
      <td>${escapeHtml(a.normal_balance)}</td>
      <td>${a.is_active ? "Active" : "Inactive"}</td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-state">No accounts yet</td></tr>`;

  populateAccountSelects();
}

accountForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    code: document.getElementById("acct-code").value.trim(),
    name: document.getElementById("acct-name").value.trim(),
    type: document.getElementById("acct-type").value,
    normal_balance: document.getElementById("acct-normal").value,
  };
  accountFormMessage.textContent = "Saving…"; accountFormMessage.dataset.tone = "info";
  const { error } = await supabase.from("accounts").insert([payload]);
  if (error) { accountFormMessage.textContent = "Failed to add account: " + error.message; accountFormMessage.dataset.tone = "error"; return; }
  accountForm.reset();
  document.getElementById("acct-normal").value = "debit";
  accountFormMessage.textContent = "Account added."; accountFormMessage.dataset.tone = "success";
  loadAccounts();
});

// ---------- Journal Entry lines ----------

function accountOptions() {
  return accounts.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join("");
}

function populateAccountSelects() {
  journalLinesContainer.querySelectorAll(".je-account").forEach(select => {
    const current = select.value;
    select.innerHTML = `<option value="">Select account…</option>${accountOptions()}`;
    if (current) select.value = current;
  });
}

function addJournalLine() {
  lineCount += 1;
  const row = document.createElement("div");
  row.className = "journal-line-row";
  row.innerHTML = `
    <select class="je-account">${`<option value="">Select account…</option>${accountOptions()}`}</select>
    <input type="number" class="je-debit" step="0.01" min="0" placeholder="Debit" />
    <input type="number" class="je-credit" step="0.01" min="0" placeholder="Credit" />
    <button type="button" class="btn remove-line-btn"><i data-lucide="x"></i></button>
  `;
  journalLinesContainer.appendChild(row);
  if (window.lucide) lucide.createIcons();

  row.querySelector(".je-debit").addEventListener("input", (e) => {
    if (Number(e.target.value) > 0) row.querySelector(".je-credit").value = "";
    recalcBalance();
  });
  row.querySelector(".je-credit").addEventListener("input", (e) => {
    if (Number(e.target.value) > 0) row.querySelector(".je-debit").value = "";
    recalcBalance();
  });
  row.querySelector(".remove-line-btn").addEventListener("click", () => { row.remove(); recalcBalance(); });
}

function recalcBalance() {
  let totalDebit = 0, totalCredit = 0;
  journalLinesContainer.querySelectorAll(".journal-line-row").forEach(row => {
    totalDebit += Number(row.querySelector(".je-debit").value) || 0;
    totalCredit += Number(row.querySelector(".je-credit").value) || 0;
  });
  totalDebitEl.textContent = money(totalDebit);
  totalCreditEl.textContent = money(totalCredit);

  const balanced = totalDebit > 0 && totalDebit === totalCredit;
  balanceCheck.classList.toggle("balanced", balanced);
  balanceCheck.classList.toggle("unbalanced", !balanced);
  balanceStatusEl.textContent = balanced ? "Balanced ✓" : "Not balanced yet";
  postEntryBtn.disabled = !balanced;
}

addLineBtn.addEventListener("click", addJournalLine);

journalForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const lines = [...journalLinesContainer.querySelectorAll(".journal-line-row")].map(row => ({
    account_id: row.querySelector(".je-account").value,
    debit: Number(row.querySelector(".je-debit").value) || 0,
    credit: Number(row.querySelector(".je-credit").value) || 0,
  })).filter(l => l.account_id && (l.debit > 0 || l.credit > 0));

  if (lines.length < 2) { journalFormMessage.textContent = "Add at least two lines."; journalFormMessage.dataset.tone = "error"; return; }

  journalFormMessage.textContent = "Posting…"; journalFormMessage.dataset.tone = "info";

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: document.getElementById("je-date").value,
    reference: document.getElementById("je-reference").value.trim() || null,
    description: document.getElementById("je-description").value.trim(),
    source_type: "manual",
  }]).select().single();

  if (entryError) { journalFormMessage.textContent = "Failed to create entry: " + entryError.message; journalFormMessage.dataset.tone = "error"; return; }

  const { error: linesError } = await supabase.from("journal_lines").insert(
    lines.map(l => ({ ...l, journal_entry_id: entry.id }))
  );

  if (linesError) {
    // Database rejected it — almost certainly the balance trigger. Clean up
    // the orphaned header row rather than leaving a half-posted entry behind.
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    journalFormMessage.textContent = "Failed to post entry: " + linesError.message;
    journalFormMessage.dataset.tone = "error";
    return;
  }

  journalForm.reset();
  document.getElementById("je-date").value = new Date().toISOString().slice(0, 10);
  journalLinesContainer.innerHTML = "";
  addJournalLine(); addJournalLine();
  recalcBalance();
  journalFormMessage.textContent = "Entry posted."; journalFormMessage.dataset.tone = "success";
  loadEntries();
  loadTrialBalance();
});

// ---------- Recent entries ----------

async function loadEntries() {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, entry_date, reference, description, journal_lines(debit, credit)")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    entriesTable.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  entriesTable.innerHTML = data?.length ? data.map(entry => {
    const total = (entry.journal_lines || []).reduce((sum, l) => sum + Number(l.debit || 0), 0);
    return `
      <tr>
        <td>${entry.entry_date}</td>
        <td>${escapeHtml(entry.reference || "—")}</td>
        <td>${escapeHtml(entry.description)}</td>
        <td>${money(total)}</td>
        <td><button type="button" class="btn view-entry-btn" data-id="${entry.id}"><i data-lucide="eye"></i> View</button></td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="5" class="empty-state">No journal entries yet</td></tr>`;

  if (window.lucide) lucide.createIcons();
  entriesTable.querySelectorAll(".view-entry-btn").forEach(btn => {
    btn.addEventListener("click", () => openEntryModal(btn.dataset.id));
  });
}

async function openEntryModal(id) {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, entry_date, reference, description, journal_lines(debit, credit, memo, accounts(code, name))")
    .eq("id", id)
    .single();
  if (error || !data) { alert("Couldn't load that entry."); return; }

  entryModalRef.textContent = data.reference || data.entry_date;
  entryModalLines.innerHTML = `
    <p style="margin-bottom:12px; color:var(--text-muted);">${escapeHtml(data.description)} · ${data.entry_date}</p>
    <table>
      <thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
      <tbody>
        ${(data.journal_lines || []).map(l => `
          <tr><td>${escapeHtml(l.accounts?.code || "")} ${escapeHtml(l.accounts?.name || "")}</td><td>${l.debit > 0 ? money(l.debit) : ""}</td><td>${l.credit > 0 ? money(l.credit) : ""}</td></tr>
        `).join("")}
      </tbody>
    </table>
  `;
  entryModal.classList.remove("hidden");
  entryModal.style.display = "flex";
}
entryModalClose.addEventListener("click", () => { entryModal.classList.add("hidden"); entryModal.style.display = "none"; });
entryModal.addEventListener("click", (e) => { if (e.target === entryModal) { entryModal.classList.add("hidden"); entryModal.style.display = "none"; } });

// ---------- Trial Balance ----------

async function loadTrialBalance() {
  const { data, error } = await supabase.from("trial_balance").select("*");
  if (error) {
    trialBalanceBody.innerHTML = `<tr><td colspan="4" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  let totalDebit = 0, totalCredit = 0;
  const rows = (data || []).map(row => {
    totalDebit += Number(row.total_debit);
    totalCredit += Number(row.total_credit);
    return `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.name)}</td><td>${row.total_debit > 0 ? money(row.total_debit) : ""}</td><td>${row.total_credit > 0 ? money(row.total_credit) : ""}</td></tr>`;
  });

  trialBalanceBody.innerHTML = (rows.length ? rows.join("") : `<tr><td colspan="4" class="empty-state">No activity posted yet</td></tr>`)
    + `<tr class="tb-totals"><td colspan="2">Total</td><td>${money(totalDebit)}</td><td>${money(totalCredit)}</td></tr>`;
}

refreshTbBtn.addEventListener("click", loadTrialBalance);

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("je-date").value = new Date().toISOString().slice(0, 10);
  await loadAccounts();
  addJournalLine(); addJournalLine();
  recalcBalance();
  loadEntries();
  loadTrialBalance();
});