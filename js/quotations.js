import supabase from "./supabaseClient.js";
import { getRate } from "./currency.js";

const quoteForm = document.getElementById("quotation-form");
const jobSelect = document.getElementById("quote-job");
const partSelect = document.getElementById("quote-part");
const qtyInput = document.getElementById("quote-qty");
const draftList = document.getElementById("quote-draft-items");
const quoteTotal = document.getElementById("quote-total");
const quoteTable = document.getElementById("quotations-table");
const orderTable = document.getElementById("orders-table");
const quoteModal = document.getElementById("quote-edit-modal");
const orderModal = document.getElementById("order-edit-modal");

let jobs = [];
let parts = [];
let draftItems = [];
let editingQuote = null;
let editingOrder = null;
let editingQuoteDetailText = "";
let editingOrderDetailText = "";
let exchangeRate = 26.6908;

const markup = 0.25;
const SHOP_NAME = "Auto Parts and Repairs";
const SHOP_TAGLINE = "Vehicle Sales, Parts &amp; Repairs";
const SHOP_LOGO_PATH = "../assets/logo.png"; // same file already used sitewide

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function priceForCost(cost) { return Number((Number(cost || 0) * (1 + markup)).toFixed(2)); }
function totalOf(items) { return items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price_usd), 0); }
async function zigTotal(usd) { return Number((usd * await getRate()).toFixed(2)); }

function vehicleLabel(vehicle) {
  if (!vehicle) return "";
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
}

// A quotation/order's customer is either a linked registered customer, or
// a walk-in entered directly on the form — this resolves whichever applies.
function resolveCustomer(record) {
  return {
    full_name: record.customers?.full_name || record.walk_in_name || "Customer",
    phone: record.customers?.phone || record.walk_in_phone || "—",
    email: record.customers?.email || record.walk_in_email || "—",
  };
}

async function loadBaseData() {
  exchangeRate = await getRate();
  const [jobsResult, partsResult] = await Promise.all([
    supabase.from("repair_jobs").select("id, job_number, customer_id, customers(full_name), vehicles(make, model, year, license_plate)").order("created_at", { ascending: false }),
    supabase.from("parts").select("id, name, cost_price, selling_price, quantity_in_stock").order("name"),
  ]);
  if (jobsResult.error) console.error("Quotation jobs load failed:", jobsResult.error);
  if (partsResult.error) console.error("Quotation parts load failed:", partsResult.error);
  jobs = jobsResult.data || [];
  parts = partsResult.data || [];
  jobSelect.innerHTML = `<option value="">No repair job — walk-in customer</option>` + jobs.map(job => {
    const vehicle = vehicleLabel(job.vehicles);
    return `<option value="${job.id}">#${String(job.job_number).padStart(4, "0")} — ${escapeHtml(job.customers?.full_name || "Customer")} — ${escapeHtml(vehicle || "Vehicle")}</option>`;
  }).join("");
  partSelect.innerHTML = parts.map(part => `<option value="${part.id}">${escapeHtml(part.name)} — ${part.quantity_in_stock} in shop</option>`).join("");
}

function toggleWalkinFields() {
  document.getElementById("quote-walkin-fields").classList.toggle("hidden", !!jobSelect.value);
}
jobSelect.addEventListener("change", () => {
  toggleWalkinFields();
  loadRepairParts(jobSelect.value);
});

async function loadRepairParts(jobId) {
  if (!jobId) { draftItems = []; renderDraft(); return; }
  const { data, error } = await supabase.from("job_parts").select("part_id, part_name, quantity").eq("job_id", jobId);
  if (error) { console.error("Repair parts load failed:", error); return; }
  draftItems = (data || []).map(item => {
    const part = parts.find(candidate => candidate.id === item.part_id);
    const cost = part?.cost_price ?? 0;
    return { part_id: item.part_id, part_name: item.part_name, quantity: item.quantity, cost_price_usd: cost, unit_price_usd: priceForCost(cost) };
  });
  renderDraft();
}

function renderDraft() {
  if (!draftItems.length) {
    draftList.innerHTML = `<div class="empty-state"><i data-lucide="package-open"></i><span>Add parts to build the quotation.</span></div>`;
  } else {
    draftList.innerHTML = draftItems.map((item, index) => `
      <div class="quotation-line"><span><strong>${escapeHtml(item.part_name)}</strong><small>${item.quantity} × ${money(item.unit_price_usd)}</small></span><strong>${money(item.quantity * item.unit_price_usd)}</strong><button type="button" class="btn remove-quote-line" data-index="${index}"><i data-lucide="x"></i></button></div>
    `).join("");
    draftList.querySelectorAll(".remove-quote-line").forEach(button => button.addEventListener("click", () => { draftItems.splice(Number(button.dataset.index), 1); renderDraft(); }));
  }
  quoteTotal.textContent = `${money(totalOf(draftItems))} / ZiG ${Number(totalOf(draftItems) * exchangeRate).toFixed(2)}`;
  if (window.lucide) lucide.createIcons();
}

document.getElementById("quote-add-part").addEventListener("click", () => {
  const part = parts.find(candidate => candidate.id === partSelect.value);
  const quantity = parseInt(qtyInput.value, 10);
  if (!part || !Number.isInteger(quantity) || quantity < 1) return;

  const existing = draftItems.find(item => item.part_id === part.id);
  const alreadyDrafted = existing ? existing.quantity : 0;
  const inStock = Number(part.quantity_in_stock || 0);
  if (alreadyDrafted + quantity > inStock) {
    alert(`Only ${inStock} ${part.name} in stock${alreadyDrafted ? ` (${alreadyDrafted} already on this quotation)` : ""} — can't add ${quantity} more.`);
    return;
  }

  if (existing) existing.quantity += quantity;
  else draftItems.push({ part_id: part.id, part_name: part.name, quantity, cost_price_usd: part.cost_price, unit_price_usd: priceForCost(part.cost_price) });
  qtyInput.value = 1;
  renderDraft();
});

quoteForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!draftItems.length) { alert("Add at least one part to the quotation."); return; }

  const job = jobs.find(candidate => candidate.id === jobSelect.value) || null;
  let customer_id = null, walk_in_name = null, walk_in_phone = null, walk_in_email = null;
  if (job) {
    customer_id = job.customer_id;
  } else {
    walk_in_name = document.getElementById("quote-walkin-name").value.trim();
    if (!walk_in_name) { alert("Enter the customer's name, or select a repair job."); return; }
    walk_in_phone = document.getElementById("quote-walkin-phone").value.trim() || null;
    walk_in_email = document.getElementById("quote-walkin-email").value.trim() || null;
  }

  const rate = await getRate();
  const totalUsd = totalOf(draftItems);
  const { data: quote, error } = await supabase.from("quotations").insert([{
    customer_id, repair_job_id: job?.id || null, markup_pct: 25, usd_to_zig_rate: rate,
    total_usd: totalUsd, total_zig: totalUsd * rate,
    walk_in_name, walk_in_phone, walk_in_email,
  }]).select().single();
  if (error) { alert("Failed to save quotation: " + error.message); return; }
  const { error: itemsError } = await supabase.from("quotation_items").insert(draftItems.map(item => ({
    quotation_id: quote.id, part_id: item.part_id, part_name: item.part_name, quantity: item.quantity,
    cost_price_usd: item.cost_price_usd, markup_pct: 25, unit_price_usd: item.unit_price_usd,
    total_usd: item.quantity * item.unit_price_usd, unit_price_zig: item.unit_price_usd * rate, total_zig: item.quantity * item.unit_price_usd * rate,
  })));
  if (itemsError) { alert("Quotation header saved, but items failed: " + itemsError.message); return; }
  quoteForm.reset(); draftItems = []; renderDraft(); toggleWalkinFields(); await loadDocuments();
});

async function loadDocuments() {
  const [quotes, orders] = await Promise.all([
    supabase.from("quotations").select("id, quotation_number, status, total_usd, total_zig, created_at, customer_id, customers(full_name), walk_in_name, repair_job_id, repair_jobs(job_number)").order("created_at", { ascending: false }),
    supabase.from("sales_orders").select("id, order_number, status, total_usd, total_zig, created_at, customers(full_name), walk_in_name").order("created_at", { ascending: false }),
  ]);
  quoteTable.innerHTML = quotes.data?.length ? quotes.data.map(quote => `<tr><td>#${quote.quotation_number}</td><td>${escapeHtml(quote.customers?.full_name || quote.walk_in_name || "—")}</td><td>${quote.repair_jobs?.job_number ? `#${quote.repair_jobs.job_number}` : "—"}</td><td>${quote.created_at ? new Date(quote.created_at).toLocaleString() : "—"}</td><td>${escapeHtml(quote.status)}</td><td>${money(quote.total_usd)}</td><td>${Number(quote.total_zig || 0).toFixed(2)}</td><td><button type="button" class="btn edit-quote" data-id="${quote.id}"><i data-lucide="pencil"></i> Amend</button></td></tr>`).join("") : `<tr><td colspan="8" class="empty-state"><i data-lucide="file-x-2"></i><span>No quotations yet</span></td></tr>`;
  orderTable.innerHTML = orders.data?.length ? orders.data.map(order => `<tr><td>#${order.order_number}</td><td>${escapeHtml(order.customers?.full_name || order.walk_in_name || "—")}</td><td>${order.created_at ? new Date(order.created_at).toLocaleString() : "—"}</td><td>${escapeHtml(order.status)}</td><td>${money(order.total_usd)}</td><td>${Number(order.total_zig || 0).toFixed(2)}</td><td><button type="button" class="btn edit-order" data-id="${order.id}"><i data-lucide="pencil"></i> Amend</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty-state"><i data-lucide="shopping-cart"></i><span>No sales orders yet</span></td></tr>`;
  document.querySelectorAll(".edit-quote").forEach(button => button.addEventListener("click", () => openQuoteEditor(button.dataset.id)));
  document.querySelectorAll(".edit-order").forEach(button => button.addEventListener("click", () => openOrderEditor(button.dataset.id)));
  if (window.lucide) lucide.createIcons();
}

async function fetchQuote(id) {
  const richSelect = "*, quotation_items(*), customers(full_name, phone, email), repair_jobs(job_number, vehicles(make, model, year, license_plate))";
  let { data, error } = await supabase.from("quotations").select(richSelect).eq("id", id).single();
  if (error) {
    console.warn("Full quotation lookup failed, retrying with fewer fields:", error.message);
    ({ data, error } = await supabase.from("quotations").select("*, quotation_items(*), customers(full_name), repair_jobs(job_number)").eq("id", id).single());
  }
  if (error) console.error("Failed to load quotation details:", error);
  return { data, error };
}
async function fetchOrder(id) {
  const richSelect = "*, sales_order_items(*), customers(full_name, phone, email), repair_jobs(job_number, vehicles(make, model, year, license_plate))";
  let { data, error } = await supabase.from("sales_orders").select(richSelect).eq("id", id).single();
  if (error) {
    console.warn("Full sales order lookup failed, retrying with fewer fields:", error.message);
    ({ data, error } = await supabase.from("sales_orders").select("*, sales_order_items(*), customers(full_name), repair_jobs(job_number)").eq("id", id).single());
  }
  if (error) console.error("Failed to load sales order details:", error);
  return { data, error };
}

async function renderEditor(container, totalNode, items, rate = exchangeRate) {
  container.innerHTML = items.map((item, index) => `<div class="quotation-line"><span><strong>${escapeHtml(item.part_name)}</strong><small>Unit price USD</small></span><input class="amend-qty" data-index="${index}" type="number" min="1" value="${item.quantity}" /><input class="amend-price" data-index="${index}" type="number" min="0" step="0.01" value="${Number(item.unit_price_usd).toFixed(2)}" /></div>`).join("");
  const recalc = () => { const total = [...container.querySelectorAll(".amend-qty")].reduce((sum, input, index) => sum + Number(input.value || 0) * Number(container.querySelectorAll(".amend-price")[index].value || 0), 0); totalNode.textContent = `${money(total)} / ZiG ${Number(total * rate).toFixed(2)}`; };
  container.querySelectorAll("input").forEach(input => input.addEventListener("input", recalc));
  recalc();
}

// ---------- Customer-facing text (for copy / email / WhatsApp) ----------
// Cost price and markup % are deliberately left out — showing the markup
// to the customer makes the price look inflated, even though it's the
// same math either way. Just the final unit price and total.

function buildDetailText(record, kind, items) {
  const customer = resolveCustomer(record);
  const job = record.repair_jobs || {};
  const vehicle = job.vehicles || {};
  const lines = (items || []).map(item =>
    `  • ${item.quantity} × ${item.part_name} — ${money(item.unit_price_usd)} each = ${money(item.total_usd)} / ZiG ${Number(item.total_zig).toFixed(2)}`
  ).join("\n");
  const number = kind === "Quotation" ? record.quotation_number : record.order_number;

  return [
    `${SHOP_NAME}`,
    `${kind} #${number}`,
    `Status: ${record.status}`,
    `Date: ${record.created_at ? new Date(record.created_at).toLocaleString() : "—"}`,
    ``,
    `Customer: ${customer.full_name}`,
    `Phone: ${customer.phone}`,
    `Email: ${customer.email}`,
    ``,
    job.job_number ? `Repair Job: #${String(job.job_number).padStart(4, "0")}` : null,
    job.job_number ? `Vehicle: ${vehicleLabel(vehicle) || "—"}${vehicle.license_plate ? ` (${vehicle.license_plate})` : ""}` : null,
    job.job_number ? `` : null,
    `Items:`,
    lines || "  (no line items)",
    ``,
    `Exchange rate: 1 USD = ${Number(record.usd_to_zig_rate).toFixed(4)} ZiG`,
    `Total: ${money(record.total_usd)} / ZiG ${Number(record.total_zig).toFixed(2)}`,
  ].filter(line => line !== null).join("\n");
}

// ---------- Branded visual preview (with logo, no markup shown) ----------

function buildDetailHtml(record, kind, items) {
  const customer = resolveCustomer(record);
  const job = record.repair_jobs || {};
  const vehicle = job.vehicles || {};
  const number = kind === "Quotation" ? record.quotation_number : record.order_number;
  const rows = (items || []).map(item => `
    <tr><td>${escapeHtml(item.part_name)}</td><td>${item.quantity}</td><td>${money(item.unit_price_usd)}</td><td>${money(item.quantity * item.unit_price_usd)}</td></tr>
  `).join("") || `<tr><td colspan="4">No line items</td></tr>`;

  return `
    <header class="receipt-header">
      <div class="receipt-brand">
        <img src="${SHOP_LOGO_PATH}" alt="${SHOP_NAME}" class="receipt-logo" />
        <div class="receipt-address">${SHOP_NAME}<br>${SHOP_TAGLINE}</div>
      </div>
      <div class="receipt-meta"><strong>${kind.toUpperCase()} #${number}</strong>${record.created_at ? new Date(record.created_at).toLocaleString() : ""}</div>
    </header>
    <h3>Customer</h3>
    <div class="receipt-customer">${escapeHtml(customer.full_name)}<br>${escapeHtml(customer.phone)}</div>
    ${job.job_number ? `<h3>Repair Job</h3><div class="receipt-customer">#${String(job.job_number).padStart(4, "0")} · ${escapeHtml(vehicleLabel(vehicle) || "Vehicle")}</div>` : ""}
    <h3>Items</h3>
    <table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="receipt-total"><span>Total</span><strong>${money(record.total_usd)} / ZiG ${Number(record.total_zig || 0).toFixed(2)}</strong></div>
    <p class="receipt-note">${kind === "Quotation" ? "This quotation is valid for 7 days." : `Thank you for choosing ${SHOP_NAME}.`}</p>`;
}

// ---------- Send actions (email / WhatsApp) ----------

function sendByEmail(detailText, customer, subjectPrefix) {
  const email = (customer?.email && customer.email !== "—" ? customer.email : "").trim() || prompt("Customer email address:");
  if (!email) return;
  const subject = encodeURIComponent(subjectPrefix);
  const body = encodeURIComponent(detailText);
  window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
}

function sendByWhatsApp(detailText, customer) {
  let phone = (customer?.phone && customer.phone !== "—" ? customer.phone : "").trim() || prompt("Customer WhatsApp number (include country code, e.g. +263771234567):");
  if (!phone) return;
  phone = phone.replace(/[^\d]/g, "");
  const text = encodeURIComponent(detailText);
  window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
}

function copyDetailText(text, statusNode) {
  navigator.clipboard.writeText(text).then(() => {
    if (statusNode) { statusNode.textContent = "Copied."; setTimeout(() => { statusNode.textContent = ""; }, 2500); }
  }).catch(() => {
    if (statusNode) statusNode.textContent = "Couldn't copy — select and copy manually.";
  });
}

// ---------- Quotation editor ----------

async function openQuoteEditor(id) {
  const { data, error } = await fetchQuote(id);
  if (!data) { alert("Couldn't load that quotation" + (error ? `: ${error.message}` : ".")); return; }
  editingQuote = data;
  setText("edit-quote-number", editingQuote.quotation_number);
  editingQuoteDetailText = buildDetailText(editingQuote, "Quotation", editingQuote.quotation_items);
  document.getElementById("quote-detail-text").innerHTML = buildDetailHtml(editingQuote, "Quotation", editingQuote.quotation_items);
  await renderEditor(document.getElementById("edit-quote-lines"), document.getElementById("edit-quote-total"), editingQuote.quotation_items, editingQuote.usd_to_zig_rate);
  quoteModal.classList.remove("hidden"); quoteModal.style.display = "flex";
  if (window.lucide) lucide.createIcons();
}
async function saveQuoteChanges() {
  if (!editingQuote) return;
  const inputs = [...document.querySelectorAll("#edit-quote-lines .amend-qty")]; const prices = [...document.querySelectorAll("#edit-quote-lines .amend-price")]; const rate = editingQuote.usd_to_zig_rate;
  let total = 0;
  for (let i = 0; i < editingQuote.quotation_items.length; i++) { const quantity = Number(inputs[i].value); const unit = Number(prices[i].value); total += quantity * unit; await supabase.from("quotation_items").update({ quantity, unit_price_usd: unit, total_usd: quantity * unit, unit_price_zig: unit * rate, total_zig: quantity * unit * rate }).eq("id", editingQuote.quotation_items[i].id); }
  await supabase.from("quotations").update({ total_usd: total, total_zig: total * rate, updated_at: new Date().toISOString(), status: "Amended" }).eq("id", editingQuote.id);
  closeModal(quoteModal); await loadDocuments();
}
async function createOrderFromQuote() {
  if (!editingQuote) return;
  const { data: order, error } = await supabase.from("sales_orders").insert([{
    quotation_id: editingQuote.id, customer_id: editingQuote.customer_id, repair_job_id: editingQuote.repair_job_id,
    walk_in_name: editingQuote.walk_in_name, walk_in_phone: editingQuote.walk_in_phone, walk_in_email: editingQuote.walk_in_email,
    usd_to_zig_rate: editingQuote.usd_to_zig_rate, total_usd: editingQuote.total_usd, total_zig: editingQuote.total_zig, status: "Draft",
  }]).select().single();
  if (error) { alert("Failed to confirm sales order: " + error.message); return; }
  const items = editingQuote.quotation_items.map(item => ({ sales_order_id: order.id, part_id: item.part_id, part_name: item.part_name, quantity: item.quantity, unit_price_usd: item.unit_price_usd, total_usd: item.total_usd, unit_price_zig: item.unit_price_zig, total_zig: item.total_zig }));
  await supabase.from("sales_order_items").insert(items); closeModal(quoteModal); await loadDocuments();
}

// ---------- Sales order editor ----------

let salespeople = [];
async function loadSalespeople() {
  const { data, error } = await supabase.from("technician_directory").select("id, full_name").eq("is_active", true).order("full_name");
  if (error) { console.error("Error loading employees for salesperson list:", error); return; }
  salespeople = data || [];
  const select = document.getElementById("edit-order-salesperson");
  if (select) {
    select.innerHTML = `<option value="">No salesperson — no commission</option>` + salespeople.map(s => `<option value="${s.id}">${escapeHtml(s.full_name)}</option>`).join("");
  }
}

async function openOrderEditor(id) {
  const { data, error } = await fetchOrder(id);
  if (!data) { alert("Couldn't load that sales order" + (error ? `: ${error.message}` : ".")); return; }
  editingOrder = data;
  setText("edit-order-number", editingOrder.order_number);
  editingOrderDetailText = buildDetailText(editingOrder, "Sales Order", editingOrder.sales_order_items);
  document.getElementById("order-detail-text").innerHTML = buildDetailHtml(editingOrder, "Sales Order", editingOrder.sales_order_items);
  await renderEditor(document.getElementById("edit-order-lines"), document.getElementById("edit-order-total"), editingOrder.sales_order_items, editingOrder.usd_to_zig_rate);
  if (!salespeople.length) await loadSalespeople();
  const salespersonSelect = document.getElementById("edit-order-salesperson");
  if (salespersonSelect) salespersonSelect.value = editingOrder.salesperson_id || "";
  orderModal.classList.remove("hidden"); orderModal.style.display = "flex";
  if (window.lucide) lucide.createIcons();
}
async function saveOrderChanges() {
  if (!editingOrder) return;
  const inputs = [...document.querySelectorAll("#edit-order-lines .amend-qty")]; const prices = [...document.querySelectorAll("#edit-order-lines .amend-price")]; const rate = Number(editingOrder.usd_to_zig_rate || exchangeRate); let total = 0;
  for (let i = 0; i < editingOrder.sales_order_items.length; i++) { const quantity = Number(inputs[i].value); const unit = Number(prices[i].value); total += quantity * unit; await supabase.from("sales_order_items").update({ quantity, unit_price_usd: unit, total_usd: quantity * unit, unit_price_zig: unit * rate, total_zig: quantity * unit * rate }).eq("id", editingOrder.sales_order_items[i].id); }
  const salespersonId = document.getElementById("edit-order-salesperson")?.value || null;
  await supabase.from("sales_orders").update({ total_usd: total, total_zig: total * rate, status: "Confirmed", salesperson_id: salespersonId, updated_at: new Date().toISOString() }).eq("id", editingOrder.id);

  const receiptOk = await ensureReceiptForOrder(editingOrder.id, total);
  closeModal(orderModal);
  await loadDocuments();

  if (receiptOk && confirm("Sales order saved and a receipt has been recorded. View the printed receipt now?")) {
    window.location.href = `receipts.html?order=${encodeURIComponent(editingOrder.id)}`;
  }
}

// Creates (or confirms the existence of) a receipt tied to this sales
// order — this is what makes the amount show up in the Receipts page and
// in the dashboard's revenue figures.
async function ensureReceiptForOrder(orderId, amount) {
  const { data: existing } = await supabase.from("receipts").select("id").eq("sales_order_id", orderId).limit(1);
  if (existing && existing.length) return true;
  const { error } = await supabase.from("receipts").insert([{ sales_order_id: orderId, amount }]);
  if (error) {
    console.error("Failed to create receipt for sales order:", error);
    alert("Order saved, but the receipt couldn't be created: " + error.message);
    return false;
  }
  return true;
}

function closeModal(modal) { modal.classList.add("hidden"); modal.style.display = "none"; }

// ---------- Wire up static buttons ----------

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
  else console.warn(`quotations.js: expected an element with id="${id}" but it isn't on this page — make sure quotations.html matches this quotations.js.`);
}
function on(id, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener("click", handler);
  else console.warn(`quotations.js: expected an element with id="${id}" but it isn't on this page — that button won't work until the HTML matches.`);
}

on("edit-quote-save", saveQuoteChanges);
on("edit-quote-order", createOrderFromQuote);
on("edit-quote-cancel", () => closeModal(quoteModal));
on("edit-order-save", saveOrderChanges);
on("edit-order-cancel", () => closeModal(orderModal));

on("quote-detail-copy", () => copyDetailText(editingQuoteDetailText, document.getElementById("quote-detail-copy-status")));
on("quote-detail-email", () => editingQuote && sendByEmail(editingQuoteDetailText, resolveCustomer(editingQuote), `Quotation #${editingQuote.quotation_number} — ${SHOP_NAME}`));
on("quote-detail-whatsapp", () => editingQuote && sendByWhatsApp(editingQuoteDetailText, resolveCustomer(editingQuote)));

on("order-detail-copy", () => copyDetailText(editingOrderDetailText, document.getElementById("order-detail-copy-status")));
on("order-detail-email", () => editingOrder && sendByEmail(editingOrderDetailText, resolveCustomer(editingOrder), `Sales Order #${editingOrder.order_number} — ${SHOP_NAME}`));
on("order-detail-whatsapp", () => editingOrder && sendByWhatsApp(editingOrderDetailText, resolveCustomer(editingOrder)));

document.addEventListener("DOMContentLoaded", async () => {
  toggleWalkinFields();
  try {
    await loadBaseData();
    const requestedJob = new URLSearchParams(window.location.search).get("job");
    if (requestedJob && jobs.some(job => job.id === requestedJob)) {
      jobSelect.value = requestedJob;
      toggleWalkinFields();
      await loadRepairParts(requestedJob);
    }
  } catch (err) {
    console.error("Failed to load jobs/parts:", err);
    if (jobSelect) jobSelect.innerHTML = `<option value="">Couldn't load repair jobs — check the console</option>`;
  }

  try {
    await loadDocuments();
  } catch (err) {
    console.error("Failed to load quotations/orders:", err);
    if (quoteTable) quoteTable.innerHTML = `<tr><td colspan="8" class="empty-state">Couldn't load quotations — check the console for details</td></tr>`;
    if (orderTable) orderTable.innerHTML = `<tr><td colspan="7" class="empty-state">Couldn't load sales orders — check the console for details</td></tr>`;
  }
});