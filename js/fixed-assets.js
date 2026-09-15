import supabase from "./supabaseClient.js";

const assetForm = document.getElementById("asset-form");
const assetFormMessage = document.getElementById("asset-form-message");
const paymentSelect = document.getElementById("asset-payment");
const paymentAccountField = document.getElementById("asset-payment-account-field");
const paymentAccountSelect = document.getElementById("asset-payment-account");
const assetsTableBody = document.getElementById("assets-table");
const runDepreciationBtn = document.getElementById("run-depreciation-btn");

const disposeModal = document.getElementById("dispose-modal");
const disposeSummary = document.getElementById("dispose-summary");
const disposeDateInput = document.getElementById("dispose-date");
const disposeProceedsInput = document.getElementById("dispose-proceeds");
const disposeAccountSelect = document.getElementById("dispose-account");
const disposePreview = document.getElementById("dispose-preview");
const disposeSave = document.getElementById("dispose-save");
const disposeCancel = document.getElementById("dispose-cancel");
const disposeFormMessage = document.getElementById("dispose-form-message");

let accounts = [];
let assets = [];
let depreciationTotals = {}; // asset_id -> accumulated depreciation so far
let currentDisposeAsset = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function findAccountByCode(code) { return accounts.find(a => a.code === code); }

// ---------- Reference data ----------

async function loadAccounts() {
  const { data, error } = await supabase.from("accounts").select("id, code, name").eq("is_active", true).order("code");
  if (error) { console.error("Error loading accounts:", error); return; }
  accounts = data || [];
  const cashBank = accounts.filter(a => ["1000", "1010"].includes(a.code));
  const opts = cashBank.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join("");
  paymentAccountSelect.innerHTML = `<option value="">Select…</option>${opts}`;
  disposeAccountSelect.innerHTML = `<option value="">Select…</option>${opts}`;
}

function updatePaymentFieldVisibility() {
  paymentAccountField.style.display = paymentSelect.value === "paid" ? "" : "none";
  paymentAccountSelect.required = paymentSelect.value === "paid";
}
paymentSelect.addEventListener("change", updatePaymentFieldVisibility);

// ---------- Add asset (posts acquisition to the ledger) ----------

assetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("asset-name").value.trim();
  const category = document.getElementById("asset-category").value;
  const purchaseDate = document.getElementById("asset-date").value;
  const purchaseCost = parseFloat(document.getElementById("asset-cost").value);
  const salvageValue = parseFloat(document.getElementById("asset-salvage").value) || 0;
  const usefulLife = parseFloat(document.getElementById("asset-life").value);
  const paymentStatus = paymentSelect.value;
  const paymentAccountId = paymentAccountSelect.value;

  if (!name || !purchaseCost || purchaseCost <= 0 || !usefulLife || usefulLife <= 0) {
    assetFormMessage.textContent = "Fill in name, a valid cost, and useful life."; assetFormMessage.dataset.tone = "error"; return;
  }
  if (paymentStatus === "paid" && !paymentAccountId) {
    assetFormMessage.textContent = "Select which account this was paid from."; assetFormMessage.dataset.tone = "error"; return;
  }

  const assetAccount = findAccountByCode("1300");
  const apAccount = findAccountByCode("2000");
  if (!assetAccount || (paymentStatus === "on_credit" && !apAccount)) {
    assetFormMessage.textContent = "Tools and Equipment (1300) or Accounts Payable (2000) account missing from your Chart of Accounts."; assetFormMessage.dataset.tone = "error"; return;
  }

  assetFormMessage.textContent = "Saving…"; assetFormMessage.dataset.tone = "info";

  const { data: asset, error: assetError } = await supabase.from("fixed_assets").insert([{
    name, category, purchase_date: purchaseDate, purchase_cost: purchaseCost,
    salvage_value: salvageValue, useful_life_years: usefulLife,
  }]).select().single();
  if (assetError) { assetFormMessage.textContent = "Failed to save: " + assetError.message; assetFormMessage.dataset.tone = "error"; return; }

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: purchaseDate, description: `Acquired fixed asset: ${name}`, source_type: "fixed_asset",
  }]).select().single();

  if (!entryError) {
    const creditAccountId = paymentStatus === "paid" ? paymentAccountId : apAccount.id;
    const { error: linesError } = await supabase.from("journal_lines").insert([
      { journal_entry_id: entry.id, account_id: assetAccount.id, debit: purchaseCost, credit: 0 },
      { journal_entry_id: entry.id, account_id: creditAccountId, debit: 0, credit: purchaseCost },
    ]);
    if (!linesError) {
      await supabase.from("fixed_assets").update({ journal_entry_id: entry.id }).eq("id", asset.id);
      if (paymentStatus === "on_credit") {
        const dueDate = new Date(purchaseDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const { error: payableError } = await supabase.from("payables").insert([{
          supplier_id: null, bill_date: purchaseDate, due_date: dueDate.toISOString().slice(0, 10),
          amount: purchaseCost, description: `Fixed asset purchase: ${name}`, journal_entry_id: entry.id,
        }]);
        if (payableError) console.error("Payable for asset purchase failed:", payableError);
      }
    } else {
      await supabase.from("journal_entries").delete().eq("id", entry.id);
      console.error("Ledger posting failed for asset:", linesError);
    }
  }

  assetForm.reset();
  document.getElementById("asset-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("asset-salvage").value = 0;
  document.getElementById("asset-life").value = 5;
  assetFormMessage.textContent = "Asset added and posted to the ledger."; assetFormMessage.dataset.tone = "success";
  loadAssets();
});

// ---------- Load register ----------

async function loadAssets() {
  const [{ data: assetData, error }, { data: depData }] = await Promise.all([
    supabase.from("fixed_assets").select("*").order("purchase_date", { ascending: false }),
    supabase.from("depreciation_entries").select("asset_id, amount"),
  ]);

  if (error) {
    assetsTableBody.innerHTML = `<tr><td colspan="7" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}. If you're not logged in as an admin, this is expected.</td></tr>`;
    return;
  }

  assets = assetData || [];
  depreciationTotals = {};
  (depData || []).forEach(d => { depreciationTotals[d.asset_id] = (depreciationTotals[d.asset_id] || 0) + Number(d.amount); });

  assetsTableBody.innerHTML = assets.length ? assets.map(a => {
    const accum = depreciationTotals[a.id] || 0;
    const nbv = Number(a.purchase_cost) - accum;
    return `
      <tr>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.category || "—")}</td>
        <td>${money(a.purchase_cost)}</td>
        <td>${money(accum)}</td>
        <td>${money(nbv)}</td>
        <td><span class="status-badge ${a.is_active ? "active" : "disposed"}">${a.is_active ? "Active" : "Disposed"}</span></td>
        <td>${a.is_active ? `<button type="button" class="btn dispose-btn" data-id="${a.id}"><i data-lucide="log-out"></i> Dispose</button>` : ""}</td>
      </tr>
    `;
  }).join("") : `<tr><td colspan="7" class="empty-state">No fixed assets registered yet</td></tr>`;

  if (window.lucide) lucide.createIcons();
  assetsTableBody.querySelectorAll(".dispose-btn").forEach(btn => btn.addEventListener("click", () => openDisposeModal(btn.dataset.id)));
}

// ---------- Run monthly depreciation (batched into one ledger entry) ----------

runDepreciationBtn.addEventListener("click", async () => {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  if (!confirm(`Run straight-line depreciation for ${now.toLocaleString("default", { month: "long" })} ${year} across all active assets?`)) return;

  runDepreciationBtn.disabled = true;
  const original = runDepreciationBtn.innerHTML;
  runDepreciationBtn.innerHTML = `<i data-lucide="loader-circle"></i> Running…`;
  if (window.lucide) lucide.createIcons();

  try {
    const depreciationExpense = findAccountByCode("5400");
    const accumDepreciation = findAccountByCode("1310");
    if (!depreciationExpense || !accumDepreciation) {
      alert("Depreciation Expense (5400) or Accumulated Depreciation (1310) account missing from your Chart of Accounts.");
      return;
    }

    let totalToPost = 0;
    const toRecord = [];

    for (const asset of assets.filter(a => a.is_active)) {
      const depreciableBase = Number(asset.purchase_cost) - Number(asset.salvage_value);
      const monthly = depreciableBase / Number(asset.useful_life_years) / 12;
      const alreadyAccumulated = depreciationTotals[asset.id] || 0;
      const remaining = depreciableBase - alreadyAccumulated;
      if (remaining <= 0.01) continue; // fully depreciated already

      const amount = Math.min(monthly, remaining);
      toRecord.push({ asset_id: asset.id, amount });
      totalToPost += amount;
    }

    if (!toRecord.length) { alert("Nothing to depreciate — every active asset is either fully depreciated or already processed this month."); return; }

    const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
      entry_date: now.toISOString().slice(0, 10),
      description: `Depreciation for ${now.toLocaleString("default", { month: "long", year: "numeric" })}`,
      source_type: "depreciation",
    }]).select().single();
    if (entryError) { alert("Failed to post: " + entryError.message); return; }

    const { error: linesError } = await supabase.from("journal_lines").insert([
      { journal_entry_id: entry.id, account_id: depreciationExpense.id, debit: totalToPost, credit: 0 },
      { journal_entry_id: entry.id, account_id: accumDepreciation.id, debit: 0, credit: totalToPost },
    ]);
    if (linesError) {
      await supabase.from("journal_entries").delete().eq("id", entry.id);
      alert("Failed to post: " + linesError.message);
      return;
    }

    let recorded = 0, skipped = 0;
    for (const r of toRecord) {
      const { error } = await supabase.from("depreciation_entries").insert([{ asset_id: r.asset_id, year, month, amount: r.amount, journal_entry_id: entry.id }]);
      if (error) { if (error.code === "23505") skipped++; else console.error(error); }
      else recorded++;
    }

    alert(`Depreciation posted — ${money(totalToPost)} across ${recorded} asset(s)${skipped ? `, ${skipped} already processed this month` : ""}.`);
    loadAssets();
  } finally {
    runDepreciationBtn.disabled = false;
    runDepreciationBtn.innerHTML = original;
    if (window.lucide) lucide.createIcons();
  }
});

// ---------- Disposal ----------

function openDisposeModal(id) {
  currentDisposeAsset = assets.find(a => a.id === id);
  if (!currentDisposeAsset) return;
  const accum = depreciationTotals[id] || 0;
  const nbv = Number(currentDisposeAsset.purchase_cost) - accum;
  disposeSummary.textContent = `${currentDisposeAsset.name} — Net book value ${money(nbv)}`;
  disposeDateInput.value = new Date().toISOString().slice(0, 10);
  disposeProceedsInput.value = 0;
  disposePreview.textContent = "";
  disposeFormMessage.textContent = "";
  disposeProceedsInput.oninput = () => updateDisposePreview(nbv);
  updateDisposePreview(nbv);
  disposeModal.classList.remove("hidden");
  disposeModal.style.display = "flex";
}
function updateDisposePreview(nbv) {
  const proceeds = parseFloat(disposeProceedsInput.value) || 0;
  const gainLoss = proceeds - nbv;
  disposePreview.textContent = gainLoss >= 0 ? `Gain on disposal: ${money(gainLoss)}` : `Loss on disposal: ${money(-gainLoss)}`;
}
function closeDisposeModal() {
  disposeModal.classList.add("hidden");
  disposeModal.style.display = "none";
  currentDisposeAsset = null;
}
disposeCancel.addEventListener("click", closeDisposeModal);
disposeModal.addEventListener("click", (e) => { if (e.target === disposeModal) closeDisposeModal(); });

disposeSave.addEventListener("click", async () => {
  if (!currentDisposeAsset) return;
  const depositAccountId = disposeAccountSelect.value;
  const proceeds = parseFloat(disposeProceedsInput.value) || 0;
  const disposeDate = disposeDateInput.value;

  if (!depositAccountId) { disposeFormMessage.textContent = "Select where the proceeds go."; disposeFormMessage.dataset.tone = "error"; return; }

  const accumDep = depreciationTotals[currentDisposeAsset.id] || 0;
  const nbv = Number(currentDisposeAsset.purchase_cost) - accumDep;
  const gainLoss = proceeds - nbv;

  const assetAccount = findAccountByCode("1300");
  const accumDepAccount = findAccountByCode("1310");
  const gainAccount = findAccountByCode("4200");
  const lossAccount = findAccountByCode("5700");

  disposeFormMessage.textContent = "Saving…"; disposeFormMessage.dataset.tone = "info";

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: disposeDate, description: `Disposal: ${currentDisposeAsset.name}`, source_type: "asset_disposal",
  }]).select().single();
  if (entryError) { disposeFormMessage.textContent = "Failed: " + entryError.message; disposeFormMessage.dataset.tone = "error"; return; }

  const lines = [
    { account_id: depositAccountId, debit: proceeds, credit: 0 },
    { account_id: accumDepAccount.id, debit: accumDep, credit: 0 },
    { account_id: assetAccount.id, debit: 0, credit: currentDisposeAsset.purchase_cost },
  ].filter(l => l.debit > 0 || l.credit > 0);

  if (gainLoss > 0.01) lines.push({ account_id: gainAccount.id, debit: 0, credit: gainLoss });
  else if (gainLoss < -0.01) lines.push({ account_id: lossAccount.id, debit: -gainLoss, credit: 0 });

  const { error: linesError } = await supabase.from("journal_lines").insert(lines.map(l => ({ ...l, journal_entry_id: entry.id })));
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    disposeFormMessage.textContent = "Failed: " + linesError.message; disposeFormMessage.dataset.tone = "error";
    return;
  }

  await supabase.from("fixed_assets").update({ is_active: false, disposed_at: disposeDate, disposal_proceeds: proceeds }).eq("id", currentDisposeAsset.id);

  closeDisposeModal();
  loadAssets();
});

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("asset-date").value = new Date().toISOString().slice(0, 10);
  await loadAccounts();
  updatePaymentFieldVisibility();
  loadAssets();
});