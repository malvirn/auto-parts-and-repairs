import supabase from "./supabaseClient.js";
import { getRate } from "./currency.js";
import { confirmTypedDelete, installBulkDelete } from "./bulk-delete.js";

const form = document.getElementById("part-form");
const tableBody = document.getElementById("parts-table");
installBulkDelete({
  tbody: tableBody,
  table: "parts",
  label: "part",
  getId: row => row.dataset.partId,
  foreignKeyMessage: "Parts may still be linked to purchasing history. Apply supabase/migrations/part-history-delete.sql to preserve purchase snapshots and allow safe deletion.",
});
const restocksTableBody = document.getElementById("restocks-table");
const partSuppliersList = document.getElementById("part-suppliers-list");
const PART_CATEGORIES = ["Suspension", "Body Parts", "Engine Parts", "Interior", "Auto Electrical Parts", "Air Bags", "Other"];

const editModal = document.getElementById("edit-part-modal");
const editName = document.getElementById("edit-part-name");
const editPartNumber = document.getElementById("edit-part-number");
const editDescription = document.getElementById("edit-part-description");
const editCategory = document.getElementById("edit-part-category");
const editQty = document.getElementById("edit-part-qty");
const editMinimumStock = document.getElementById("edit-part-minimum-stock");
const editCost = document.getElementById("edit-part-cost");
const editPrice = document.getElementById("edit-part-price");
const editVatRate = document.getElementById("edit-part-vat-rate");
const vatRate = document.getElementById("part-vat-rate");
const editSuppliersList = document.getElementById("edit-part-suppliers-list");
const editSaveBtn = document.getElementById("edit-part-save");
const editDeleteBtn = document.getElementById("edit-part-delete");
const editCancelBtn = document.getElementById("edit-part-cancel");
const restockModal = document.getElementById("restock-modal");
const restockPartName = document.getElementById("restock-part-name");
const restockSupplier = document.getElementById("restock-supplier");
const restockQuantity = document.getElementById("restock-quantity");
const restockUnitCost = document.getElementById("restock-unit-cost");
const restockPaymentStatus = document.getElementById("restock-payment-status");
const restockPaymentAccountField = document.getElementById("restock-payment-account-field");
const restockPaymentAccount = document.getElementById("restock-payment-account");
const restockMessage = document.getElementById("restock-message");
const restockSaveBtn = document.getElementById("restock-save");
const restockCancelBtn = document.getElementById("restock-cancel");
const partPurchaseSupplier = document.getElementById("part-purchase-supplier");
const partPaymentStatus = document.getElementById("part-payment-status");
const partPaymentAccountField = document.getElementById("part-payment-account-field");
const partPaymentAccount = document.getElementById("part-payment-account");
const totalUnitsEl = document.getElementById("shop-total-units");
const costValueEl = document.getElementById("shop-cost-value");
const retailValueEl = document.getElementById("shop-retail-value");
const unitsSoldEl = document.getElementById("shop-units-sold");
const salesValueEl = document.getElementById("shop-sales-value");

let currentEditId = null;
let currentRestockPart = null;
let allSuppliers = [];              // [{id, name}]
let purchaseAccounts = [];
let currentPartSuppliers = {};      // part_id -> [{id, name, is_preferred}]
let MARKUP_RATE = 0.15;
const VAT_RATE = 5;
let settingsRowId = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}
function sellingPriceFor(cost) {
  return (Math.max(0, Number(cost) || 0) * (1 + MARKUP_RATE) * (1 + VAT_RATE / 100)).toFixed(2);
}
function updateSellingPrice(costInput, priceInput) {
  if (costInput && priceInput) priceInput.value = sellingPriceFor(costInput.value);
}

// ---- Configurable markup ----
async function loadMarkupRate() {
  const { data, error } = await supabase.from("settings").select("id, markup_rate").single();
  if (!error && data) {
    MARKUP_RATE = Number(data.markup_rate ?? 0.15);
    settingsRowId = data.id;
  }
  document.getElementById("markup-rate-input").value = (MARKUP_RATE * 100).toFixed(1);
}

document.getElementById("save-markup-btn")?.addEventListener("click", async () => {
  const pct = parseFloat(document.getElementById("markup-rate-input").value);
  if (!Number.isFinite(pct) || pct < 0) { alert("Enter a valid percentage."); return; }
  MARKUP_RATE = pct / 100;
  if (settingsRowId) {
    const { error } = await supabase.from("settings").update({ markup_rate: MARKUP_RATE }).eq("id", settingsRowId);
    if (error) { alert("Failed to save markup rate: " + error.message); return; }
  }
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"));
  updateSellingPrice(editCost, editPrice);
  alert("Markup rate updated. New parts and edits use it from now on — use \"Apply to All Existing Parts\" if you also want it applied retroactively.");
});

document.getElementById("apply-markup-all-btn")?.addEventListener("click", async () => {
  if (!confirm(`Recalculate the selling price of every part at ${(MARKUP_RATE * 100).toFixed(1)}%? This overwrites any manually adjusted prices.`)) return;
  const { data: parts, error } = await supabase.from("parts").select("id, cost_price, vat_rate");
  if (error) { alert("Failed to load parts: " + error.message); return; }
  for (const p of parts || []) {
    const { error: updateError } = await supabase.from("parts").update({
      selling_price: Number(sellingPriceFor(p.cost_price)),
      vat_rate: VAT_RATE,
    }).eq("id", p.id);
    if (updateError) { alert(`Failed to update a part's price: ${updateError.message}`); return; }
  }
  alert("Selling prices updated.");
  await loadParts();
});

// ---- Multi-supplier checklist (a part can have more than one) ----
function buildSupplierChecklist(container, suppliers, checkedIds = [], preferredId = null) {
  if (!container) return;
  container.innerHTML = suppliers.map(s => `
    <div class="supplier-check-row" data-supplier-id="${s.id}">
      <input type="checkbox" class="supplier-check" ${checkedIds.includes(s.id) ? "checked" : ""} />
      <span style="flex:1;">${escapeHtml(s.name)}</span>
      <button type="button" class="star-btn ${preferredId === s.id ? "active" : ""}" title="Set as preferred supplier">★</button>
    </div>
  `).join("");

  container.querySelectorAll(".star-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".supplier-check-row");
      row.querySelector(".supplier-check").checked = true; // preferred implies linked
      container.querySelectorAll(".star-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

function readSupplierChecklist(container) {
  const rows = [...container.querySelectorAll(".supplier-check-row")];
  const checked = rows.filter(r => r.querySelector(".supplier-check").checked).map(r => r.dataset.supplierId);
  const preferredRow = rows.find(r => r.querySelector(".star-btn").classList.contains("active"));
  let preferredId = preferredRow ? preferredRow.dataset.supplierId : null;
  if (preferredId && !checked.includes(preferredId)) checked.push(preferredId);
  if (!preferredId && checked.length) preferredId = checked[0];
  return { supplierIds: checked, preferredId };
}

async function loadSuppliersIntoSelect() {
  const [{ data, error }, { data: accountData, error: accountError }] = await Promise.all([
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("accounts").select("id, code, name").eq("is_active", true).order("code"),
  ]);
  if (error) { console.error("Error loading suppliers:", error); return; }
  if (accountError) console.error("Error loading purchase payment accounts:", accountError);
  allSuppliers = data || [];
  purchaseAccounts = accountData || [];
  const options = allSuppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if (restockSupplier) restockSupplier.innerHTML = `<option value="">No supplier selected</option>${options}`;
  if (partPurchaseSupplier) partPurchaseSupplier.innerHTML = `<option value="">Select supplier…</option>${options}`;
  const paymentOptions = purchaseAccounts.filter(account => ["1000", "1010"].includes(account.code));
  if (restockPaymentAccount) restockPaymentAccount.innerHTML = `<option value="">Select cash or bank account…</option>${paymentOptions.map(account => `<option value="${account.id}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join("")}`;
  if (partPaymentAccount) partPaymentAccount.innerHTML = `<option value="">Select cash or bank account…</option>${paymentOptions.map(account => `<option value="${account.id}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join("")}`;
  buildSupplierChecklist(partSuppliersList, allSuppliers, [], null);
}

async function loadPartSuppliersMap() {
  const { data, error } = await supabase.from("part_suppliers").select("part_id, is_preferred, suppliers(id, name)");
  if (error) { console.error("Error loading part-supplier links:", error); return {}; }
  const map = {};
  (data || []).forEach(row => {
    if (!row.suppliers) return;
    if (!map[row.part_id]) map[row.part_id] = [];
    map[row.part_id].push({ id: row.suppliers.id, name: row.suppliers.name, is_preferred: row.is_preferred });
  });
  return map;
}

// ---- Load + render parts ----
let allPartsData = [];

async function loadParts() {
  const [{ data, error }, partSuppliersMap] = await Promise.all([
    supabase.from("parts").select("*").order("name"),
    loadPartSuppliersMap(),
  ]);
  currentPartSuppliers = partSuppliersMap;

  if (error) {
    console.error("Error loading parts:", error);
    tableBody.innerHTML = `<tr><td colspan="10" style="color:var(--danger)">Failed to load: ${error.message}</td></tr>`;
    return;
  }

  allPartsData = data || [];
  refreshCategoryFilter(allPartsData);
  renderStockSummary(allPartsData);
  renderLowStockAlert(allPartsData);
  applyPartsFilters();
}

function refreshCategoryFilter(parts) {
  const filter = document.getElementById("parts-category-filter");
  if (!filter) return;
  const selected = filter.value;
  const categories = [...new Set(parts.map(part => String(part.category || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  filter.innerHTML = `<option value="">All categories</option>${categories.map(category =>
    `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
  ).join("")}`;
  filter.value = categories.includes(selected) ? selected : "";
}

function renderPartsTable(data) {
  if (!data || data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="10" style="color:var(--text-muted)">${allPartsData.length ? "No parts match your search" : "No parts yet — add your first one above"}</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map(p => {
    const margin = p.selling_price - p.cost_price;
    const marginPct = p.cost_price > 0 ? ((margin / p.cost_price) * 100).toFixed(0) : "—";
    const alertLevel = Number(p.minimum_stock || 0) * 0.1;
    const isLowStock = alertLevel > 0 && Number(p.quantity_in_stock) <= alertLevel;
    const stockClass = isLowStock ? "stock-low" : "stock-ok";
    const linked = currentPartSuppliers[p.id] || [];
    const supplierChips = linked.length
      ? linked.map(l => `<span class="supplier-chip ${l.is_preferred ? "preferred" : ""}">${l.is_preferred ? "★ " : ""}${escapeHtml(l.name)}</span>`).join("")
      : `<span style="color:var(--text-muted);">—</span>`;
    return `
      <tr data-part-id="${escapeHtml(p.id)}">
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.part_number || "—")}</td>
        <td><div class="part-description">${escapeHtml(p.description || "—")}</div></td>
        <td>${escapeHtml(p.category || "—")}</td>
        <td>$${Number(p.cost_price).toFixed(2)}</td>
        <td>$${Number(p.selling_price).toFixed(2)}</td>
        <td><span class="margin-badge">+$${margin.toFixed(2)} (${marginPct}%)</span></td>
        <td class="${stockClass}">${p.quantity_in_stock}${alertLevel > 0 ? ` <small> / alert at ${Number.isInteger(alertLevel) ? alertLevel : alertLevel.toFixed(1)}</small>` : ""}</td>
        <td>${supplierChips}</td>
        <td><div class="part-row-actions"><button class="btn restock-part-btn" type="button" aria-label="Restock ${escapeHtml(p.name)}"><i data-lucide="package-plus"></i> Restock</button><button class="btn edit-part-btn" type="button" aria-label="Edit ${escapeHtml(p.name)}"><i data-lucide="pencil"></i></button><button class="btn part-delete-btn" type="button" aria-label="Delete ${escapeHtml(p.name)}"><i data-lucide="trash-2"></i> Delete</button></div></td>
      </tr>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();

  document.querySelectorAll(".edit-part-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const part = allPartsData.find(item => item.id === btn.closest("tr").dataset.partId);
      if (!part) return;
      openEditModal(part);
    });
  });
  document.querySelectorAll(".restock-part-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const part = allPartsData.find(item => item.id === btn.closest("tr").dataset.partId);
      if (part) openRestockModal(part);
    });
  });
  document.querySelectorAll(".part-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const part = allPartsData.find(item => item.id === btn.closest("tr").dataset.partId);
      if (part && await deletePart(part.id, part.name)) {
        await loadParts();
        await loadQuickSaleData();
      }
    });
  });
}

function applyPartsFilters() {
  const term = document.getElementById("parts-search")?.value.trim().toLowerCase() || "";
  const category = document.getElementById("parts-category-filter")?.value || "";
  const filtered = allPartsData.filter(part =>
    (!category || part.category === category) &&
    (!term || [part.part_number, part.name, part.description, part.category].some(value => String(value || "").toLowerCase().includes(term)))
  );
  renderPartsTable(filtered);
  const resultCount = document.getElementById("parts-filter-count");
  if (resultCount) {
    resultCount.textContent = term || category
      ? `Showing ${filtered.length} of ${allPartsData.length} parts`
      : `${allPartsData.length} parts in catalogue`;
  }
}
document.getElementById("parts-search")?.addEventListener("input", applyPartsFilters);
document.getElementById("parts-category-filter")?.addEventListener("change", applyPartsFilters);
document.getElementById("parts-clear-filters")?.addEventListener("click", () => {
  document.getElementById("parts-search").value = "";
  document.getElementById("parts-category-filter").value = "";
  applyPartsFilters();
});

async function renderStockSummary(parts) {
  const totals = parts.reduce((acc, part) => {
    const qty = Number(part.quantity_in_stock || 0);
    acc.units += qty;
    acc.cost += qty * Number(part.cost_price || 0);
    acc.retail += qty * Number(part.selling_price || 0);
    return acc;
  }, { units: 0, cost: 0, retail: 0 });

  if (totalUnitsEl) totalUnitsEl.textContent = totals.units.toLocaleString("en-US");
  if (costValueEl) costValueEl.textContent = formatMoney(totals.cost);
  if (retailValueEl) retailValueEl.textContent = formatMoney(totals.retail);

  const rate = await getRate();
  const costZigEl = document.getElementById("shop-cost-value-zig");
  const retailZigEl = document.getElementById("shop-retail-value-zig");
  if (costZigEl) costZigEl.textContent = `≈ ZiG ${(totals.cost * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (retailZigEl) retailZigEl.textContent = `≈ ZiG ${(totals.retail * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

async function loadSalesAnalysis() {
  const [repairParts, orderItems] = await Promise.all([
    supabase.from("job_parts").select("job_id, quantity, price_at_time, repair_jobs!inner(status)"),
    supabase.from("sales_order_items").select("quantity, total_usd, sales_orders!inner(status, repair_job_id)"),
  ]);
  const error = repairParts.error || orderItems.error;
  if (error) {
    console.error("Error loading Shop sales analysis:", error);
    if (unitsSoldEl) unitsSoldEl.textContent = "Unavailable";
    if (salesValueEl) salesValueEl.textContent = "Unavailable";
    return;
  }

  const completedStatuses = new Set(["Ready for Pickup", "Collected", "Unclaimed"]);
  const confirmedOrderItems = (orderItems.data || []).filter(row => row.sales_orders?.status === "Confirmed");
  const confirmedRepairJobs = new Set(confirmedOrderItems
    .map(row => row.sales_orders?.repair_job_id)
    .filter(Boolean));
  const soldRepairParts = (repairParts.data || []).filter(row =>
    completedStatuses.has(row.repair_jobs?.status) && !confirmedRepairJobs.has(row.job_id)
  );
  const unitsSold = [...soldRepairParts, ...confirmedOrderItems]
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const salesValue = soldRepairParts.reduce((sum, row) =>
    sum + Number(row.quantity || 0) * Number(row.price_at_time || 0), 0
  ) + confirmedOrderItems.reduce((sum, row) => sum + Number(row.total_usd || 0), 0);

  if (unitsSoldEl) unitsSoldEl.textContent = unitsSold.toLocaleString("en-US");
  if (salesValueEl) salesValueEl.textContent = formatMoney(salesValue);
  const salesValueZigEl = document.getElementById("shop-sales-value-zig");
  if (salesValueZigEl) {
    const rate = await getRate();
    salesValueZigEl.textContent = `≈ ZiG ${(salesValue * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
}

// ---- Alerts: low stock (with a best-effort browser notification) + best sellers ----
function renderLowStockAlert(parts) {
  const el = document.getElementById("low-stock-alert");
  if (!el) return;
  const lowStock = parts.filter(p => Number(p.minimum_stock || 0) > 0 && Number(p.quantity_in_stock || 0) <= Number(p.minimum_stock) * 0.1);
  el.innerHTML = lowStock.length
    ? lowStock.map(p => `<div class="alert-row"><span>${escapeHtml(p.name)}</span><strong class="stock-low">${p.quantity_in_stock} left</strong></div>`).join("")
    : `<span style="color:var(--text-muted); font-size:.85rem;">Stock levels are healthy.</span>`;

  // Best-effort only — this fires while the tab is open, it's not a true
  // push notification (that needs a service worker + push server, which is
  // a much bigger project than this page). The on-page list above is the
  // reliable part; this is just a bonus if the browser allows it.
  if (lowStock.length && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification("Low stock", { body: `${lowStock.length} part(s) at or below 10% of minimum: ${lowStock.map(p => p.name).join(", ")}` });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }
}

async function renderTopSellers() {
  const el = document.getElementById("top-sellers-alert");
  if (!el) return;
  const { data, error } = await supabase.from("job_parts").select("part_id, part_name, quantity");
  if (error) { console.error("Error loading sales history:", error); return; }

  const totals = {};
  (data || []).forEach(row => {
    if (!row.part_id) return;
    totals[row.part_id] = totals[row.part_id] || { name: row.part_name, qty: 0 };
    totals[row.part_id].qty += Number(row.quantity || 0);
  });
  const sorted = Object.values(totals).sort((a, b) => b.qty - a.qty).slice(0, 5);

  el.innerHTML = sorted.length
    ? sorted.map(s => `<div class="alert-row"><span>${escapeHtml(s.name)}</span><strong>${s.qty} sold</strong></div>`).join("")
    : `<span style="color:var(--text-muted); font-size:.85rem;">No sales recorded yet.</span>`;
}

async function loadRestocks() {
  if (!restocksTableBody) return;
  const { data, error } = await supabase
    .from("restocks")
    .select("id, quantity, unit_cost, restocked_at, part_name, invoice_number, payment_status, suppliers(id, name), payables(id)")
    .order("restocked_at", { ascending: false })
    .limit(50);
  if (error) {
    restocksTableBody.innerHTML = `<tr><td colspan="7" style="color:var(--danger)">Failed to load restocks: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  restocksTableBody.innerHTML = data?.length ? data.map(restock => `
    <tr id="restock-${restock.id}"><td>${escapeHtml(restock.parts?.name || restock.part_name || "—")}</td><td>${restock.suppliers?.id ? `<a href="suppliers.html#supplier-${encodeURIComponent(restock.suppliers.id)}">${escapeHtml(restock.suppliers.name)}</a>` : "No supplier"}</td><td>${restock.quantity}</td><td>$${Number(restock.unit_cost).toFixed(2)}</td><td>${restock.payables?.id ? `<a href="payables.html#payable-${encodeURIComponent(restock.payables.id)}">${escapeHtml(restock.invoice_number || "View bill")}</a>` : escapeHtml(restock.invoice_number || "—")}</td><td>${restock.payment_status === "on_credit" ? "On credit" : "Paid"}</td><td>${new Date(restock.restocked_at).toLocaleDateString()}</td></tr>
  `).join("") : `<tr><td colspan="7" style="color:var(--text-muted)">No restocks recorded yet</td></tr>`;
  const targetId = window.location.hash.match(/^#restock-(\d+)$/)?.[1];
  if (targetId) document.getElementById(`restock-${targetId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---- Restock modal ----
function openRestockModal(part) {
  currentRestockPart = part;
  restockPartName.textContent = part.name;
  restockQuantity.value = 1;
  restockUnitCost.value = Number(part.cost_price || 0).toFixed(2);
  const preferred = (currentPartSuppliers[part.id] || []).find(l => l.is_preferred);
  restockSupplier.value = preferred?.id || part.supplier_id || "";
  restockPaymentStatus.value = "paid";
  restockPaymentAccount.value = "";
  restockPaymentAccountField.hidden = false;
  restockMessage.textContent = "";
  restockMessage.dataset.tone = "";
  restockModal.classList.remove("hidden");
  restockModal.style.display = "flex";
}

function closeRestockModal() {
  restockModal.classList.add("hidden");
  restockModal.style.display = "none";
  currentRestockPart = null;
}

async function createShopPurchase({ part, quantity, unitCost, supplierId, paymentStatus, cashAccountId, purchaseDate }) {
  const totalCost = quantity * unitCost;
  const inventoryAccount = purchaseAccounts.find(account => account.code === "1200");
  const payableAccount = purchaseAccounts.find(account => account.code === "2000");
  if (!supplierId) return { error: new Error("Select the supplier for this stock purchase.") };
  if (!Number.isFinite(totalCost) || totalCost <= 0) return { error: new Error("The stock purchase total must be greater than zero.") };
  if (!inventoryAccount) return { error: new Error("Parts Inventory account (code 1200) is missing from the Chart of Accounts.") };
  if (paymentStatus === "paid" && !cashAccountId) return { error: new Error("Select the cash or bank account used to pay this supplier.") };
  if (paymentStatus === "on_credit" && !payableAccount) return { error: new Error("Accounts Payable account (code 2000) is missing from the Chart of Accounts.") };

  const { data: restock, error: restockError } = await supabase.from("restocks").insert([{
    part_id: part.id,
    part_name: part.name,
    supplier_id: supplierId,
    quantity,
    unit_cost: unitCost,
    payment_status: paymentStatus,
  }]).select("id").single();
  if (restockError) return { error: restockError };

  const invoiceNumber = `SHOP-${new Date(purchaseDate).getFullYear()}-${String(restock.id).padStart(6, "0")}`;
  const { error: invoiceError } = await supabase.from("restocks").update({ invoice_number: invoiceNumber }).eq("id", restock.id);
  if (invoiceError) {
    await supabase.from("restocks").delete().eq("id", restock.id);
    return { error: invoiceError };
  }

  const supplierName = allSuppliers.find(supplier => supplier.id === supplierId)?.name || "Supplier";
  const { data: journalEntry, error: journalError } = await supabase.from("journal_entries").insert([{
    entry_date: purchaseDate,
    reference: invoiceNumber,
    description: `Shop stock purchase from ${supplierName}: ${part.name} × ${quantity}`,
    source_type: "shop_restock",
  }]).select("id").single();
  if (journalError) {
    await supabase.from("restocks").delete().eq("id", restock.id);
    return { error: journalError };
  }
  const { error: linkError } = await supabase.from("restocks").update({ journal_entry_id: journalEntry.id }).eq("id", restock.id);
  if (linkError) {
    await supabase.from("journal_entries").delete().eq("id", journalEntry.id);
    await supabase.from("restocks").delete().eq("id", restock.id);
    return { error: linkError };
  }

  const { error: lineError } = await supabase.from("journal_lines").insert([
    { journal_entry_id: journalEntry.id, account_id: inventoryAccount.id, debit: totalCost, credit: 0 },
    { journal_entry_id: journalEntry.id, account_id: paymentStatus === "paid" ? cashAccountId : payableAccount.id, debit: 0, credit: totalCost },
  ]);
  if (lineError) {
    await supabase.from("journal_entries").delete().eq("id", journalEntry.id);
    await supabase.from("restocks").delete().eq("id", restock.id);
    return { error: lineError };
  }

  if (paymentStatus === "on_credit") {
    const supplier = allSuppliers.find(item => item.id === supplierId);
    const { data: supplierTerms } = await supabase.from("suppliers").select("payment_terms_days").eq("id", supplierId).maybeSingle();
    const dueDate = new Date(`${purchaseDate}T00:00:00Z`);
    dueDate.setUTCDate(dueDate.getUTCDate() + Number(supplierTerms?.payment_terms_days ?? 30));
    const { error: payableError } = await supabase.from("payables").insert([{
      supplier_id: supplierId,
      bill_number: invoiceNumber,
      bill_date: purchaseDate,
      due_date: dueDate.toISOString().slice(0, 10),
      amount: totalCost,
      description: `Shop stock: ${part.name} × ${quantity} @ ${formatMoney(unitCost)}`,
      journal_entry_id: journalEntry.id,
      restock_id: restock.id,
    }]);
    if (payableError) {
      await supabase.from("journal_entries").delete().eq("id", journalEntry.id);
      await supabase.from("restocks").delete().eq("id", restock.id);
      return { error: payableError };
    }
  }

  return { restock, invoiceNumber };
}

async function rollbackShopPurchase(restockId) {
  const { data: restock } = await supabase.from("restocks").select("invoice_number, journal_entry_id").eq("id", restockId).maybeSingle();
  const { data: payable } = await supabase.from("payables").select("id").eq("restock_id", restockId).maybeSingle();
  if (payable?.id) await supabase.from("payables").delete().eq("id", payable.id);
  if (restock?.journal_entry_id) await supabase.from("journal_entries").delete().eq("id", restock.journal_entry_id);
  else if (restock?.invoice_number) {
    const { data: entry } = await supabase.from("journal_entries").select("id").eq("reference", restock.invoice_number).maybeSingle();
    if (entry?.id) await supabase.from("journal_entries").delete().eq("id", entry.id);
  }
  await supabase.from("restocks").delete().eq("id", restockId);
}

restockCancelBtn?.addEventListener("click", closeRestockModal);
restockModal?.addEventListener("click", event => { if (event.target === restockModal) closeRestockModal(); });

restockPaymentStatus?.addEventListener("change", () => {
  const paidNow = restockPaymentStatus.value === "paid";
  restockPaymentAccountField.hidden = !paidNow;
  restockPaymentAccount.required = paidNow;
});

restockSaveBtn?.addEventListener("click", async () => {
  if (!currentRestockPart) return;
  const quantity = parseInt(restockQuantity.value, 10);
  const unitCost = parseFloat(restockUnitCost.value);
  const supplierId = restockSupplier.value;
  const paymentStatus = restockPaymentStatus.value;
  const cashAccountId = restockPaymentAccount.value;
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitCost) || unitCost < 0) {
    alert("Enter a valid quantity and unit cost.");
    return;
  }

  restockSaveBtn.disabled = true;
  restockMessage.textContent = "Recording stock purchase…";
  restockMessage.dataset.tone = "info";

  const purchase = await createShopPurchase({
    part: currentRestockPart, quantity, unitCost, supplierId, paymentStatus,
    cashAccountId, purchaseDate: new Date().toISOString().slice(0, 10),
  });
  if (purchase.error) {
    restockSaveBtn.disabled = false;
    restockMessage.textContent = `Failed to record purchase: ${purchase.error.message}`;
    restockMessage.dataset.tone = "error";
    return;
  }

  // Existing stock PLUS the restocked quantity — never overwritten.
  const { error: partError } = await supabase.from("parts").update({
    quantity_in_stock: Number(currentRestockPart.quantity_in_stock || 0) + quantity,
    cost_price: unitCost,
    selling_price: Number(sellingPriceFor(unitCost)),
    vat_rate: VAT_RATE,
  }).eq("id", currentRestockPart.id);
  if (partError) {
    await rollbackShopPurchase(purchase.restock.id);
    restockSaveBtn.disabled = false;
    restockMessage.textContent = "Purchase failed and was rolled back: " + partError.message;
    restockMessage.dataset.tone = "error";
    return;
  }

  closeRestockModal();
  await loadParts();
  await loadRestocks();
});

// ---- Edit modal ----
function openEditModal(part) {
  if (!editModal) return;
  currentEditId = part.id;
  editName.value = part.name;
  editPartNumber.value = part.part_number || "";
  editDescription.value = part.description || "";
  editCategory.value = PART_CATEGORIES.includes(part.category) ? part.category : "Other";
  editQty.value = part.quantity_in_stock;
  editMinimumStock.value = part.minimum_stock || 0;
  editCost.value = part.cost_price;
  editVatRate.value = "5";
  updateSellingPrice(editCost, editPrice);

  const linked = currentPartSuppliers[part.id] || [];
  const preferredId = linked.find(l => l.is_preferred)?.id || part.supplier_id || null;
  buildSupplierChecklist(editSuppliersList, allSuppliers, linked.map(l => l.id), preferredId);

  editModal.classList.remove("hidden");
  editModal.style.display = "flex";
}

function closeEditModal() {
  if (!editModal) return;
  editModal.classList.add("hidden");
  editModal.style.display = "none";
  currentEditId = null;
}

if (editCancelBtn) editCancelBtn.addEventListener("click", (e) => { e.preventDefault(); closeEditModal(); });
if (editModal) editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });

document.getElementById("part-cost")?.addEventListener("input", () => {
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"));
});
vatRate?.addEventListener("change", () => updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price")));
editCost?.addEventListener("input", () => updateSellingPrice(editCost, editPrice));
editVatRate?.addEventListener("change", () => updateSellingPrice(editCost, editPrice));

if (editSaveBtn) editSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentEditId) return;
  const { supplierIds, preferredId } = readSupplierChecklist(editSuppliersList);

  const { data: updatedRows, error } = await supabase.from("parts").update({
    name: editName.value.trim(),
    part_number: editPartNumber.value.trim() || null,
    description: editDescription.value.trim() || null,
    category: editCategory.value,
    quantity_in_stock: parseInt(editQty.value) || 0,
    minimum_stock: Number(editMinimumStock.value) || 0,
    cost_price: parseFloat(editCost.value) || 0,
    selling_price: Number(editPrice.value),
    vat_rate: 5,
    supplier_id: preferredId || null,
  }).eq("id", currentEditId).select();

  if (error) { alert("Failed to update part: " + error.message); return; }
  if (!updatedRows || updatedRows.length === 0) {
    alert("No part was updated — it may have been deleted. Refreshing the list.");
    closeEditModal();
    await loadParts();
    return;
  }

  await supabase.from("part_suppliers").delete().eq("part_id", currentEditId);
  if (supplierIds.length) {
    const rows = supplierIds.map(sid => ({ part_id: currentEditId, supplier_id: sid, is_preferred: sid === preferredId }));
    const { error: linkError } = await supabase.from("part_suppliers").insert(rows);
    if (linkError) console.error("Error linking suppliers:", linkError);
  }

  closeEditModal();
  loadParts();
});

async function deletePart(partId, partName) {
  if (!(await confirmTypedDelete(`"${partName}"`))) return false;
  const { data, error } = await supabase.from("parts").delete().eq("id", partId).select("id").maybeSingle();
  if (error) {
    alert(error.code === "23503"
      ? "Failed to delete part because purchasing history still references it. Apply supabase/migrations/part-history-delete.sql first; it keeps historical purchase records and their part names."
      : "Failed to delete part: " + error.message);
    return false;
  }
  if (!data) {
    alert("No part was deleted. It may already have been removed or you may not have permission.");
    return false;
  }
  return true;
}

if (editDeleteBtn) editDeleteBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentEditId) return;
  const partId = currentEditId;
  const part = allPartsData.find(item => item.id === partId);
  if (!await deletePart(partId, part?.name || "this part")) return;
  closeEditModal();
  await loadParts();
  await loadQuickSaleData();
});

if (form) form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const quantity = parseInt(document.getElementById("part-qty").value, 10) || 0;
  const unitCost = parseFloat(document.getElementById("part-cost").value) || 0;
  const supplierId = partPurchaseSupplier.value;
  const paymentStatus = partPaymentStatus.value;
  const cashAccountId = partPaymentAccount.value;
  if (quantity > 0 && !supplierId) { alert("Select the supplier for the opening stock purchase."); return; }
  if (quantity > 0 && paymentStatus === "paid" && !cashAccountId) { alert("Select the cash or bank account used to pay for opening stock."); return; }
  if (quantity > 0 && !purchaseAccounts.find(account => account.code === "1200")) { alert("Parts Inventory account (code 1200) is missing from the Chart of Accounts."); return; }
  if (quantity > 0 && paymentStatus === "on_credit" && !purchaseAccounts.find(account => account.code === "2000")) { alert("Accounts Payable account (code 2000) is missing from the Chart of Accounts."); return; }
  const { supplierIds, preferredId } = readSupplierChecklist(partSuppliersList);
  const { data: newPart, error } = await supabase.from("parts").insert([{
    name: document.getElementById("part-name").value.trim(),
    part_number: document.getElementById("part-number").value.trim() || null,
    description: document.getElementById("part-description").value.trim() || null,
    category: document.getElementById("part-category").value,
    quantity_in_stock: parseInt(document.getElementById("part-qty").value) || 0,
    minimum_stock: Number(document.getElementById("part-minimum-stock").value) || 0,
    cost_price: parseFloat(document.getElementById("part-cost").value) || 0,
    selling_price: Number(sellingPriceFor(document.getElementById("part-cost").value)),
    vat_rate: VAT_RATE,
    supplier_id: preferredId || null,
  }]).select("id").single();

  if (error) { alert("Failed to add part: " + error.message); return; }

  if (quantity > 0) {
    const purchase = await createShopPurchase({
      part: { id: newPart.id, name: document.getElementById("part-name").value.trim() },
      quantity, unitCost, supplierId, paymentStatus, cashAccountId,
      purchaseDate: new Date().toISOString().slice(0, 10),
    });
    if (purchase.error) {
      await supabase.from("parts").delete().eq("id", newPart.id);
      alert(`Part was not added because its opening stock purchase failed: ${purchase.error.message}`);
      return;
    }
  }

  if (supplierIds.length) {
    const rows = supplierIds.map(sid => ({ part_id: newPart.id, supplier_id: sid, is_preferred: sid === preferredId }));
    const { error: linkError } = await supabase.from("part_suppliers").insert(rows);
    if (linkError) console.error("Error linking suppliers:", linkError);
  }

  form.reset();
  vatRate.value = "5";
  partPaymentStatus.value = "paid";
  partPaymentAccountField.hidden = false;
  partPaymentAccount.required = true;
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"));
  buildSupplierChecklist(partSuppliersList, allSuppliers, [], null);
  await loadParts();
  await loadRestocks();
  await loadQuickSaleData();
});

// ---- Quick Sale: a walk-in counter sale, reusing the same
// sales_orders/sales_order_items/receipts infrastructure as the full
// Quotations flow — just reached through one fast form instead of the
// draft → amend → confirm sequence. This is also where stock actually
// gets deducted for a sale, which the regular Sales Order confirmation
// flow currently does NOT do (a pre-existing gap, fixed here for this
// path at least). ----
let quickSaleParts = [];
let quickSaleSalespeople = [];

async function loadQuickSaleData() {
  const [{ data: partsData }, { data: peopleData }] = await Promise.all([
    supabase.from("parts").select("id, name, selling_price, quantity_in_stock").order("name"),
    supabase.from("technician_directory").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  quickSaleParts = partsData || [];
  quickSaleSalespeople = peopleData || [];

  const partSelect = document.getElementById("quick-sale-part");
  if (partSelect) {
    partSelect.innerHTML = quickSaleParts.map(p =>
      `<option value="${p.id}" data-price="${p.selling_price}" data-stock="${p.quantity_in_stock}" ${Number(p.quantity_in_stock) < 1 ? "disabled" : ""}>${escapeHtml(p.name)} — ${formatMoney(p.selling_price)} (${p.quantity_in_stock} in stock)</option>`
    ).join("");
  }
  const salespersonSelect = document.getElementById("quick-sale-salesperson");
  if (salespersonSelect) {
    salespersonSelect.innerHTML = `<option value="">No salesperson — no commission</option>` + quickSaleSalespeople.map(s => `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`).join("");
  }
}

function updateQuickSaleTotal() {
  const partSelect = document.getElementById("quick-sale-part");
  const opt = partSelect?.options[partSelect.selectedIndex];
  const price = parseFloat(opt?.dataset.price || 0);
  const qty = parseInt(document.getElementById("quick-sale-qty")?.value) || 0;
  const totalEl = document.getElementById("quick-sale-total");
  if (totalEl) totalEl.textContent = `Total: ${formatMoney(price * qty)}`;
}
document.getElementById("quick-sale-part")?.addEventListener("change", updateQuickSaleTotal);
document.getElementById("quick-sale-qty")?.addEventListener("input", updateQuickSaleTotal);

document.getElementById("quick-sale-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = document.getElementById("quick-sale-message");
  const partSelect = document.getElementById("quick-sale-part");
  const partId = partSelect.value;
  const opt = partSelect.options[partSelect.selectedIndex];
  const price = parseFloat(opt?.dataset.price || 0);
  const stock = parseInt(opt?.dataset.stock || 0);
  const qty = parseInt(document.getElementById("quick-sale-qty").value) || 0;
  const salespersonId = document.getElementById("quick-sale-salesperson").value || null;
  const customerName = document.getElementById("quick-sale-customer").value.trim() || "Walk-in Sale";
  const partName = opt?.textContent.split(" — ")[0].trim();

  if (!partId || qty < 1) { message.textContent = "Select a part and a valid quantity."; message.dataset.tone = "error"; return; }
  if (qty > stock) { message.textContent = `Only ${stock} in stock — can't sell ${qty}.`; message.dataset.tone = "error"; return; }

  message.textContent = "Processing…"; message.dataset.tone = "info";
  const rate = await getRate();
  const total = qty * price;

  const { data: order, error: orderError } = await supabase.from("sales_orders").insert([{
    walk_in_name: customerName, usd_to_zig_rate: rate, total_usd: total, total_zig: total * rate,
    status: "Confirmed", salesperson_id: salespersonId,
  }]).select().single();
  if (orderError) { message.textContent = "Failed: " + orderError.message; message.dataset.tone = "error"; return; }

  const { error: itemError } = await supabase.from("sales_order_items").insert([{
    sales_order_id: order.id, part_id: partId, part_name: partName, quantity: qty,
    unit_price_usd: price, total_usd: total, unit_price_zig: price * rate, total_zig: total * rate,
  }]);
  if (itemError) {
    await supabase.from("sales_orders").delete().eq("id", order.id);
    message.textContent = "Failed: " + itemError.message; message.dataset.tone = "error";
    return;
  }

  // The actual stock deduction — this is the part the regular Sales
  // Order confirmation flow is currently missing entirely.
  const { error: stockError } = await supabase.from("parts").update({ quantity_in_stock: stock - qty }).eq("id", partId);
  if (stockError) console.error("Sale recorded, but stock deduction failed:", stockError);

  const { error: receiptError } = await supabase.from("receipts").insert([{ sales_order_id: order.id, amount: total }]);
  if (receiptError) console.error("Sale recorded, but receipt creation failed:", receiptError);

  document.getElementById("quick-sale-form").reset();
  document.getElementById("quick-sale-total").textContent = "";
  message.innerHTML = `Sale complete — ${formatMoney(total)}${salespersonId ? " · commission will show after the next Generate Commissions scan" : ""}. <a href="receipts.html?order=${encodeURIComponent(order.id)}" target="_blank" style="text-decoration:underline;">View / Print Receipt</a>`;
  message.dataset.tone = "success";
  await loadQuickSaleData();
  await loadParts();
  await loadSalesAnalysis();
});

// ---- Smart Reorder Suggestions ----
// Weighs total historical usage (from both repair jobs AND direct sales)
// against current stock, rather than the flat "below 3 units" rule the
// Low Stock alert uses. Uses Gemini to turn the raw numbers into a
// prioritized, readable writeup — the actual ranking/math happens here
// in plain JS first, so the AI is explaining real numbers, not inventing
// its own analysis from scratch.
document.getElementById("reorder-suggest-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("reorder-suggest-btn");
  const resultEl = document.getElementById("reorder-suggest-result");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-circle"></i> Analyzing…`;
  if (window.lucide) lucide.createIcons();

  try {
    const [{ data: currentParts }, { data: jobPartsUsage }, { data: saleItemsUsage }] = await Promise.all([
      supabase.from("parts").select("id, name, quantity_in_stock"),
      supabase.from("job_parts").select("part_id, quantity"),
      supabase.from("sales_order_items").select("part_id, quantity"),
    ]);

    const usageByPartId = {};
    (jobPartsUsage || []).forEach(row => { if (row.part_id) usageByPartId[row.part_id] = (usageByPartId[row.part_id] || 0) + Number(row.quantity || 0); });
    (saleItemsUsage || []).forEach(row => { if (row.part_id) usageByPartId[row.part_id] = (usageByPartId[row.part_id] || 0) + Number(row.quantity || 0); });

    const candidates = (currentParts || [])
      .map(p => {
        const usage = usageByPartId[p.id] || 0;
        const stock = Number(p.quantity_in_stock || 0);
        return { name: p.name, usage, stock, priority: usage / Math.max(stock, 1) };
      })
      .filter(c => c.usage > 0)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 10);

    if (!candidates.length) {
      resultEl.textContent = "Not enough sales/usage history yet to make a meaningful suggestion.";
      resultEl.style.display = "block";
      return;
    }

    const prompt = candidates.map(c => `${c.name}: ${c.usage} used historically, ${c.stock} currently in stock`).join("\n");

    const { data, error } = await supabase.functions.invoke("ai-assist", {
      body: {
        provider: "gemini",
        systemPrompt: "You help an auto parts shop owner decide what to reorder. You're given each part's total historical usage (from repairs and sales combined) and its current stock level, already sorted by urgency (highest usage-relative-to-stock first). Write a short, prioritized list of what to reorder and roughly how much, in plain language — a few sentences or a short list, not a table. Focus on the parts where usage is high relative to what's left. If a part shows high usage but healthy stock, it's fine to not mention it at all.",
        prompt: `Parts ranked by reorder urgency (most urgent first):\n${prompt}`,
      },
    });
    if (error) throw error;
    if (!data?.text) throw new Error(data?.error || "No suggestion returned.");
    resultEl.textContent = data.text;
    resultEl.style.display = "block";
  } catch (err) {
    console.error("Reorder suggestion failed:", err);
    resultEl.textContent = "Couldn't generate suggestions: " + err.message;
    resultEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    if (window.lucide) lucide.createIcons();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadMarkupRate();
  await loadSuppliersIntoSelect();
  await loadParts();
  loadRestocks();
  renderTopSellers();
  loadQuickSaleData();
  loadSalesAnalysis();
});
partPaymentStatus?.addEventListener("change", () => {
  const paidNow = partPaymentStatus.value === "paid";
  partPaymentAccountField.hidden = !paidNow;
  partPaymentAccount.required = paidNow;
});