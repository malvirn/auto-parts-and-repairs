import supabase from "./supabaseClient.js";

const shipmentForm = document.getElementById("shipment-form");
const shipmentFormMessage = document.getElementById("shipment-form-message");
const supplierSelect = document.getElementById("ship-supplier");
const paymentSelect = document.getElementById("ship-payment");
const paymentAccountField = document.getElementById("ship-payment-account-field");
const paymentAccountLabel = document.getElementById("ship-payment-account-label");
const paymentAccountSelect = document.getElementById("ship-payment-account");
const freightInput = document.getElementById("ship-freight");
const dutyInput = document.getElementById("ship-duty");
const insuranceInput = document.getElementById("ship-insurance");
const otherInput = document.getElementById("ship-other");
const linesContainer = document.getElementById("shipment-lines");
const addLineBtn = document.getElementById("add-shipment-line-btn");
const shipmentsTable = document.getElementById("shipments-table");

const shipmentModal = document.getElementById("shipment-modal");
const shipmentModalTitle = document.getElementById("shipment-modal-title");
const shipmentModalLines = document.getElementById("shipment-modal-lines");
const shipmentModalClose = document.getElementById("shipment-modal-close");

let suppliers = [];
let parts = [];
let accounts = [];
let markupRate = 0.15;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function findAccountByCode(code) { return accounts.find(a => a.code === code); }

// ---------- Load reference data ----------

async function loadReferenceData() {
  const [supRes, partsRes, acctRes, settingsRes] = await Promise.all([
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("parts").select("id, name, cost_price, quantity_in_stock").order("name"),
    supabase.from("accounts").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("settings").select("markup_rate").single(),
  ]);
  suppliers = supRes.data || [];
  parts = partsRes.data || [];
  accounts = acctRes.data || [];
  markupRate = settingsRes.data ? Number(settingsRes.data.markup_rate ?? 0.15) : 0.15;

  supplierSelect.innerHTML = `<option value="">Select supplier…</option>` + suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");

  const cashBankAccounts = accounts.filter(a => ["1000", "1010"].includes(a.code));
  paymentAccountSelect.innerHTML = `<option value="">Select account…</option>` + cashBankAccounts.map(a => `<option value="${a.id}">${escapeHtml(a.code)} — ${escapeHtml(a.name)}</option>`).join("");
}

function partOptions() {
  return parts.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (current stock: ${p.quantity_in_stock})</option>`).join("");
}

// ---------- Payment method toggle ----------

function updatePaymentFieldVisibility() {
  if (paymentSelect.value === "paid") {
    paymentAccountField.style.display = "";
    paymentAccountLabel.textContent = "Paid From";
    paymentAccountSelect.required = true;
  } else {
    paymentAccountField.style.display = "none";
    paymentAccountSelect.required = false;
  }
}
paymentSelect.addEventListener("change", updatePaymentFieldVisibility);

// ---------- Shipment lines ----------

function addShipmentLine() {
  const row = document.createElement("div");
  row.className = "shipment-line-row";
  row.innerHTML = `
    <select class="ship-line-part">${`<option value="">Select part…</option>${partOptions()}`}</select>
    <input type="number" class="ship-line-qty" min="1" placeholder="Qty" />
    <input type="number" class="ship-line-cost" step="0.01" min="0" placeholder="Supplier unit cost" />
    <span class="computed ship-line-allocated">—</span>
    <span class="computed ship-line-landed">—</span>
    <button type="button" class="btn remove-line-btn"><i data-lucide="x"></i></button>
  `;
  linesContainer.appendChild(row);
  if (window.lucide) lucide.createIcons();

  row.querySelectorAll(".ship-line-qty, .ship-line-cost").forEach(input => input.addEventListener("input", recalcAllocation));
  row.querySelector(".remove-line-btn").addEventListener("click", () => { row.remove(); recalcAllocation(); });
}
addLineBtn.addEventListener("click", addShipmentLine);
[freightInput, dutyInput, insuranceInput, otherInput].forEach(input => input.addEventListener("input", recalcAllocation));

// Pure function so the exact same math runs for the live preview and for
// what actually gets saved — no risk of the preview showing one number
// and the saved records showing another.
function computeAllocation(lines, extraCosts) {
  const totalInvoiceValue = lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
  const totalExtra = extraCosts.freight + extraCosts.duty + extraCosts.insurance + extraCosts.other;
  const computed = lines.map(l => {
    const lineValue = l.qty * l.unitCost;
    const share = totalInvoiceValue > 0 ? lineValue / totalInvoiceValue : 0;
    const allocatedExtra = share * totalExtra;
    const landedUnitCost = l.unitCost + (l.qty > 0 ? allocatedExtra / l.qty : 0);
    return { ...l, allocatedExtra, landedUnitCost };
  });
  return { totalInvoiceValue, totalExtra, totalLanded: totalInvoiceValue + totalExtra, lines: computed };
}

function readLinesFromForm() {
  return [...linesContainer.querySelectorAll(".shipment-line-row")].map(row => ({
    row,
    partId: row.querySelector(".ship-line-part").value,
    qty: parseInt(row.querySelector(".ship-line-qty").value) || 0,
    unitCost: parseFloat(row.querySelector(".ship-line-cost").value) || 0,
  }));
}

function recalcAllocation() {
  const rawLines = readLinesFromForm();
  const extraCosts = {
    freight: parseFloat(freightInput.value) || 0,
    duty: parseFloat(dutyInput.value) || 0,
    insurance: parseFloat(insuranceInput.value) || 0,
    other: parseFloat(otherInput.value) || 0,
  };
  const result = computeAllocation(rawLines, extraCosts);

  result.lines.forEach(l => {
    l.row.querySelector(".ship-line-allocated").textContent = `+${money(l.allocatedExtra)}`;
    l.row.querySelector(".ship-line-landed").textContent = money(l.landedUnitCost);
  });

  document.getElementById("summary-invoice-value").textContent = money(result.totalInvoiceValue);
  document.getElementById("summary-extra-costs").textContent = money(result.totalExtra);
  document.getElementById("summary-landed-cost").textContent = money(result.totalLanded);

  return result;
}

// ---------- Save shipment ----------

shipmentForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const supplierId = supplierSelect.value;
  const shipmentDate = document.getElementById("ship-date").value;
  const reference = document.getElementById("ship-reference").value.trim() || null;
  const paymentStatus = paymentSelect.value;
  const paymentAccountId = paymentAccountSelect.value;

  const rawLines = readLinesFromForm().filter(l => l.partId && l.qty > 0);
  if (!supplierId || rawLines.length === 0) {
    shipmentFormMessage.textContent = "Select a supplier and add at least one part with a quantity.";
    shipmentFormMessage.dataset.tone = "error";
    return;
  }
  if (paymentStatus === "paid" && !paymentAccountId) {
    shipmentFormMessage.textContent = "Select which account this was paid from.";
    shipmentFormMessage.dataset.tone = "error";
    return;
  }

  const extraCosts = {
    freight: parseFloat(freightInput.value) || 0,
    duty: parseFloat(dutyInput.value) || 0,
    insurance: parseFloat(insuranceInput.value) || 0,
    other: parseFloat(otherInput.value) || 0,
  };
  const result = computeAllocation(rawLines, extraCosts);

  shipmentFormMessage.textContent = "Saving…"; shipmentFormMessage.dataset.tone = "info";

  // 1. Shipment header
  const { data: shipment, error: shipmentError } = await supabase.from("purchase_shipments").insert([{
    supplier_id: supplierId, shipment_date: shipmentDate, reference,
    freight_cost: extraCosts.freight, duty_cost: extraCosts.duty, insurance_cost: extraCosts.insurance, other_cost: extraCosts.other,
    total_invoice_value: result.totalInvoiceValue, total_landed_cost: result.totalLanded, payment_status: paymentStatus,
  }]).select().single();
  if (shipmentError) { shipmentFormMessage.textContent = "Failed to save: " + shipmentError.message; shipmentFormMessage.dataset.tone = "error"; return; }

  // 2. Line items
  const { error: itemsError } = await supabase.from("purchase_shipment_items").insert(
    result.lines.map(l => ({
      shipment_id: shipment.id, part_id: l.partId, quantity: l.qty,
      supplier_unit_cost: l.unitCost, allocated_extra_cost: l.allocatedExtra, landed_unit_cost: l.landedUnitCost,
    }))
  );
  if (itemsError) {
    await supabase.from("purchase_shipments").delete().eq("id", shipment.id);
    shipmentFormMessage.textContent = "Failed to save line items: " + itemsError.message; shipmentFormMessage.dataset.tone = "error";
    return;
  }

  // 3. Update each part's cost, stock, and selling price + audit trail restock row
  for (const l of result.lines) {
    const part = parts.find(p => p.id === l.partId);
    const newStock = (part?.quantity_in_stock || 0) + l.qty;
    const newSellingPrice = Number((l.landedUnitCost * (1 + markupRate)).toFixed(2));
    await supabase.from("parts").update({ cost_price: l.landedUnitCost, quantity_in_stock: newStock, selling_price: newSellingPrice }).eq("id", l.partId);
    await supabase.from("restocks").insert([{ part_id: l.partId, supplier_id: supplierId, quantity: l.qty, unit_cost: l.landedUnitCost }]);
  }

  // 4. Post to the ledger: Debit Parts Inventory for the full landed cost;
  //    Credit either the cash/bank account paid from, or Accounts Payable
  //    if this is on credit.
  const inventoryAccount = findAccountByCode("1200");
  const apAccount = findAccountByCode("2000");
  if (!inventoryAccount || (paymentStatus === "on_credit" && !apAccount)) {
    shipmentFormMessage.textContent = "Shipment and stock were updated, but the Parts Inventory or Accounts Payable account is missing from your Chart of Accounts — post this manually in the Ledger.";
    shipmentFormMessage.dataset.tone = "error";
    resetShipmentForm();
    loadShipments();
    return;
  }

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: shipmentDate,
    reference,
    description: `Shipment from ${suppliers.find(s => s.id === supplierId)?.name || "supplier"}${reference ? " — " + reference : ""}`,
    source_type: "landed_cost",
  }]).select().single();

  if (!entryError) {
    const creditAccountId = paymentStatus === "paid" ? paymentAccountId : apAccount.id;
    const { error: linesError } = await supabase.from("journal_lines").insert([
      { journal_entry_id: entry.id, account_id: inventoryAccount.id, debit: result.totalLanded, credit: 0 },
      { journal_entry_id: entry.id, account_id: creditAccountId, debit: 0, credit: result.totalLanded },
    ]);

    if (!linesError) {
      await supabase.from("purchase_shipments").update({ journal_entry_id: entry.id }).eq("id", shipment.id);

      if (paymentStatus === "on_credit") {
        const dueDate = new Date(shipmentDate);
        dueDate.setDate(dueDate.getDate() + 30);
        const { data: payable } = await supabase.from("payables").insert([{
          supplier_id: supplierId, bill_number: reference, bill_date: shipmentDate,
          due_date: dueDate.toISOString().slice(0, 10), amount: result.totalLanded,
          description: "Purchase shipment (landed cost)", journal_entry_id: entry.id,
        }]).select().single();
        if (payable) await supabase.from("purchase_shipments").update({ payable_id: payable.id }).eq("id", shipment.id);
      }
    } else {
      await supabase.from("journal_entries").delete().eq("id", entry.id);
      console.error("Ledger posting failed for shipment:", linesError);
    }
  } else {
    console.error("Failed to create journal entry for shipment:", entryError);
  }

  shipmentFormMessage.textContent = `Shipment saved. Total landed cost ${money(result.totalLanded)} across ${result.lines.length} part(s).`;
  shipmentFormMessage.dataset.tone = "success";
  resetShipmentForm();
  await loadReferenceData(); // refresh part stock levels used in the line selects
  loadShipments();
});

function resetShipmentForm() {
  shipmentForm.reset();
  document.getElementById("ship-date").value = new Date().toISOString().slice(0, 10);
  linesContainer.innerHTML = "";
  addShipmentLine();
  updatePaymentFieldVisibility();
  recalcAllocation();
}

// ---------- Shipment history ----------

async function loadShipments() {
  const { data, error } = await supabase
    .from("purchase_shipments")
    .select("id, shipment_date, reference, total_invoice_value, total_landed_cost, suppliers(name)")
    .order("shipment_date", { ascending: false })
    .limit(50);

  if (error) {
    shipmentsTable.innerHTML = `<tr><td colspan="7" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}. If you're not logged in as an admin, this is expected.</td></tr>`;
    return;
  }

  shipmentsTable.innerHTML = (data || []).length ? data.map(s => `
    <tr>
      <td>${s.shipment_date}</td>
      <td>${escapeHtml(s.suppliers?.name || "—")}</td>
      <td>${escapeHtml(s.reference || "—")}</td>
      <td>${money(s.total_invoice_value)}</td>
      <td>${money(Number(s.total_landed_cost) - Number(s.total_invoice_value))}</td>
      <td>${money(s.total_landed_cost)}</td>
      <td><button type="button" class="btn view-shipment-btn" data-id="${s.id}"><i data-lucide="eye"></i> View</button></td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="empty-state">No shipments recorded yet</td></tr>`;

  if (window.lucide) lucide.createIcons();
  shipmentsTable.querySelectorAll(".view-shipment-btn").forEach(btn => btn.addEventListener("click", () => openShipmentModal(btn.dataset.id)));
}

async function openShipmentModal(id) {
  const { data, error } = await supabase
    .from("purchase_shipment_items")
    .select("quantity, supplier_unit_cost, allocated_extra_cost, landed_unit_cost, parts(name)")
    .eq("shipment_id", id);
  if (error) { alert("Couldn't load shipment details."); return; }

  shipmentModalTitle.textContent = "Shipment Line Items";
  shipmentModalLines.innerHTML = `
    <table>
      <thead><tr><th>Part</th><th>Qty</th><th>Supplier Cost</th><th>Allocated Extra</th><th>Landed Unit Cost</th></tr></thead>
      <tbody>
        ${data.map(l => `<tr><td>${escapeHtml(l.parts?.name || "—")}</td><td>${l.quantity}</td><td>${money(l.supplier_unit_cost)}</td><td>${money(l.allocated_extra_cost)}</td><td>${money(l.landed_unit_cost)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
  shipmentModal.classList.remove("hidden");
  shipmentModal.style.display = "flex";
}
shipmentModalClose.addEventListener("click", () => { shipmentModal.classList.add("hidden"); shipmentModal.style.display = "none"; });
shipmentModal.addEventListener("click", (e) => { if (e.target === shipmentModal) { shipmentModal.classList.add("hidden"); shipmentModal.style.display = "none"; } });

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("ship-date").value = new Date().toISOString().slice(0, 10);
  await loadReferenceData();
  addShipmentLine();
  updatePaymentFieldVisibility();
  loadShipments();
});