import supabase from "./supabaseClient.js";
import { getRate } from "./currency.js";

// ⚠️ Fill these in — see the setup steps provided alongside this file.
// Restricted the same way as the Suppliers page's Google Places key:
// HTTP referrer + API restricted to Custom Search API only.
// ⚠️ Fill this in with your free Pexels API key (pexels.com/api — no
// credit card required, just a developer account signup).
const PEXELS_API_KEY = "Qulr1UcmmWsKdPimbDdgj8Eifl3VpHaPrf4fcSbSVgmPz1Ccwzd5stCc";

const PLACEHOLDER_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" rx="10" fill="#f2f0ea"/><text x="50%" y="58%" font-size="28" text-anchor="middle" fill="#bbb">?</text></svg>`
);

const form = document.getElementById("part-form");
const tableBody = document.getElementById("parts-table");
const restocksTableBody = document.getElementById("restocks-table");
const partSuppliersList = document.getElementById("part-suppliers-list");

const editModal = document.getElementById("edit-part-modal");
const editName = document.getElementById("edit-part-name");
const editCategory = document.getElementById("edit-part-category");
const editQty = document.getElementById("edit-part-qty");
const editCost = document.getElementById("edit-part-cost");
const editPrice = document.getElementById("edit-part-price");
const editSuppliersList = document.getElementById("edit-part-suppliers-list");
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
let allSuppliers = [];              // [{id, name}]
let currentPartSuppliers = {};      // part_id -> [{id, name, is_preferred}]
let MARKUP_RATE = 0.15;
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
  return (Math.max(0, Number(cost) || 0) * (1 + MARKUP_RATE)).toFixed(2);
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
  document.getElementById("part-markup-label").textContent = `${(MARKUP_RATE * 100).toFixed(0)}%`;
  document.getElementById("edit-part-markup-label").textContent = `${(MARKUP_RATE * 100).toFixed(0)}%`;
}

document.getElementById("save-markup-btn")?.addEventListener("click", async () => {
  const pct = parseFloat(document.getElementById("markup-rate-input").value);
  if (!Number.isFinite(pct) || pct < 0) { alert("Enter a valid percentage."); return; }
  MARKUP_RATE = pct / 100;
  if (settingsRowId) {
    const { error } = await supabase.from("settings").update({ markup_rate: MARKUP_RATE }).eq("id", settingsRowId);
    if (error) { alert("Failed to save markup rate: " + error.message); return; }
  }
  document.getElementById("part-markup-label").textContent = `${pct}%`;
  document.getElementById("edit-part-markup-label").textContent = `${pct}%`;
  updateSellingPrice(document.getElementById("part-cost"), document.getElementById("part-price"));
  alert("Markup rate updated. New parts and edits use it from now on — use \"Apply to All Existing Parts\" if you also want it applied retroactively.");
});

document.getElementById("apply-markup-all-btn")?.addEventListener("click", async () => {
  if (!confirm(`Recalculate the selling price of every part at ${(MARKUP_RATE * 100).toFixed(1)}%? This overwrites any manually adjusted prices.`)) return;
  const { data: parts, error } = await supabase.from("parts").select("id, cost_price");
  if (error) { alert("Failed to load parts: " + error.message); return; }
  for (const p of parts || []) {
    await supabase.from("parts").update({ selling_price: Number(sellingPriceFor(p.cost_price)) }).eq("id", p.id);
  }
  alert("Selling prices updated.");
  loadParts();
});

// ---- Pexels Image Search ----
// Free, no credit card required — but it's a stock-photo library, not a
// product catalog, so results for specific auto parts will be hit-or-miss
// compared to a general web image search. The "paste an image URL"
// field next to this stays the more reliable option for finding an
// actual product photo of a specific part.
async function searchGoogleImages(query) {
  if (!PEXELS_API_KEY || PEXELS_API_KEY === "YOUR_PEXELS_API_KEY") {
    throw new Error("Pexels image search isn't set up yet — add your free API key in shop.js (get one at pexels.com/api).");
  }
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", `${query} auto part`);
  url.searchParams.set("per_page", "6");

  const response = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Image search failed (${response.status})`);
  }
  const data = await response.json();
  return (data.photos || []).map(photo => ({
    thumbnail: photo.src?.small || photo.src?.medium || photo.src?.original,
    full: photo.src?.original || photo.src?.large,
  }));
}

// Pasting a link copied straight from Google Images gives you a wrapper
// URL like google.com/imgres?...&imgurl=<the real image>&... — that's an
// HTML results page, not an image file, so it won't render. This pulls the
// actual image URL out of it automatically.
function extractDirectImageUrl(rawUrl) {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes("google.") && parsed.searchParams.has("imgurl")) {
      return decodeURIComponent(parsed.searchParams.get("imgurl"));
    }
  } catch (e) {
    const match = trimmed.match(/[?&]imgurl=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return trimmed;
}

function wireImageSearch({ nameInputId, searchBtn, resultsContainer, previewImg, urlInput }) {
  if (!searchBtn) return;
  searchBtn.addEventListener("click", async () => {
    const query = document.getElementById(nameInputId).value.trim();
    if (!query) { alert("Type the part name first."); return; }
    const original = searchBtn.innerHTML;
    searchBtn.disabled = true;
    searchBtn.innerHTML = `<i data-lucide="loader-circle"></i> Searching…`;
    if (window.lucide) lucide.createIcons();
    try {
      const results = await searchGoogleImages(query);
      resultsContainer.innerHTML = results.length
        ? results.map(r => `<img src="${r.thumbnail}" class="image-result-thumb" data-full="${r.full}" />`).join("")
        : `<span style="font-size:.8rem;color:var(--text-muted);">No results — try a simpler name or paste a URL instead.</span>`;
      resultsContainer.querySelectorAll(".image-result-thumb").forEach(img => {
        img.addEventListener("click", () => {
          resultsContainer.querySelectorAll(".image-result-thumb").forEach(t => t.classList.remove("selected"));
          img.classList.add("selected");
          previewImg.src = img.dataset.full;
          urlInput.value = img.dataset.full;
        });
      });
    } catch (err) {
      console.error("Image search failed:", err);
      resultsContainer.innerHTML = `<span style="font-size:.8rem;color:var(--danger);">${escapeHtml(err.message)}</span>`;
    } finally {
      searchBtn.disabled = false;
      searchBtn.innerHTML = original;
      if (window.lucide) lucide.createIcons();
    }
  });
  urlInput.addEventListener("input", () => { previewImg.src = urlInput.value || PLACEHOLDER_IMG; });
  urlInput.addEventListener("blur", () => {
    const cleaned = extractDirectImageUrl(urlInput.value);
    if (cleaned !== urlInput.value.trim()) {
      urlInput.value = cleaned;
      previewImg.src = cleaned || PLACEHOLDER_IMG;
    }
  });
}

wireImageSearch({
  nameInputId: "part-name",
  searchBtn: document.getElementById("part-image-search-btn"),
  resultsContainer: document.getElementById("part-image-results"),
  previewImg: document.getElementById("part-image-preview"),
  urlInput: document.getElementById("part-image-url"),
});
wireImageSearch({
  nameInputId: "edit-part-name",
  searchBtn: document.getElementById("edit-part-image-search-btn"),
  resultsContainer: document.getElementById("edit-part-image-results"),
  previewImg: document.getElementById("edit-part-image-preview"),
  urlInput: document.getElementById("edit-part-image-url"),
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
  const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
  if (error) { console.error("Error loading suppliers:", error); return; }
  allSuppliers = data || [];
  const options = allSuppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if (restockSupplier) restockSupplier.innerHTML = `<option value="">No supplier selected</option>${options}`;
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
    tableBody.innerHTML = `<tr><td colspan="9" style="color:var(--danger)">Failed to load: ${error.message}</td></tr>`;
    return;
  }

  allPartsData = data || [];
  renderStockSummary(allPartsData);
  renderLowStockAlert(allPartsData);
  renderPartsTable(allPartsData);
}

function renderPartsTable(data) {
  if (!data || data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="9" style="color:var(--text-muted)">${allPartsData.length ? "No parts match your search" : "No parts yet — add your first one above"}</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map(p => {
    const margin = p.selling_price - p.cost_price;
    const marginPct = p.cost_price > 0 ? ((margin / p.cost_price) * 100).toFixed(0) : "—";
    const stockClass = p.quantity_in_stock < 3 ? "stock-low" : "stock-ok";
    const linked = currentPartSuppliers[p.id] || [];
    const supplierChips = linked.length
      ? linked.map(l => `<span class="supplier-chip ${l.is_preferred ? "preferred" : ""}">${l.is_preferred ? "★ " : ""}${escapeHtml(l.name)}</span>`).join("")
      : `<span style="color:var(--text-muted);">—</span>`;
    return `
      <tr data-part='${JSON.stringify(p).replace(/'/g, "&apos;")}'>
        <td><img class="part-thumb" src="${p.image_url || PLACEHOLDER_IMG}" alt="${escapeHtml(p.name)}" /></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category || "—")}</td>
        <td>$${Number(p.cost_price).toFixed(2)}</td>
        <td>$${Number(p.selling_price).toFixed(2)}</td>
        <td><span class="margin-badge">+$${margin.toFixed(2)} (${marginPct}%)</span></td>
        <td class="${stockClass}">${p.quantity_in_stock}</td>
        <td>${supplierChips}</td>
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
  document.querySelectorAll(".part-thumb").forEach(img => {
    img.addEventListener("click", () => openImageLightbox(img.src, img.alt));
  });
}

function openImageLightbox(src, alt) {
  document.getElementById("image-lightbox-img").src = src;
  document.getElementById("image-lightbox-img").alt = alt;
  document.getElementById("image-lightbox").classList.remove("hidden");
}
document.getElementById("image-lightbox")?.addEventListener("click", () => {
  document.getElementById("image-lightbox").classList.add("hidden");
});

document.getElementById("parts-search")?.addEventListener("input", (e) => {
  const term = e.target.value.trim().toLowerCase();
  if (!term) { renderPartsTable(allPartsData); return; }
  const filtered = allPartsData.filter(p =>
    (p.name || "").toLowerCase().includes(term) || (p.category || "").toLowerCase().includes(term)
  );
  renderPartsTable(filtered);
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

// ---- Alerts: low stock (with a best-effort browser notification) + best sellers ----
function renderLowStockAlert(parts) {
  const el = document.getElementById("low-stock-alert");
  if (!el) return;
  const lowStock = parts.filter(p => Number(p.quantity_in_stock) < 3);
  el.innerHTML = lowStock.length
    ? lowStock.map(p => `<div class="alert-row"><span>${escapeHtml(p.name)}</span><strong class="stock-low">${p.quantity_in_stock} left</strong></div>`).join("")
    : `<span style="color:var(--text-muted); font-size:.85rem;">Stock levels are healthy.</span>`;

  // Best-effort only — this fires while the tab is open, it's not a true
  // push notification (that needs a service worker + push server, which is
  // a much bigger project than this page). The on-page list above is the
  // reliable part; this is just a bonus if the browser allows it.
  if (lowStock.length && "Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification("Low stock", { body: `${lowStock.length} part(s) below 3 units: ${lowStock.map(p => p.name).join(", ")}` });
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

// ---- Restock modal ----
function openRestockModal(part) {
  currentRestockPart = part;
  restockPartName.textContent = part.name;
  restockQuantity.value = 1;
  restockUnitCost.value = Number(part.cost_price || 0).toFixed(2);
  const preferred = (currentPartSuppliers[part.id] || []).find(l => l.is_preferred);
  restockSupplier.value = preferred?.id || part.supplier_id || "";
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

  // Existing stock PLUS the restocked quantity — never overwritten.
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

// ---- Edit modal ----
function openEditModal(part) {
  if (!editModal) return;
  currentEditId = part.id;
  editName.value = part.name;
  editCategory.value = part.category || "";
  editQty.value = part.quantity_in_stock;
  editCost.value = part.cost_price;
  updateSellingPrice(editCost, editPrice);

  const linked = currentPartSuppliers[part.id] || [];
  const preferredId = linked.find(l => l.is_preferred)?.id || part.supplier_id || null;
  buildSupplierChecklist(editSuppliersList, allSuppliers, linked.map(l => l.id), preferredId);

  document.getElementById("edit-part-image-preview").src = part.image_url || PLACEHOLDER_IMG;
  document.getElementById("edit-part-image-url").value = part.image_url || "";
  document.getElementById("edit-part-image-results").innerHTML = "";

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
editCost?.addEventListener("input", () => updateSellingPrice(editCost, editPrice));

if (editSaveBtn) editSaveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!currentEditId) return;
  const { supplierIds, preferredId } = readSupplierChecklist(editSuppliersList);

  const { data: updatedRows, error } = await supabase.from("parts").update({
    name: editName.value.trim(),
    category: editCategory.value.trim() || null,
    quantity_in_stock: parseInt(editQty.value) || 0,
    cost_price: parseFloat(editCost.value) || 0,
    selling_price: Number(sellingPriceFor(editCost.value)),
    supplier_id: preferredId || null,
    image_url: document.getElementById("edit-part-image-url").value.trim() || null,
  }).eq("id", currentEditId).select();

  if (error) { alert("Failed to update part: " + error.message); return; }
  if (!updatedRows || updatedRows.length === 0) {
    alert("No part was updated — it may have been deleted. Refreshing the list.");
    closeEditModal();
    loadParts();
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
  const { supplierIds, preferredId } = readSupplierChecklist(partSuppliersList);

  const { data: newPart, error } = await supabase.from("parts").insert([{
    name: document.getElementById("part-name").value.trim(),
    category: document.getElementById("part-category").value.trim() || null,
    quantity_in_stock: parseInt(document.getElementById("part-qty").value) || 0,
    cost_price: parseFloat(document.getElementById("part-cost").value) || 0,
    selling_price: Number(sellingPriceFor(document.getElementById("part-cost").value)),
    supplier_id: preferredId || null,
    image_url: document.getElementById("part-image-url").value.trim() || null,
  }]).select("id").single();

  if (error) { alert("Failed to add part: " + error.message); return; }

  if (supplierIds.length) {
    const rows = supplierIds.map(sid => ({ part_id: newPart.id, supplier_id: sid, is_preferred: sid === preferredId }));
    const { error: linkError } = await supabase.from("part_suppliers").insert(rows);
    if (linkError) console.error("Error linking suppliers:", linkError);
  }

  form.reset();
  document.getElementById("part-image-preview").src = PLACEHOLDER_IMG;
  document.getElementById("part-image-results").innerHTML = "";
  buildSupplierChecklist(partSuppliersList, allSuppliers, [], null);
  loadParts();
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
  message.textContent = `Sale complete — ${formatMoney(total)}${salespersonId ? " · commission will show after the next Generate Commissions scan" : ""}.`;
  message.dataset.tone = "success";
  await loadQuickSaleData();
  await loadParts();
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
  document.getElementById("part-image-preview").src = PLACEHOLDER_IMG;
  await loadMarkupRate();
  await loadSuppliersIntoSelect();
  await loadParts();
  loadRestocks();
  renderTopSellers();
  loadQuickSaleData();
});
