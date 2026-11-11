import supabase from "./supabaseClient.js";
import { installBulkDelete } from "./bulk-delete.js";

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
installBulkDelete({
  tbody: entriesTable,
  table: "journal_entries",
  label: "journal entry",
  getId: row => row.dataset.journalEntryId,
  beforeDelete: async ids => {
    const { data, error } = await supabase.from("journal_entries")
      .select("id, source_type")
      .in("id", ids);
    if (error) throw error;
    if ((data || []).some(entry => entry.source_type)) {
      throw new Error("Entries created by payroll, payables, assets, or purchasing must be removed from their source workflow.");
    }
  },
});
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

function amountToCents(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  if (!/^\\d+(?:\\.\\d{1,2})?$/.test(raw)) return NaN;
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

function recalcBalance() {
  let totalDebitCents = 0, totalCreditCents = 0;
  let invalidAmount = false;
  journalLinesContainer.querySelectorAll(".journal-line-row").forEach(row => {
    const debit = amountToCents(row.querySelector(".je-debit").value);
    const credit = amountToCents(row.querySelector(".je-credit").value);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) invalidAmount = true;
    else {
      totalDebitCents += debit;
      totalCreditCents += credit;
    }
  });
  totalDebitEl.textContent = money(totalDebitCents / 100);
  totalCreditEl.textContent = money(totalCreditCents / 100);
  const balanced = !invalidAmount && totalDebitCents > 0 && totalDebitCents === totalCreditCents;
  balanceCheck.classList.toggle("balanced", balanced);
  balanceCheck.classList.toggle("unbalanced", !balanced);
  balanceStatusEl.textContent = invalidAmount ? "Use amounts with up to 2 decimal places" : balanced ? "Balanced ✓" : "Not balanced yet";
  postEntryBtn.disabled = !balanced;
}

addLineBtn.addEventListener("click", addJournalLine);

journalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (journalForm.dataset.submitting === "true") return;
  journalForm.dataset.submitting = "true";

  try {
  const lines = [...journalLinesContainer.querySelectorAll(".journal-line-row")].map(row => ({
    account_id: row.querySelector(".je-account").value,
    debitCents: amountToCents(row.querySelector(".je-debit").value),
    creditCents: amountToCents(row.querySelector(".je-credit").value),
  })).filter(line => line.account_id || line.debitCents || line.creditCents);

  if (lines.some(line => !Number.isSafeInteger(line.debitCents) || !Number.isSafeInteger(line.creditCents))) {
    journalFormMessage.textContent = "Use valid amounts with no more than 2 decimal places.";
    journalFormMessage.dataset.tone = "error";
    return;
  }
  if (lines.length < 2 || lines.some(line => !line.account_id || line.debitCents < 0 || line.creditCents < 0 ||
    !((line.debitCents > 0 && line.creditCents === 0) || (line.creditCents > 0 && line.debitCents === 0)))) {
    journalFormMessage.textContent = "Add at least two complete lines. Each line needs one account and either a debit or a credit.";
    journalFormMessage.dataset.tone = "error";
    return;
  }
  const debitTotalCents = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const creditTotalCents = lines.reduce((sum, line) => sum + line.creditCents, 0);
  if (!Number.isSafeInteger(debitTotalCents) || debitTotalCents <= 0 || debitTotalCents !== creditTotalCents) {
    journalFormMessage.textContent = "The journal entry must balance exactly to the cent.";
    journalFormMessage.dataset.tone = "error";
    return;
  }

  journalFormMessage.textContent = "Posting…"; journalFormMessage.dataset.tone = "info";
  postEntryBtn.disabled = true;
  const { error: postError } = await supabase.rpc("post_manual_journal_entry", {
    p_entry_date: document.getElementById("je-date").value,
    p_reference: document.getElementById("je-reference").value.trim() || null,
    p_description: document.getElementById("je-description").value.trim(),
    p_lines: lines.map(line => ({
      account_id: line.account_id,
      debit: line.debitCents / 100,
      credit: line.creditCents / 100,
    })),
  });

  if (postError) {
    journalFormMessage.textContent = "Failed to post entry: " + postError.message;
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
  } finally {
    delete journalForm.dataset.submitting;
    recalcBalance();
  }
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
      <tr data-journal-entry-id="${entry.id}">
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
    .select("id, entry_date, reference, description, source_type, journal_lines(debit, credit, memo, accounts(code, name))")
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

  // Payroll entries only show the lump-sum totals above (Wages Expense /
  // Bank / Tax Payable) — the actual per-employee split lives in a
  // separate table (payroll_payments), linked via the payroll_runs row
  // that points back at this journal entry. Only super_admin can
  // actually see this (RLS on payroll_payments) — for anyone else this
  // section just quietly stays empty rather than erroring, which is the
  // correct behaviour, not a bug.
  if (data.source_type === "payroll") {
    const { data: run } = await supabase.from("payroll_runs").select("id").eq("journal_entry_id", id).maybeSingle();
    if (run) {
      const { data: payments } = await supabase.from("payroll_payments").select("employee_name, department, gross_salary, deductions, commission_amount, net_pay").eq("payroll_run_id", run.id).order("employee_name");
      if (payments && payments.length) {
        entryModalLines.innerHTML += `
          <h4 style="margin:16px 0 8px; font-size:.85rem;">Per-Employee Breakdown</h4>
          <table>
            <thead><tr><th>Employee</th><th>Gross</th><th>Deductions</th><th>Commission</th><th>Net Paid</th></tr></thead>
            <tbody>
              ${payments.map(p => `
                <tr><td>${escapeHtml(p.employee_name)}</td><td>${money(p.gross_salary)}</td><td>${money(p.deductions)}</td><td>${money(p.commission_amount)}</td><td><strong>${money(p.net_pay)}</strong></td></tr>
              `).join("")}
            </tbody>
          </table>
        `;
      }
    }
  }

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
