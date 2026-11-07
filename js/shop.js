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
const editSaveBtn = document.getElementById("edit-part-save");
const editDeleteBtn = document.getElementById("edit-part-delete");
const editCancelBtn = document.getElementById("edit-part-cancel");
const restockModal = document.getElementById("restock-modal");
const restockPartName = document.getElementById("restock-part-name");
const restockSupplier = document.getElementById("restock-supplier");
const restockSupplierEmail = document.getElementById("restock-supplier-email");
const restockQuantity = document.getElementById("restock-quantity");
const restockUnitCost = document.getElementById("restock-unit-cost");
const restockPaymentStatus = document.getElementById("restock-payment-status");
const restockPaymentAccountField = document.getElementById("restock-payment-account-field");
const restockPaymentAccount = document.getElementById("restock-payment-account");
const restockMessage = document.getElementById("restock-message");
const restockSaveBtn = document.getElementById("restock-save");
const restockCancelBtn = document.getElementById("restock-cancel");
const restockEmailOrderBtn = document.getElementById("restock-email-order");
const purchasePrintModal = document.getElementById("purchase-print-modal");
const purchasePrintSummary = document.getElementById("purchase-print-summary");
const purchasePrintType = document.getElementById("purchase-print-type");
const totalUnitsEl = document.getElementById("shop-total-units");
const costValueEl = document.getElementById("shop-cost-value");
const retailValueEl = document.getElementById("shop-retail-value");
const unitsSoldEl = document.getElementById("shop-units-sold");
const salesValueEl = document.getElementById("shop-sales-value");

let currentEditId = null;
let currentRestockPart = null;
let restockSubmissionInProgress = false;
let partSubmissionInProgress = false;
let completedPurchase = null;
let allSuppliers = [];              // [{id, name}]
let purchaseAccounts = [];
let currentPartSuppliers = {};      // part_id -> [{id, name, is_preferred}]
let MARKUP_RATE = 0.15;
const DEFAULT_VAT_RATE = 5;
let settingsRowId = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
function sellingPriceFor(cost, markupRate = MARKUP_RATE, vatRate = DEFAULT_VAT_RATE) {
  return (Math.max(0, Number(cost) || 0) * (1 + markupRate) * (1 + vatRate / 100)).toFixed(2);
}
function updateSellingPrice(costInput, priceInput, markupInput, vatInput) {
  if (costInput && priceInput) {
    const markupPercent = markupInput?.value === "" || !markupInput ? MARKUP_RATE * 100 : Number(markupInput.value);
    priceInput.value = sellingPriceFor(
      costInput.value,
      (Number.isFinite(markupPercent) ? markupPercent : MARKUP_RATE * 100) / 100,
      Number(vatInput?.value || DEFAULT_VAT_RATE),
    );
  }
}
function updateMarkupFromPrice(costInput, priceInput, markupInput, vatInput) {
  const cost = Number(costInput?.value);
  const price = Number(priceInput?.value);
  if (!markupInput || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(price)) return;
  const vat = Number(vatInput?.value || DEFAULT_VAT_RATE);
  markupInput.value = ((price / (cost * (1 + vat / 100)) - 1) * 100).toFixed(1);
}

// ---- Configurable markup ----
async function loadMarkupRate() {
  const { data, error } = await supabase.from("settings").select("id, markup_rate").single();
  if (!error && data) {
    MARKUP_RATE = Number(data.markup_rate ?? 0.15);
    settingsRowId = data.id;
  }
  document.getElementById("markup-rate-input").value = (MARKUP_RATE * 100).toFixed(1);
  document.getElementById("part-markup-rate").value = (MARKUP_RATE * 100).toFixed(1);
}

document.getElementById("save-markup-btn")?.addEventListener("click", async () => {
  const pct = parseFloat(document.getElementById("markup-rate-input").value);
  if (!Number.isFinite(pct) || pct < 0) { alert("Enter a valid percentage."); return; }
  MARKUP_RATE = pct / 100;
  if (settingsRowId) {
    const { error } = await supabase.from("settings").update({ markup_rate: MARKUP_RATE }).eq("id", settingsRowId);
    if (error) { alert("Failed to save markup rate: " + error.message); return; }
  }
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"), document.getElementById("part-markup-rate"), vatRate);
  updateSellingPrice(editCost, editPrice, document.getElementById("edit-part-markup-rate"), editVatRate);
  window.aprToast?.("Markup rate updated", "success", "New parts and edits will use this rate. Use Apply to All Existing Parts to update existing prices.");
});

document.getElementById("apply-markup-all-btn")?.addEventListener("click", async () => {
  if (!await window.aprConfirm(`Recalculate the selling price of every part at ${(MARKUP_RATE * 100).toFixed(1)}%? This overwrites any manually adjusted prices.`, { title: "Apply markup to all parts", confirmLabel: "Update all prices", danger: true })) return;
  const { data: parts, error } = await supabase.from("parts").select("id, cost_price, vat_rate");
  if (error) { alert("Failed to load parts: " + error.message); return; }
  for (const p of parts || []) {
    const { error: updateError } = await supabase.from("parts").update({
      selling_price: Number(sellingPriceFor(p.cost_price)),
      vat_rate: DEFAULT_VAT_RATE,
    }).eq("id", p.id);
    if (updateError) { alert(`Failed to update a part's price: ${updateError.message}`); return; }
  }
  window.aprToast?.("Selling prices updated", "success");
  await loadParts();
});

async function loadSuppliersIntoSelect() {
  const [{ data, error }, { data: accountData, error: accountError }] = await Promise.all([
    supabase.from("suppliers").select("id, name, email").order("name"),
    supabase.from("accounts").select("id, code, name").eq("is_active", true).order("code"),
  ]);
  if (error) { console.error("Error loading suppliers:", error); return; }
  if (accountError) console.error("Error loading purchase payment accounts:", accountError);
  allSuppliers = data || [];
  purchaseAccounts = accountData || [];
  if (restockSupplier) document.getElementById("restock-supplier-options").innerHTML = allSuppliers.map(s => `<option value="${escapeHtml(s.name)}"></option>`).join("");
  const paymentOptions = purchaseAccounts.filter(account => ["1000", "1010"].includes(account.code));
  if (restockPaymentAccount) restockPaymentAccount.innerHTML = `<option value="">Select cash or bank account…</option>${paymentOptions.map(account => `<option value="${account.id}">${escapeHtml(account.code)} — ${escapeHtml(account.name)}</option>`).join("")}`;
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
  restocksTableBody.innerHTML = data?.length ? data.map(restock => {
    const date = new Date(restock.restocked_at);
    const dateLabel = Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const onCredit = restock.payment_status === "on_credit";
    return `
      <tr id="restock-${restock.id}">
        <td><strong>${escapeHtml(restock.part_name || "Unnamed part")}</strong></td>
        <td>${restock.suppliers?.id ? `<a href="suppliers.html#supplier-${encodeURIComponent(restock.suppliers.id)}">${escapeHtml(restock.suppliers.name)}</a>` : "No supplier"}</td>
        <td><span class="restock-quantity">+${Number(restock.quantity || 0)}</span></td>
        <td><strong>$${Number(restock.unit_cost || 0).toFixed(2)}</strong></td>
        <td>${restock.payables?.id ? `<a href="payables.html#payable-${encodeURIComponent(restock.payables.id)}">${escapeHtml(restock.invoice_number || "View bill")}</a>` : escapeHtml(restock.invoice_number || "—")}</td>
        <td><span class="restock-payment ${onCredit ? "credit" : "paid"}"><i data-lucide="${onCredit ? "clock-3" : "circle-check"}"></i>${onCredit ? "On credit" : "Paid"}</span></td>
        <td><time class="restock-date" datetime="${escapeHtml(restock.restocked_at || "")}">${dateLabel}</time></td>
      </tr>`;
  }).join("") : `<tr><td colspan="7" style="color:var(--text-muted)">No restocks recorded yet</td></tr>`;
  if (window.lucide) lucide.createIcons();
  const targetId = window.location.hash.match(/^#restock-(\d+)$/)?.[1];
  if (targetId) document.getElementById(`restock-${targetId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---- Restock modal ----
function openRestockModal(part) {
  currentRestockPart = part;
  restockSaveBtn.disabled = false;
  restockPartName.textContent = part.name;
  restockQuantity.value = 1;
  restockUnitCost.value = Number(part.cost_price || 0).toFixed(2);
  const preferred = (currentPartSuppliers[part.id] || []).find(l => l.is_preferred);
  const preferredId = preferred?.id || part.supplier_id;
  restockSupplier.value = allSuppliers.find(s => s.id === preferredId)?.name || "";
  document.getElementById("restock-supplier-email").value = allSuppliers.find(s => s.id === preferredId)?.email || "";
  restockPaymentStatus.value = "paid";
  restockPaymentAccount.value = "";
  restockPaymentAccountField.hidden = false;
  restockMessage.textContent = "";
  restockMessage.dataset.tone = "";
  restockModal.classList.remove("hidden");
  restockModal.style.display = "flex";
}

function showPurchasePrintChoice(purchase) {
  completedPurchase = purchase;
  purchasePrintSummary.textContent = `${purchase.partName} × ${purchase.quantity} from ${purchase.supplierName} · ${purchase.invoiceNumber} · ${formatMoney(purchase.total)}`;
  purchasePrintModal.classList.remove("hidden");
  purchasePrintModal.style.display = "flex";
  if (window.lucide) lucide.createIcons();
}

function printPurchaseReceipt() {
  if (!completedPurchase) return;
  const mode = purchasePrintType.value;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("The receipt could not open because the browser blocked the print window. Allow pop-ups and try again.");
    return;
  }
  const p = completedPurchase;
  const width = mode === "thermal" ? "74mm" : "100%";
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Purchase receipt ${escapeHtml(p.invoiceNumber)}</title>
    <style>@page{size:${mode === "thermal" ? "80mm auto" : "A4"};margin:${mode === "thermal" ? "3mm" : "15mm"}}body{font:14px Arial,sans-serif;color:#111;margin:0 auto;width:${width};max-width:${mode === "thermal" ? "74mm" : "720px"}}h1{font-size:20px;text-align:center}p{margin:7px 0}.total{font-weight:bold;border-top:1px solid #333;padding-top:8px}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #ddd}@media print{body{width:${width}}}</style></head>
    <body><h1>Purchase receipt</h1><p><strong>Centric Auto Mobile</strong></p><p>Invoice: ${escapeHtml(p.invoiceNumber)}</p><p>Date: ${escapeHtml(p.date)}</p><p>Supplier: ${escapeHtml(p.supplierName)}</p><table><tr><td>${escapeHtml(p.partName)} × ${p.quantity}</td><td style="text-align:right">${formatMoney(p.total)}</td></tr></table><p>Unit cost: ${formatMoney(p.unitCost)}</p><p class="total">Total: ${formatMoney(p.total)}</p><script>window.addEventListener("load",()=>window.print());<\/script></body></html>`);
  printWindow.document.close();
}

document.getElementById("purchase-print-now")?.addEventListener("click", printPurchaseReceipt);
document.getElementById("purchase-print-close")?.addEventListener("click", () => {
  purchasePrintModal.classList.add("hidden");
  purchasePrintModal.style.display = "none";
  completedPurchase = null;
});

restockEmailOrderBtn?.addEventListener("click", () => {
  if (!currentRestockPart) return;
  const supplierName = restockSupplier.value.trim();
  const supplier = allSuppliers.find(item => item.name.toLowerCase() === supplierName.toLowerCase());
  const email = (restockSupplierEmail.value || supplier?.email || "").trim();
  if (!supplierName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("Enter a supplier name and email address before composing the order.");
    return;
  }
  const quantity = Number(restockQuantity.value);
  const unitCost = Number(restockUnitCost.value);
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitCost) || unitCost < 0) {
    alert("Enter a valid quantity and unit cost before composing the order.");
    return;
  }
  const subject = `Parts order request — ${currentRestockPart.name}`;
  const body = `Hello ${supplierName},\n\nPlease confirm availability and delivery for:\n${currentRestockPart.name} × ${quantity}\nExpected unit cost: ${formatMoney(unitCost)}\n\nPlease reply with your confirmation and expected delivery date.\n\nCentric Auto Mobile`;
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
restockSupplier?.addEventListener("input", () => {
  const supplier = allSuppliers.find(item => item.name.toLowerCase() === restockSupplier.value.trim().toLowerCase());
  if (supplier) restockSupplierEmail.value = supplier.email || "";
  else restockSupplierEmail.value = "";
});

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
  if (!currentRestockPart || restockSubmissionInProgress) return;
  const part = currentRestockPart;
  const quantity = parseInt(restockQuantity.value, 10);
  const unitCost = parseFloat(restockUnitCost.value);
  const paymentStatus = restockPaymentStatus.value;
  const cashAccountId = restockPaymentAccount.value;
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitCost) || unitCost < 0) {
    alert("Enter a valid quantity and unit cost.");
    return;
  }
  if (quantity * unitCost <= 0) {
    alert("The stock purchase total must be greater than zero.");
    return;
  }
  if (!purchaseAccounts.some(account => account.code === "1200")) {
    alert("Parts Inventory account (code 1200) is missing from the Chart of Accounts.");
    return;
  }
  if (paymentStatus === "paid" && (!cashAccountId || !purchaseAccounts.some(account => account.id === cashAccountId))) {
    alert("Select a valid cash or bank account used to pay this supplier.");
    return;
  }
  if (paymentStatus === "on_credit" && !purchaseAccounts.some(account => account.code === "2000")) {
    alert("Accounts Payable account (code 2000) is missing from the Chart of Accounts.");
    return;
  }
  const supplierName = restockSupplier.value.trim();
  if (!supplierName) {
    alert("Type or select a supplier.");
    return;
  }
  const supplierEmail = restockSupplierEmail.value.trim();
  if (supplierEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail)) {
    alert("Enter a valid supplier email address.");
    return;
  }
  restockSubmissionInProgress = true;
  restockSaveBtn.disabled = true;
  restockMessage.textContent = "Recording stock purchase…";
  restockMessage.dataset.tone = "info";
  try {
  let supplier = allSuppliers.find(item => item.id === supplierName || item.name.toLowerCase() === supplierName.toLowerCase());
  if (!supplier) {
    const { data: createdSupplier, error: supplierError } = await supabase.from("suppliers")
      .insert([{ name: supplierName, email: supplierEmail || null }])
      .select("id, name, email")
      .single();
    if (supplierError) {
      restockMessage.textContent = `Couldn't add supplier: ${supplierError.message}`;
      restockMessage.dataset.tone = "error";
      return;
    }
    supplier = createdSupplier;
    allSuppliers.push(supplier);
    document.getElementById("restock-supplier-options").insertAdjacentHTML("beforeend", `<option value="${escapeHtml(supplier.name)}"></option>`);
  } else if (supplierEmail && !supplier.email) {
    const { error: emailError } = await supabase.from("suppliers").update({ email: supplierEmail }).eq("id", supplier.id);
    if (emailError) {
      restockMessage.textContent = `Couldn't save supplier email: ${emailError.message}`;
      restockMessage.dataset.tone = "error";
      return;
    }
    supplier.email = supplierEmail;
  }
  const purchase = await createShopPurchase({
    part, quantity, unitCost, supplierId: supplier.id, paymentStatus,
    cashAccountId, purchaseDate: new Date().toISOString().slice(0, 10),
  });
  if (purchase.error) {
    restockMessage.textContent = `Failed to record purchase: ${purchase.error.message}`;
    restockMessage.dataset.tone = "error";
    return;
  }

  // Existing stock PLUS the restocked quantity — never overwritten.
  const { error: partError } = await supabase.from("parts").update({
    quantity_in_stock: Number(part.quantity_in_stock || 0) + quantity,
    cost_price: unitCost,
    selling_price: Number(sellingPriceFor(unitCost)),
    vat_rate: DEFAULT_VAT_RATE,
  }).eq("id", part.id);
  if (partError) {
    try {
      await rollbackShopPurchase(purchase.restock.id);
      restockMessage.textContent = "Purchase failed and was rolled back: " + partError.message;
    } catch (rollbackError) {
      console.error("Shop restock rollback failed:", rollbackError);
      restockMessage.textContent = `Purchase stock update failed: ${partError.message}. Its ledger records also need attention: ${rollbackError.message || String(rollbackError)}. Contact an administrator before retrying.`;
    }
    restockMessage.dataset.tone = "error";
    return;
  }

  const purchasedPartName = part.name;
  closeRestockModal();
  await loadParts();
  await loadRestocks();
  showPurchasePrintChoice({
    partName: purchasedPartName,
    quantity,
    unitCost,
    supplierName: supplier.name,
    invoiceNumber: purchase.invoiceNumber,
    date: new Date().toLocaleDateString(),
    total: quantity * unitCost,
  });
  } catch (error) {
    console.error("Couldn't complete shop restock:", error);
    restockMessage.textContent = `Couldn't complete the purchase: ${error.message || String(error)}. Check the restock history before retrying.`;
    restockMessage.dataset.tone = "error";
  } finally {
    restockSubmissionInProgress = false;
    restockSaveBtn.disabled = false;
  }
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
  editVatRate.value = String(Number(part.vat_rate) || DEFAULT_VAT_RATE);
  editPrice.value = Number(part.selling_price || 0).toFixed(2);
  const markup = Number(part.cost_price) > 0
    ? ((Number(part.selling_price) / (Number(part.cost_price) * (1 + Number(editVatRate.value) / 100)) - 1) * 100)
    : MARKUP_RATE * 100;
  document.getElementById("edit-part-markup-rate").value = Math.max(0, markup).toFixed(1);

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
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"), document.getElementById("part-markup-rate"), vatRate);
});
document.getElementById("part-markup-rate")?.addEventListener("input", () => {
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"), document.getElementById("part-markup-rate"), vatRate);
});
document.getElementById("part-price")?.addEventListener("input", () => {
  updateMarkupFromPrice(document.getElementById("part-cost"), document.getElementById("part-price"), document.getElementById("part-markup-rate"), vatRate);
});
vatRate?.addEventListener("change", () => updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"), document.getElementById("part-markup-rate"), vatRate));
editCost?.addEventListener("input", () => updateSellingPrice(editCost, editPrice, document.getElementById("edit-part-markup-rate"), editVatRate));
document.getElementById("edit-part-markup-rate")?.addEventListener("input", () => updateSellingPrice(editCost, editPrice, document.getElementById("edit-part-markup-rate"), editVatRate));
editPrice?.addEventListener("input", () => updateMarkupFromPrice(editCost, editPrice, document.getElementById("edit-part-markup-rate"), editVatRate));
editVatRate?.addEventListener("change", () => updateSellingPrice(editCost, editPrice, document.getElementById("edit-part-markup-rate"), editVatRate));

if (editSaveBtn) editSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentEditId) return;
  const { data: updatedRows, error } = await supabase.from("parts").update({
    name: editName.value.trim(),
    part_number: editPartNumber.value.trim() || null,
    description: editDescription.value.trim() || null,
    category: editCategory.value,
    quantity_in_stock: parseInt(editQty.value) || 0,
    minimum_stock: Number(editMinimumStock.value) || 0,
    cost_price: parseFloat(editCost.value) || 0,
    selling_price: Number(editPrice.value),
    vat_rate: Number(editVatRate.value),
  }).eq("id", currentEditId).select();

  if (error) { alert("Failed to update part: " + error.message); return; }
  if (!updatedRows || updatedRows.length === 0) {
    alert("No part was updated — it may have been deleted. Refreshing the list.");
    closeEditModal();
    await loadParts();
    return;
  }

  closeEditModal();
  await loadParts();
  await loadQuickSaleData();
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
  if (partSubmissionInProgress) return;
  partSubmissionInProgress = true;
  const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
  const quantity = parseInt(document.getElementById("part-qty").value, 10) || 0;
  const unitCost = parseFloat(document.getElementById("part-cost").value) || 0;
  const sellingPrice = Number(document.getElementById("part-price").value);
  const partName = document.getElementById("part-name").value.trim();
  if (!Number.isInteger(quantity) || quantity < 0 || !partName) { alert("Enter a part name and a valid opening quantity."); return; }
  if (!Number.isFinite(sellingPrice) || sellingPrice < 0) { alert("Enter a valid selling price."); return; }
  const { data: newPart, error } = await supabase.from("parts").insert([{
    name: partName,
    part_number: document.getElementById("part-number").value.trim() || null,
    description: document.getElementById("part-description").value.trim() || null,
    category: document.getElementById("part-category").value,
    quantity_in_stock: quantity,
    minimum_stock: Number(document.getElementById("part-minimum-stock").value) || 0,
    cost_price: unitCost,
    selling_price: sellingPrice,
    vat_rate: Number(vatRate.value),
  }]).select("id").single();

  if (error) { alert("Failed to add part: " + error.message); return; }
  form.reset();
  vatRate.value = String(DEFAULT_VAT_RATE);
  document.getElementById("part-markup-rate").value = (MARKUP_RATE * 100).toFixed(1);
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"), document.getElementById("part-markup-rate"), vatRate);
  await loadParts();
  await loadQuickSaleData();
  } finally {
    partSubmissionInProgress = false;
    if (submitButton) submitButton.disabled = false;
  }
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
let quickSaleCustomers = [];

function zimbabweBusinessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function loadQuickSaleCustomers() {
  const customers = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("customers")
      .select("id, full_name, phone")
      .is("deleted_at", null)
      .order("full_name")
      .range(offset, offset + 999);
    if (error) return { data: null, error };
    customers.push(...(data || []));
    if (!data || data.length < 1000) return { data: customers, error: null };
  }
}

async function loadQuickSaleData() {
  const [partsResult, peopleResult, customerResult] = await Promise.all([
    supabase.from("parts").select("id, name, part_number, description, category, selling_price, quantity_in_stock").order("name"),
    supabase.from("technician_directory").select("id, full_name").eq("is_active", true).order("full_name"),
    loadQuickSaleCustomers(),
  ]);
  const { data: partsData, error: partsError } = partsResult;
  const { data: peopleData, error: peopleError } = peopleResult;
  const { data: customerData, error: customerError } = customerResult;
  if (partsError) {
    const message = document.getElementById("quick-sale-message");
    message.textContent = `Couldn't load products: ${partsError.message}`;
    message.dataset.tone = "error";
    console.error("Couldn't load Quick Sale products:", partsError);
    return;
  }
  if (peopleError) console.error("Couldn't load salespeople:", peopleError);
  if (customerError) {
    const message = document.getElementById("quick-sale-message");
    message.textContent = `Couldn't load registered customers: ${customerError.message}`;
    message.dataset.tone = "error";
    console.error("Couldn't load Quick Sale customers:", customerError);
  }
  quickSaleParts = partsData || [];
  quickSaleSalespeople = peopleData || [];
  quickSaleCustomers = customerData || [];

  const categoryFilter = document.getElementById("quick-sale-category");
  if (categoryFilter) {
    const selectedCategory = categoryFilter.value;
    const categories = [...new Set(quickSaleParts.map(part => String(part.category || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    categoryFilter.innerHTML = `<option value="">All categories</option>${categories.map(category =>
      `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`
    ).join("")}`;
    if (categories.includes(selectedCategory)) categoryFilter.value = selectedCategory;
  }

  const salespersonSelect = document.getElementById("quick-sale-salesperson");
  if (salespersonSelect) {
    salespersonSelect.innerHTML = `<option value="">No salesperson — no commission</option>` + quickSaleSalespeople.map(s => `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`).join("");
  }
  const customerSelect = document.getElementById("quick-sale-customer-id");
  if (customerSelect) {
    customerSelect.innerHTML = `<option value="">Walk-in / no account</option>` + quickSaleCustomers.map(customer =>
      `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.full_name)}${customer.phone ? ` · ${escapeHtml(customer.phone)}` : ""}</option>`
    ).join("");
  }
  if (!document.getElementById("quick-sale-items").children.length) addQuickSaleLine();
  updateQuickSaleTotal();
}

function addQuickSaleLine() {
  const cart = document.getElementById("quick-sale-items");
  const row = document.createElement("div");
  row.className = "quick-sale-line";
  const productField = document.createElement("div");
  productField.className = "field quick-sale-product-field";
  productField.innerHTML = `<label>Search product</label><input class="quick-sale-product-search" type="search" autocomplete="off" placeholder="Name, part number or description" aria-label="Search products by name, part number or description"><div class="quick-sale-selected" hidden></div><div class="quick-sale-product-results" role="list" aria-live="polite" hidden></div>`;
  const quantityField = document.createElement("div");
  quantityField.className = "field";
  quantityField.innerHTML = `<label>Quantity</label><input type="number" min="1" step="1" value="1" required>`;
  const priceField = document.createElement("div");
  priceField.className = "field";
  priceField.innerHTML = `<label>Selling price ($)</label><input type="number" min="0.01" step="0.01" placeholder="0.00" title="Price comes from the current product catalogue; apply approved discounts in the sale discount field." readonly required>`;
  const lineTotalField = document.createElement("div");
  lineTotalField.className = "field";
  lineTotalField.innerHTML = `<label>Line total</label><output>$0.00</output>`;
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "btn quick-sale-remove";
  removeButton.setAttribute("aria-label", "Remove product");
  removeButton.innerHTML = '<i data-lucide="trash-2"></i>';
  row.append(productField, quantityField, priceField, lineTotalField, removeButton);
  cart.append(row);
  const search = row.querySelector(".quick-sale-product-search");
  const selectedProduct = row.querySelector(".quick-sale-selected");
  const results = row.querySelector(".quick-sale-product-results");
  search.addEventListener("input", () => {
    delete row.dataset.partId;
    selectedProduct.hidden = true;
    selectedProduct.innerHTML = "";
    row.querySelector('input[type="number"][step="0.01"]').value = "";
    renderQuickSaleProductResults(row);
  });
  search.addEventListener("focus", () => {
    if (search.value.trim()) renderQuickSaleProductResults(row);
  });
  results.addEventListener("click", event => {
    const addButton = event.target.closest("[data-quick-sale-part-id]");
    if (!addButton) return;
    const part = quickSaleParts.find(item => item.id === addButton.dataset.quickSalePartId);
    if (!part || Number(part.quantity_in_stock) < 1) return;
    row.dataset.partId = part.id;
    search.value = part.name;
    results.hidden = true;
    selectedProduct.innerHTML = `<span class="quick-sale-selected-check" aria-hidden="true">✓</span><span><strong>${escapeHtml(part.name)}</strong><small>${Number(part.quantity_in_stock)} available in stock</small></span><button type="button" class="quick-sale-change-product" aria-label="Change selected product">Change</button>`;
    selectedProduct.hidden = false;
    row.querySelector('input[type="number"][step="0.01"]').value = Number(part.selling_price || 0).toFixed(2);
    updateQuickSaleTotal();
    row.querySelector('input[type="number"][step="1"]').focus();
  });
  selectedProduct.addEventListener("click", event => {
    if (!event.target.closest(".quick-sale-change-product")) return;
    delete row.dataset.partId;
    selectedProduct.hidden = true;
    search.value = "";
    search.focus();
    results.hidden = true;
    row.querySelector('input[type="number"][step="0.01"]').value = "";
    updateQuickSaleTotal();
  });
  row.addEventListener("input", updateQuickSaleTotal);
  row.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    if (event.target === search) {
      event.preventDefault();
      const firstAddButton = results.querySelector("[data-quick-sale-part-id]:not(:disabled)");
      firstAddButton?.click();
      return;
    }
    event.preventDefault();
    if (event.target.matches('input[type="number"][step="1"]')) {
      row.querySelector('input[type="number"][step="0.01"]').focus();
    } else {
      addQuickSaleLine();
    }
  });
  removeButton.addEventListener("click", () => {
    row.remove();
    if (!cart.children.length) addQuickSaleLine();
    updateQuickSaleTotal();
  });
  if (window.lucide) lucide.createIcons();
  search.focus();
}

function normalizeProductSearch(value) {
  return String(value || "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function spellingDistance(left, right, maxDistance) {
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const distance = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost,
      );
      current.push(distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    previous = current;
  }
  return previous[right.length];
}

function productSearchScore(query, part) {
  const name = normalizeProductSearch(part.name);
  const partNumber = normalizeProductSearch(part.part_number);
  const description = normalizeProductSearch(part.description);
  const category = normalizeProductSearch(part.category);
  const searchable = `${name} ${partNumber} ${description} ${category}`;
  if (searchable.includes(query)) return 0;
  const queryWords = query.split(" ").filter(Boolean);
  const nameWords = name.split(" ");
  const numberWords = partNumber.split(" ");
  const descriptionWords = description.split(" ");
  const categoryWords = category.split(" ");
  let score = 0;
  for (const word of queryWords) {
    if (searchable.split(" ").some(candidate => candidate.startsWith(word))) {
      score += 1;
      continue;
    }
    const maxDistance = word.length < 4 ? 0 : Math.min(2, Math.floor(word.length / 4));
    if (!maxDistance) return Infinity;
    const distance = Math.min(...[...nameWords, ...numberWords, ...descriptionWords, ...categoryWords]
      .filter(candidate => Math.abs(candidate.length - word.length) <= maxDistance)
      .map(candidate => spellingDistance(word, candidate, maxDistance)));
    if (!Number.isFinite(distance) || distance > maxDistance) return Infinity;
    score += 2 + distance;
  }
  return score;
}

function renderQuickSaleProductResults(row) {
  const search = row.querySelector(".quick-sale-product-search");
  const results = row.querySelector(".quick-sale-product-results");
  const query = normalizeProductSearch(search.value);
  const category = document.getElementById("quick-sale-category")?.value || "";
  results.replaceChildren();
  if (!query) {
    results.hidden = true;
    return;
  }
  const rankedMatches = quickSaleParts
    .filter(part => !category || String(part.category || "").trim() === category)
    .map(part => ({ part, score: productSearchScore(query, part) }))
    .filter(match => Number.isFinite(match.score))
    .sort((left, right) => left.score - right.score || left.part.name.localeCompare(right.part.name))
    .slice(0, 30);
  const hasExactMatch = rankedMatches.some(match => match.score === 0);
  const matches = rankedMatches.map(match => match.part);
  if (!matches.length) {
    results.innerHTML = '<div class="quick-sale-product-empty">No close matches found. Check the spelling or try a shorter search.</div>';
    results.hidden = false;
    return;
  }
  results.innerHTML = `${hasExactMatch ? '<div class="quick-sale-results-heading">Matching products</div>' : '<div class="quick-sale-results-heading">Closest spelling matches</div>'}${matches.map(part => {
    const unavailable = Number(part.quantity_in_stock) < 1;
    const productDetails = [
      part.part_number,
      part.description,
      `${Number(part.quantity_in_stock)} in stock`,
      formatMoney(part.selling_price),
    ].filter(Boolean).join(" · ");
    return `<div class="quick-sale-product-result"><span class="quick-sale-product-result-name">${escapeHtml(part.name)}<small>${escapeHtml(productDetails)}</small></span><button type="button" class="btn btn--primary" data-quick-sale-part-id="${escapeHtml(part.id)}" aria-label="Add ${escapeHtml(part.name)}" ${unavailable ? "disabled" : ""}>${unavailable ? "Out of stock" : "Add"}</button></div>`;
  }).join("")}`;
  results.hidden = false;
}

function updateQuickSaleTotal() {
  const rows = [...document.querySelectorAll("#quick-sale-items .quick-sale-line")];
  const subtotal = roundMoney(rows.reduce((sum, row) => {
    const quantity = Number(row.querySelector('input[type="number"][step="1"]').value) || 0;
    const price = Number(row.querySelector('input[type="number"][step="0.01"]').value) || 0;
    const lineTotal = roundMoney(quantity * price);
    row.querySelector("output").textContent = formatMoney(lineTotal);
    return sum + lineTotal;
  }, 0));
  const discountInput = document.getElementById("quick-sale-discount");
  const discount = Math.max(0, Number(discountInput?.value) || 0);
  const total = roundMoney(Math.max(0, subtotal - discount));
  document.getElementById("quick-sale-total").innerHTML = `Subtotal ${formatMoney(subtotal)} <span aria-hidden="true">−</span> Discount ${formatMoney(discount)} <strong>Total ${formatMoney(total)}</strong>`;
}
document.getElementById("quick-sale-add-item")?.addEventListener("click", addQuickSaleLine);
document.getElementById("quick-sale-discount")?.addEventListener("input", updateQuickSaleTotal);
document.getElementById("quick-sale-category")?.addEventListener("change", () => {
  document.querySelectorAll(".quick-sale-line").forEach(row => {
    const search = row.querySelector(".quick-sale-product-search");
    if (search?.value.trim()) renderQuickSaleProductResults(row);
  });
});

document.getElementById("quick-sale-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = document.getElementById("quick-sale-message");
  const salespersonId = document.getElementById("quick-sale-salesperson").value || null;
  const customerId = document.getElementById("quick-sale-customer-id").value || null;
  const selectedCustomer = quickSaleCustomers.find(customer => customer.id === customerId);
  const customerName = selectedCustomer?.full_name || document.getElementById("quick-sale-customer").value.trim() || "Walk-in Sale";
  const lines = [...document.querySelectorAll("#quick-sale-items .quick-sale-line")].map(row => {
    const partId = row.dataset.partId;
    const part = quickSaleParts.find(item => item.id === partId);
    return {
      part,
      quantity: Number(row.querySelector('input[type="number"][step="1"]').value),
      price: Number(row.querySelector('input[type="number"][step="0.01"]').value),
    };
  });
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + roundMoney(line.quantity * line.price), 0));
  const discount = Number(document.getElementById("quick-sale-discount").value);
  const paymentMethod = document.getElementById("quick-sale-payment-method").value;
  if (!lines.length || lines.some(line => !line.part || !Number.isInteger(line.quantity) || line.quantity < 1 || !Number.isFinite(line.price) || line.price <= 0)) {
    message.textContent = "Choose a product and enter a valid quantity and selling price for every line.";
    message.dataset.tone = "error";
    return;
  }
  if (!Number.isFinite(discount) || discount < 0 || discount >= subtotal) {
    message.textContent = "Enter a discount of $0 or more that is less than the sale subtotal.";
    message.dataset.tone = "error";
    return;
  }
  if (paymentMethod === "Credit" && !selectedCustomer) {
    message.textContent = "Choose a registered customer before completing a credit sale.";
    message.dataset.tone = "error";
    return;
  }
  if (customerId && !selectedCustomer) {
    message.textContent = "The selected customer is no longer available. Refresh the customer list and try again.";
    message.dataset.tone = "error";
    return;
  }
  const quantitiesByPart = new Map();
  lines.forEach(line => quantitiesByPart.set(line.part.id, (quantitiesByPart.get(line.part.id) || 0) + line.quantity));
  for (const [partId, quantity] of quantitiesByPart) {
    const part = quickSaleParts.find(item => item.id === partId);
    if (quantity > Number(part.quantity_in_stock || 0)) {
      message.textContent = `Only ${part.quantity_in_stock} of ${part.name} in stock; the cart needs ${quantity}.`;
      message.dataset.tone = "error";
      return;
    }
  }

  const button = document.querySelector('#quick-sale-form button[type="submit"]');
  button.disabled = true;
  message.textContent = "Processing sale…";
  message.dataset.tone = "info";
  try {
    const rate = await getRate();
    const { data: order, error } = await supabase.rpc("complete_quick_sale", {
      p_customer_id: customerId,
      p_customer_name: customerName,
      p_salesperson_id: salespersonId,
      p_usd_to_zig_rate: rate,
      p_discount_usd: discount,
      p_payment_method: paymentMethod,
      p_payment_date: zimbabweBusinessDate(),
      p_items: lines.map(line => ({
        part_id: line.part.id,
        quantity: line.quantity,
        unit_price_usd: roundMoney(line.price),
      })),
    });
    if (error) throw new Error(error.message);
    if (!order?.id) throw new Error("The sale could not be confirmed. Refresh the sales history before trying again.");
    if (paymentMethod === "Credit") {
      window.location.href = "ledger.html#customer-accounts";
    } else {
      window.location.href = `receipts.html?order=${encodeURIComponent(order.id)}&from=shop`;
    }
  } catch (error) {
    console.error("Quick Sale failed:", error);
    message.textContent = error.message || "The sale could not be completed. Please verify the sale history before retrying.";
    message.dataset.tone = "error";
    button.disabled = false;
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