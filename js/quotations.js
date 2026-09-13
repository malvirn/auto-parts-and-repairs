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
  jobSelect.innerHTML = `<option value="">Select a repair job…</option>` + jobs.map(job => {
    const vehicle = vehicleLabel(job.vehicles);
    return `<option value="${job.id}">#${String(job.job_number).padStart(4, "0")} — ${escapeHtml(job.customers?.full_name || "Customer")} — ${escapeHtml(vehicle || "Vehicle")}</option>`;
  }).join("");
  partSelect.innerHTML = parts.map(part => `<option value="${part.id}">${escapeHtml(part.name)} — ${part.quantity_in_stock} in shop</option>`).join("");
}

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
    draftList.innerHTML = `<div class="empty-state"><i data-lucide="package-open"></i><span>Select a repair job and add parts.</span></div>`;
  } else {
    draftList.innerHTML = draftItems.map((item, index) => `
      <div class="quotation-line"><span><strong>${escapeHtml(item.part_name)}</strong><small>${item.quantity} × ${money(item.unit_price_usd)} (25% markup)</small></span><strong>${money(item.quantity * item.unit_price_usd)}</strong><button type="button" class="btn remove-quote-line" data-index="${index}"><i data-lucide="x"></i></button></div>
    `).join("");
    draftList.querySelectorAll(".remove-quote-line").forEach(button => button.addEventListener("click", () => { draftItems.splice(Number(button.dataset.index), 1); renderDraft(); }));
  }
  quoteTotal.textContent = `${money(totalOf(draftItems))} / ZiG ${Number(totalOf(draftItems) * exchangeRate).toFixed(2)}`;
  if (window.lucide) lucide.createIcons();
}

jobSelect.addEventListener("change", () => loadRepairParts(jobSelect.value));
document.getElementById("quote-add-part").addEventListener("click", () => {
  const part = parts.find(candidate => candidate.id === partSelect.value);
  const quantity = parseInt(qtyInput.value, 10);
  if (!part || !Number.isInteger(quantity) || quantity < 1) return;
  const existing = draftItems.find(item => item.part_id === part.id);
  if (existing) existing.quantity += quantity;
  else draftItems.push({ part_id: part.id, part_name: part.name, quantity, cost_price_usd: part.cost_price, unit_price_usd: priceForCost(part.cost_price) });
  qtyInput.value = 1;
  renderDraft();
});

quoteForm.addEventListener("submit", async event => {
  event.preventDefault();
  const job = jobs.find(candidate => candidate.id === jobSelect.value);
  if (!job || !draftItems.length) { alert("Select a repair job and add at least one part."); return; }
  const rate = await getRate();
  const totalUsd = totalOf(draftItems);
  const { data: quote, error } = await supabase.from("quotations").insert([{
    customer_id: job.customer_id, repair_job_id: job.id, markup_pct: 25, usd_to_zig_rate: rate,
    total_usd: totalUsd, total_zig: totalUsd * rate, notes: document.getElementById("quote-notes").value.trim() || null,
  }]).select().single();
  if (error) { alert("Failed to save quotation: " + error.message); return; }
  const { error: itemsError } = await supabase.from("quotation_items").insert(draftItems.map(item => ({
    quotation_id: quote.id, part_id: item.part_id, part_name: item.part_name, quantity: item.quantity,
    cost_price_usd: item.cost_price_usd, markup_pct: 25, unit_price_usd: item.unit_price_usd,
    total_usd: item.quantity * item.unit_price_usd, unit_price_zig: item.unit_price_usd * rate, total_zig: item.quantity * item.unit_price_usd * rate,
  })));
  if (itemsError) { alert("Quotation header saved, but items failed: " + itemsError.message); return; }
  quoteForm.reset(); draftItems = []; renderDraft(); await loadDocuments();
});

async function loadDocuments() {
  const [quotes, orders] = await Promise.all([
    supabase.from("quotations").select("id, quotation_number, status, total_usd, total_zig, customer_id, customers(full_name), repair_job_id, repair_jobs(job_number)").order("created_at", { ascending: false }),
    supabase.from("sales_orders").select("id, order_number, status, total_usd, total_zig, customers(full_name)").order("created_at", { ascending: false }),
  ]);
  quoteTable.innerHTML = quotes.data?.length ? quotes.data.map(quote => `<tr><td>#${quote.quotation_number}</td><td>${escapeHtml(quote.customers?.full_name || "—")}</td><td>${quote.repair_jobs?.job_number ? `#${quote.repair_jobs.job_number}` : "—"}</td><td>${escapeHtml(quote.status)}</td><td>${money(quote.total_usd)}</td><td>${Number(quote.total_zig || 0).toFixed(2)}</td><td><button type="button" class="btn edit-quote" data-id="${quote.id}"><i data-lucide="pencil"></i> Amend</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty-state"><i data-lucide="file-x-2"></i><span>No quotations yet</span></td></tr>`;
  orderTable.innerHTML = orders.data?.length ? orders.data.map(order => `<tr><td>#${order.order_number}</td><td>${escapeHtml(order.customers?.full_name || "—")}</td><td>${escapeHtml(order.status)}</td><td>${money(order.total_usd)}</td><td>${Number(order.total_zig || 0).toFixed(2)}</td><td><button type="button" class="btn edit-order" data-id="${order.id}"><i data-lucide="pencil"></i> Amend</button></td></tr>`).join("") : `<tr><td colspan="6" class="empty-state"><i data-lucide="shopping-cart"></i><span>No sales orders yet</span></td></tr>`;
  document.querySelectorAll(".edit-quote").forEach(button => button.addEventListener("click", () => openQuoteEditor(button.dataset.id)));
  document.querySelectorAll(".edit-order").forEach(button => button.addEventListener("click", () => openOrderEditor(button.dataset.id)));
  if (window.lucide) lucide.createIcons();
}

// customers(full_name, phone, email) and the vehicle chain are pulled in
// here specifically so the full-text detail view and the send actions
// have contact info and vehicle context to work with. If your customers
// table doesn't have phone/email columns (or vehicles isn't linked the
// same way), that richer query errors out — so this falls back to a
// bare-bones query rather than leaving the Amend button doing nothing.
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
  container.innerHTML = items.map((item, index) => `<div class="quotation-line"><span><strong>${escapeHtml(item.part_name)}</strong><small>Cost ${money(item.cost_price_usd || 0)} · Unit price USD</small></span><input class="amend-qty" data-index="${index}" type="number" min="1" value="${item.quantity}" /><input class="amend-price" data-index="${index}" type="number" min="0" step="0.01" value="${Number(item.unit_price_usd).toFixed(2)}" /></div>`).join("");
  const recalc = () => { const total = [...container.querySelectorAll(".amend-qty")].reduce((sum, input, index) => sum + Number(input.value || 0) * Number(container.querySelectorAll(".amend-price")[index].value || 0), 0); totalNode.textContent = `${money(total)} / ZiG ${Number(total * rate).toFixed(2)}`; };
  container.querySelectorAll("input").forEach(input => input.addEventListener("input", recalc));
  recalc();
}

// ---------- Full text detail rendering ----------

function buildQuoteDetailText(quote) {
  const customer = quote.customers || {};
  const job = quote.repair_jobs || {};
  const vehicle = job.vehicles || {};
  const lines = (quote.quotation_items || []).map(item =>
    `  • ${item.quantity} × ${item.part_name} — ${money(item.unit_price_usd)} each (cost ${money(item.cost_price_usd)}, ${Number(item.markup_pct)}% markup) = ${money(item.total_usd)} / ZiG ${Number(item.total_zig).toFixed(2)}`
  ).join("\n");

  return [
    `${SHOP_NAME}`,
    `Quotation #${quote.quotation_number}`,
    `Status: ${quote.status}`,
    `Date: ${quote.created_at ? new Date(quote.created_at).toLocaleString() : "—"}`,
    ``,
    `Customer: ${customer.full_name || "—"}`,
    `Phone: ${customer.phone || "—"}`,
    `Email: ${customer.email || "—"}`,
    ``,
    `Repair Job: ${job.job_number ? "#" + String(job.job_number).padStart(4, "0") : "—"}`,
    `Vehicle: ${vehicleLabel(vehicle) || "—"}${vehicle.license_plate ? ` (${vehicle.license_plate})` : ""}`,
    ``,
    `Notes: ${quote.notes || "—"}`,
    ``,
    `Parts & Labour:`,
    lines || "  (no line items)",
    ``,
    `Exchange rate: 1 USD = ${Number(quote.usd_to_zig_rate).toFixed(4)} ZiG`,
    `Total: ${money(quote.total_usd)} / ZiG ${Number(quote.total_zig).toFixed(2)}`,
  ].join("\n");
}

function buildOrderDetailText(order) {
  const customer = order.customers || {};
  const job = order.repair_jobs || {};
  const vehicle = job.vehicles || {};
  const lines = (order.sales_order_items || []).map(item =>
    `  • ${item.quantity} × ${item.part_name} — ${money(item.unit_price_usd)} each = ${money(item.total_usd)} / ZiG ${Number(item.total_zig).toFixed(2)}`
  ).join("\n");

  return [
    `${SHOP_NAME}`,
    `Sales Order #${order.order_number}`,
    `Status: ${order.status}`,
    `Date: ${order.created_at ? new Date(order.created_at).toLocaleString() : "—"}`,
    ``,
    `Customer: ${customer.full_name || "—"}`,
    `Phone: ${customer.phone || "—"}`,
    `Email: ${customer.email || "—"}`,
    ``,
    `Repair Job: ${job.job_number ? "#" + String(job.job_number).padStart(4, "0") : "—"}`,
    `Vehicle: ${vehicleLabel(vehicle) || "—"}${vehicle.license_plate ? ` (${vehicle.license_plate})` : ""}`,
    ``,
    `Parts & Labour:`,
    lines || "  (no line items)",
    ``,
    `Exchange rate: 1 USD = ${Number(order.usd_to_zig_rate).toFixed(4)} ZiG`,
    `Total: ${money(order.total_usd)} / ZiG ${Number(order.total_zig).toFixed(2)}`,
  ].join("\n");
}

// ---------- Send actions (email / WhatsApp) ----------
// No email/SMS backend is wired up here — these open the customer's
// own email client (mailto:) or WhatsApp (wa.me) pre-filled with the
// quotation text, which needs no server or API key. If you later want
// it sent automatically without the staff member clicking "send" in
// their own client, that requires a backend email/WhatsApp API
// integration instead.

function sendByEmail(detailText, customer, subjectPrefix) {
  const email = (customer?.email || "").trim() || prompt("Customer email address:");
  if (!email) return;
  const subject = encodeURIComponent(subjectPrefix);
  const body = encodeURIComponent(detailText);
  window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
}

function sendByWhatsApp(detailText, customer) {
  let phone = (customer?.phone || "").trim() || prompt("Customer WhatsApp number (include country code, e.g. +263771234567):");
  if (!phone) return;
  phone = phone.replace(/[^\d]/g, "");
  const text = encodeURIComponent(detailText);
  // wa.me hands off to the installed WhatsApp app on phones (opening
  // straight into this contact's chat with the message pre-filled) and
  // falls back to WhatsApp Web on desktops without the app installed.
  window.open(`https://wa.me/${phone}?text=${text}`, "_blank");
}

function copyDetailText(text, statusNode) {
  navigator.clipboard.writeText(text).then(() => {
    if (statusNode) {
      statusNode.textContent = "Copied.";
      setTimeout(() => { statusNode.textContent = ""; }, 2500);
    }
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
  editingQuoteDetailText = buildQuoteDetailText(editingQuote);
  setText("quote-detail-text", editingQuoteDetailText);
  await renderEditor(document.getElementById("edit-quote-lines"), document.getElementById("edit-quote-total"), editingQuote.quotation_items, editingQuote.usd_to_zig_rate);
  quoteModal.classList.remove("hidden"); quoteModal.style.display = "flex";
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
  const { data: order, error } = await supabase.from("sales_orders").insert([{ quotation_id: editingQuote.id, customer_id: editingQuote.customer_id, repair_job_id: editingQuote.repair_job_id, usd_to_zig_rate: editingQuote.usd_to_zig_rate, total_usd: editingQuote.total_usd, total_zig: editingQuote.total_zig, status: "Draft" }]).select().single();
  if (error) { alert("Failed to create sales order: " + error.message); return; }
  const items = editingQuote.quotation_items.map(item => ({ sales_order_id: order.id, part_id: item.part_id, part_name: item.part_name, quantity: item.quantity, unit_price_usd: item.unit_price_usd, total_usd: item.total_usd, unit_price_zig: item.unit_price_zig, total_zig: item.total_zig }));
  await supabase.from("sales_order_items").insert(items); closeModal(quoteModal); await loadDocuments();
}

// ---------- Sales order editor ----------

async function openOrderEditor(id) {
  const { data, error } = await fetchOrder(id);
  if (!data) { alert("Couldn't load that sales order" + (error ? `: ${error.message}` : ".")); return; }
  editingOrder = data;
  setText("edit-order-number", editingOrder.order_number);
  editingOrderDetailText = buildOrderDetailText(editingOrder);
  setText("order-detail-text", editingOrderDetailText);
  await renderEditor(document.getElementById("edit-order-lines"), document.getElementById("edit-order-total"), editingOrder.sales_order_items, editingOrder.usd_to_zig_rate);
  orderModal.classList.remove("hidden"); orderModal.style.display = "flex";
}
async function saveOrderChanges() {
  if (!editingOrder) return;
  const inputs = [...document.querySelectorAll("#edit-order-lines .amend-qty")]; const prices = [...document.querySelectorAll("#edit-order-lines .amend-price")]; const rate = Number(editingOrder.usd_to_zig_rate || exchangeRate); let total = 0;
  for (let i = 0; i < editingOrder.sales_order_items.length; i++) { const quantity = Number(inputs[i].value); const unit = Number(prices[i].value); total += quantity * unit; await supabase.from("sales_order_items").update({ quantity, unit_price_usd: unit, total_usd: quantity * unit, unit_price_zig: unit * rate, total_zig: quantity * unit * rate }).eq("id", editingOrder.sales_order_items[i].id); }
  await supabase.from("sales_orders").update({ total_usd: total, total_zig: total * rate, status: "Amended", updated_at: new Date().toISOString() }).eq("id", editingOrder.id);
  closeModal(orderModal); await loadDocuments();
}

function closeModal(modal) { modal.classList.add("hidden"); modal.style.display = "none"; }

// ---------- Wire up static buttons ----------

// on(id, handler) wires a click listener only if the element actually
// exists on the page. A single missing/renamed element used to throw
// here and halt the whole module — which meant every load below this
// point (jobs, parts, quotations, sales orders) silently never ran.
// This makes each binding independent so one mismatch can't take the
// rest of the page down with it.
// setText writes to an element only if it exists — so an HTML file that's
// out of sync with this JS (missing an id) logs a clear warning instead of
// throwing and silently killing whatever function called it (e.g. Amend
// opening the modal never completing).
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
on("quote-detail-email", () => editingQuote && sendByEmail(editingQuoteDetailText, editingQuote.customers, `Quotation #${editingQuote.quotation_number} — ${SHOP_NAME}`));
on("quote-detail-whatsapp", () => editingQuote && sendByWhatsApp(editingQuoteDetailText, editingQuote.customers));

on("order-detail-copy", () => copyDetailText(editingOrderDetailText, document.getElementById("order-detail-copy-status")));
on("order-detail-email", () => editingOrder && sendByEmail(editingOrderDetailText, editingOrder.customers, `Sales Order #${editingOrder.order_number} — ${SHOP_NAME}`));
on("order-detail-whatsapp", () => editingOrder && sendByWhatsApp(editingOrderDetailText, editingOrder.customers));

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadBaseData();
    const requestedJob = new URLSearchParams(window.location.search).get("job");
    if (requestedJob && jobs.some(job => job.id === requestedJob)) {
      jobSelect.value = requestedJob;
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
    if (quoteTable) quoteTable.innerHTML = `<tr><td colspan="7" class="empty-state">Couldn't load quotations — check the console for details</td></tr>`;
    if (orderTable) orderTable.innerHTML = `<tr><td colspan="6" class="empty-state">Couldn't load sales orders — check the console for details</td></tr>`;
  }
});