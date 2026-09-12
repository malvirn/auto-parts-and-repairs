import supabase from "./supabaseClient.js";

const ICONS = [
  "wrench", "battery", "disc-3", "settings", "gauge", "filter",
  "droplet", "zap", "circle-dot", "car", "thermometer", "wind",
  "plug", "shield", "package"
];

const form = document.getElementById("part-form");
const tableBody = document.getElementById("parts-table");
const restocksTableBody = document.getElementById("restocks-table");
const iconPicker = document.getElementById("icon-picker");
const partIconInput = document.getElementById("part-icon");
const partSupplier = document.getElementById("part-supplier");

const editModal = document.getElementById("edit-part-modal");
const editName = document.getElementById("edit-part-name");
const editCategory = document.getElementById("edit-part-category");
const editQty = document.getElementById("edit-part-qty");
const editSupplier = document.getElementById("edit-part-supplier");
const editCost = document.getElementById("edit-part-cost");
const editPrice = document.getElementById("edit-part-price");
const editIconInput = document.getElementById("edit-part-icon");
const editIconPicker = document.getElementById("edit-icon-picker");
const editSaveBtn = document.getElementById("edit-part-save");
const editDeleteBtn = document.getElementById("edit-part-delete");
const editCancelBtn = document.getElementById("edit-part-cancel");
const restockModal = document.getElementById("restock-modal");
const restockPartName = document.getElementById("restock-part-name");
const restockSupplier = document.getElementById("restock-supplier");
const restockQuantity = document.getElementById("restock-quantity");
const restockUnitCost = document.getElementById("restock-unit-cost");
const restockSaveBtn = document.getElementById("restock-save");
const restockCancelBtn = document.getElementById("restock-cancel");
const totalUnitsEl = document.getElementById("shop-total-units");
const costValueEl = document.getElementById("shop-cost-value");
const retailValueEl = document.getElementById("shop-retail-value");

let currentEditId = null;
let currentRestockPart = null;
const MARKUP_RATE = 0.15;

function sellingPriceFor(cost) {
  return (Math.max(0, Number(cost) || 0) * (1 + MARKUP_RATE)).toFixed(2);
}

function updateSellingPrice(costInput, priceInput) {
  if (costInput && priceInput) priceInput.value = sellingPriceFor(costInput.value);
}

function buildIconPicker(container, hiddenInput, selected) {
  container.innerHTML = ICONS.map(name => `
    <div class="icon-option ${name === selected ? "selected" : ""}" data-icon="${name}">
      <i data-lucide="${name}"></i>
    </div>
  `).join("");
  if (window.lucide) lucide.createIcons();

  container.querySelectorAll(".icon-option").forEach(el => {
    el.addEventListener("click", () => {
      container.querySelectorAll(".icon-option").forEach(o => o.classList.remove("selected"));
      el.classList.add("selected");
      hiddenInput.value = el.dataset.icon;
    });
  });
}

buildIconPicker(iconPicker, partIconInput, "package");

async function loadParts() {
  const { data, error } = await supabase.from("parts").select("*, supplier:suppliers(id, name)").order("name");

  if (error) {
    console.error("Error loading parts:", error);
    tableBody.innerHTML = `<tr><td colspan="9" style="color:var(--danger)">Failed to load: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    renderStockSummary([]);
    tableBody.innerHTML = `<tr><td colspan="9" style="color:var(--text-muted)">No parts yet — add your first one above</td></tr>`;
    return;
  }

  renderStockSummary(data);

  tableBody.innerHTML = data.map(p => {
    const margin = p.selling_price - p.cost_price;
    const marginPct = p.cost_price > 0 ? ((margin / p.cost_price) * 100).toFixed(0) : "—";
    const stockClass = p.quantity_in_stock < 3 ? "stock-low" : "stock-ok";
    const supplierLabel = p.supplier?.name ? escapeHtml(p.supplier.name) : "—";
    const lowStockLabel = p.quantity_in_stock < 3 ? ` ⚠️ ${supplierLabel}` : "";
    return `
      <tr data-part='${JSON.stringify(p).replace(/'/g, "&apos;")}'>
        <td><div class="part-icon-badge"><i data-lucide="${p.icon || "package"}"></i></div></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category || "—")}</td>
        <td>$${Number(p.cost_price).toFixed(2)}</td>
        <td>$${Number(p.selling_price).toFixed(2)}</td>
        <td><span class="margin-badge">+$${margin.toFixed(2)} (${marginPct}%)</span></td>
        <td class="${stockClass}">${p.quantity_in_stock}${lowStockLabel}</td>
        <td>${supplierLabel}</td>
        <td><button class="btn restock-part-btn" type="button"><i data-lucide="package-plus"></i> Restock</button> <button class="btn edit-part-btn" type="button"><i data-lucide="pencil"></i></button></td>
      </tr>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();

  document.querySelectorAll(".edit-part-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const part = JSON.parse(btn.closest("tr").dataset.part);
      openEditModal(part);
    });
  });
  document.querySelectorAll(".restock-part-btn").forEach(btn => {
    btn.addEventListener("click", () => openRestockModal(JSON.parse(btn.closest("tr").dataset.part)));
  });
}

function renderStockSummary(parts) {
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
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

async function loadSuppliersIntoSelect() {
  if (!partSupplier && !restockSupplier && !editSupplier) return;
  const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
  if (error) { console.error("Error loading suppliers:", error); return; }
  const options = (data || []).map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if (restockSupplier) restockSupplier.innerHTML = `<option value="">No supplier selected</option>${options}`;
  if (partSupplier) partSupplier.innerHTML = `<option value="">No default supplier</option>${options}`;
  if (editSupplier) editSupplier.innerHTML = `<option value="">No default supplier</option>${options}`;
}

async function loadRestocks() {
  if (!restocksTableBody) return;
  const { data, error } = await supabase
    .from("restocks")
    .select("quantity, unit_cost, restocked_at, parts(name), suppliers(name)")
    .order("restocked_at", { ascending: false })
    .limit(50);
  if (error) {
    restocksTableBody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">Failed to load restocks: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }
  restocksTableBody.innerHTML = data?.length ? data.map(restock => `
    <tr><td>${escapeHtml(restock.parts?.name || "—")}</td><td>${escapeHtml(restock.suppliers?.name || "No supplier")}</td><td>${restock.quantity}</td><td>$${Number(restock.unit_cost).toFixed(2)}</td><td>${new Date(restock.restocked_at).toLocaleDateString()}</td></tr>
  `).join("") : `<tr><td colspan="5" style="color:var(--text-muted)">No restocks recorded yet</td></tr>`;
}

function openRestockModal(part) {
  currentRestockPart = part;
  restockPartName.textContent = part.name;
  restockQuantity.value = 1;
  restockUnitCost.value = Number(part.cost_price || 0).toFixed(2);
  restockSupplier.value = part.supplier_id || "";
  restockModal.classList.remove("hidden");
  restockModal.style.display = "flex";
}

function closeRestockModal() {
  restockModal.classList.add("hidden");
  restockModal.style.display = "none";
  currentRestockPart = null;
}

restockCancelBtn?.addEventListener("click", closeRestockModal);
restockModal?.addEventListener("click", event => { if (event.target === restockModal) closeRestockModal(); });

restockSaveBtn?.addEventListener("click", async () => {
  if (!currentRestockPart) return;
  const quantity = parseInt(restockQuantity.value, 10);
  const unitCost = parseFloat(restockUnitCost.value);
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitCost) || unitCost < 0) {
    alert("Enter a valid quantity and unit cost.");
    return;
  }

  const { data: restockRow, error: restockError } = await supabase.from("restocks").insert([{
    part_id: currentRestockPart.id,
    supplier_id: restockSupplier.value || null,
    quantity,
    unit_cost: unitCost,
  }]).select("id").single();
  if (restockError) { alert("Failed to save restock: " + restockError.message); return; }

  const { error: partError } = await supabase.from("parts").update({
    quantity_in_stock: Number(currentRestockPart.quantity_in_stock || 0) + quantity,
    cost_price: unitCost,
    selling_price: Number(sellingPriceFor(unitCost)),
  }).eq("id", currentRestockPart.id);
  if (partError) {
    if (restockRow?.id) await supabase.from("restocks").delete().eq("id", restockRow.id);
    alert("Restock failed and was rolled back: " + partError.message);
    return;
  }

  closeRestockModal();
  await loadParts();
  await loadRestocks();
});

function openEditModal(part) {
  if (!editModal) return;
  currentEditId = part.id;
  editName.value = part.name;
  editCategory.value = part.category || "";
  editQty.value = part.quantity_in_stock;
  editSupplier.value = part.supplier_id || "";
  editCost.value = part.cost_price;
  updateSellingPrice(editCost, editPrice);
  editIconInput.value = part.icon || "package";
  buildIconPicker(editIconPicker, editIconInput, part.icon || "package");
  editModal.classList.remove("hidden");
  editModal.style.display = "flex";
}

function closeEditModal() {
  if (!editModal) return;
  editModal.classList.add("hidden");
  editModal.style.display = "none";
  currentEditId = null;
}

if (editCancelBtn) editCancelBtn.addEventListener("click", (e) => {
  e.preventDefault();
  closeEditModal();
});
if (editModal) editModal.addEventListener("click", (e) => {
  if (e.target === editModal) closeEditModal();
});

document.getElementById("part-cost")?.addEventListener("input", () => {
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"));
});
editCost?.addEventListener("input", () => updateSellingPrice(editCost, editPrice));

if (editSaveBtn) editSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentEditId) return;
  const { data: updatedRows, error } = await supabase.from("parts").update({
    name: editName.value.trim(),
    category: editCategory.value.trim() || null,
    quantity_in_stock: parseInt(editQty.value) || 0,
    supplier_id: editSupplier.value || null,
    cost_price: parseFloat(editCost.value) || 0,
    selling_price: Number(sellingPriceFor(editCost.value)),
    icon: editIconInput.value,
  }).eq("id", currentEditId).select();

  if (error) { alert("Failed to update part: " + error.message); return; }
  if (!updatedRows || updatedRows.length === 0) {
    alert("No part was updated — it may have been deleted. Refreshing the list.");
    closeEditModal();
    loadParts();
    return;
  }
  closeEditModal();
  loadParts();
});

if (editDeleteBtn) editDeleteBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentEditId) return;
  if (!confirm("Delete this part? This can't be undone.")) return;
  const { error } = await supabase.from("parts").delete().eq("id", currentEditId);
  if (error) { alert("Failed to delete part: " + error.message); return; }
  closeEditModal();
  loadParts();
});

if (form) form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await supabase.from("parts").insert([{
    name: document.getElementById("part-name").value.trim(),
    category: document.getElementById("part-category").value.trim() || null,
    quantity_in_stock: parseInt(document.getElementById("part-qty").value) || 0,
    cost_price: parseFloat(document.getElementById("part-cost").value) || 0,
    selling_price: Number(sellingPriceFor(document.getElementById("part-cost").value)),
    supplier_id: partSupplier.value || null,
    icon: partIconInput.value,
  }]);

  if (error) { alert("Failed to add part: " + error.message); return; }
  form.reset();
  buildIconPicker(iconPicker, partIconInput, "package");
  loadParts();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", loadParts);
document.addEventListener("DOMContentLoaded", () => {
  loadSuppliersIntoSelect();
  loadRestocks();
});
