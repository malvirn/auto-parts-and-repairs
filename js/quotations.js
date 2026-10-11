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
    supabase.from("repair_jobs").select("id, job_number, cro_number, customer_id, status, fault_reported, diagnosis, labour_cost, labour_hours, fuel_level_in, odometer_in, driver_name, driver_phone, customers(full_name, phone, email, customer_type), vehicles(make, model, year, license_plate, chassis_number, engine_number, body_type), vehicle_rate_tiers(tier_name, hourly_rate)").order("created_at", { ascending: false }),
    supabase.from("parts").select("id, name, cost_price, selling_price, quantity_in_stock").order("name"),
  ]);
  if (jobsResult.error) console.error("Quotation jobs load failed:", jobsResult.error);
  if (partsResult.error) console.error("Quotation parts load failed:", partsResult.error);
  jobs = jobsResult.data || [];
  parts = partsResult.data || [];
  jobSelect.innerHTML = `<option value="">No job card — walk-in customer</option>` + jobs.map(job => {
    const vehicle = vehicleLabel(job.vehicles);
    const plate = job.vehicles?.license_plate ? ` (${job.vehicles.license_plate})` : "";
    return `<option value="${job.id}">${escapeHtml(jobRef(job))} — ${escapeHtml(job.customers?.full_name || "Customer")} — ${escapeHtml((vehicle || "Vehicle") + plate)}</option>`;
  }).join("");
  partSelect.innerHTML = parts.map(part => `<option value="${part.id}">${escapeHtml(part.name)} — ${part.quantity_in_stock} in shop</option>`).join("");
}

function jobRef(job) {
  if (!job) return "";
  return job.cro_number || `#${String(job.job_number).padStart(4, "0")}`;
}

function toggleWalkinFields() {
  document.getElementById("quote-walkin-fields").classList.toggle("hidden", !!jobSelect.value);
}
jobSelect.addEventListener("change", () => {
  toggleWalkinFields();
  loadFromJob(jobSelect.value);
});

// Everything on the job card comes across to the quotation except the
// assigned mechanic: customer, vehicle, fault, diagnosis, labour, parts and
// incidentals, at the same prices as on the job card.
function renderJobSummary(job) {
  const box = document.getElementById("quote-job-summary");
  if (!box) return;
  if (!job) { box.innerHTML = ""; box.classList.add("hidden"); return; }
  const c = job.customers || {};
  const v = job.vehicles || {};
  const cell = (label, value) => `<div><span>${label}</span><b>${value ? escapeHtml(String(value)) : "—"}</b></div>`;
  box.innerHTML = `
    <p class="qjs-title">From job card ${escapeHtml(jobRef(job))}</p>
    <div class="qjs-grid">
      ${cell(c.customer_type === "company" ? "Company" : "Customer", c.full_name)}
      ${cell("Phone", c.phone)}
      ${cell("Email", c.email)}
      ${c.customer_type === "company" ? cell("Brought in by", [job.driver_name, job.driver_phone].filter(Boolean).join(" · ")) : ""}
      ${cell("Vehicle", vehicleLabel(v))}
      ${cell("Number plate", v.license_plate)}
      ${cell("Chassis no.", v.chassis_number)}
      ${cell("Engine no.", v.engine_number)}
      ${cell("Fuel in", job.fuel_level_in)}
      ${cell("Odometer in", job.odometer_in != null ? Number(job.odometer_in).toLocaleString() + " km" : "")}
    </div>
    <div class="qjs-text"><span>Fault reported</span><p>${escapeHtml(job.fault_reported || "—")}</p></div>
    <div class="qjs-text"><span>Diagnosis</span><p>${escapeHtml(job.diagnosis || "Not diagnosed yet")}</p></div>`;
  box.classList.remove("hidden");
}

function labourLabel(job) {
  const tier = job.vehicle_rate_tiers;
  const hours = Number(job.labour_hours) || 0;
  return "Labour" + (tier ? ` — ${tier.tier_name} @ ${money(tier.hourly_rate)}/hr` : "") + (hours ? ` × ${hours} h` : "");
}

async function loadFromJob(jobId) {
  const job = jobs.find(candidate => candidate.id === jobId) || null;
  renderJobSummary(job);
  if (!job) { draftItems = []; renderDraft(); return; }
  const [partsRes, incRes] = await Promise.all([
    supabase.from("job_parts").select("part_id, part_name, quantity, price_at_time").eq("job_id", jobId),
    supabase.from("job_incidentals").select("description, amount").eq("job_id", jobId).order("created_at"),
  ]);
  if (partsRes.error) console.error("Repair parts load failed:", partsRes.error);
  if (incRes.error) console.error("Incidentals load failed:", incRes.error);
  if (jobSelect.value !== jobId) return; // selection changed while loading

  const items = (partsRes.data || []).map(item => {
    const part = parts.find(candidate => candidate.id === item.part_id);
    const cost = Number(part?.cost_price ?? 0);
    const unit = item.price_at_time != null ? Number(item.price_at_time) : priceForCost(cost);
    return { kind: "part", part_id: item.part_id, part_name: item.part_name, quantity: item.quantity, cost_price_usd: cost, unit_price_usd: unit };
  });
  if (Number(job.labour_cost) > 0) {
    items.push({ kind: "labour", part_id: null, part_name: labourLabel(job), quantity: 1, cost_price_usd: 0, unit_price_usd: Number(job.labour_cost) });
  }
  (incRes.data || []).forEach(inc => {
    items.push({ kind: "incidental", part_id: null, part_name: `${inc.description} (incidental)`, quantity: 1, cost_price_usd: 0, unit_price_usd: Number(inc.amount) });
  });
  draftItems = items;
  renderDraft();
}

function markupPctFor(item) {
  const cost = Number(item.cost_price_usd) || 0;
  if (!item.part_id || cost <= 0) return 0;
  return Number(((Number(item.unit_price_usd) / cost - 1) * 100).toFixed(2));
}

function renderDraft() {
  if (!draftItems.length) {
    draftList.innerHTML = `<div class="empty-state"><i data-lucide="package-open"></i><span>Add parts to build the quotation.</span></div>`;
  } else {
    draftList.innerHTML = draftItems.map((item, index) => `
      <div class="quotation-line"><span><strong>${escapeHtml(item.part_name)}</strong><small>${item.kind === "labour" ? "Labour" : item.kind === "incidental" ? "Incidental" : "Part"} · ${item.quantity} × ${money(item.unit_price_usd)}</small></span><strong>${money(item.quantity * item.unit_price_usd)}</strong><button type="button" class="btn remove-quote-line" data-index="${index}"><i data-lucide="x"></i></button></div>
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
  else draftItems.push({ kind: "part", part_id: part.id, part_name: part.name, quantity, cost_price_usd: part.cost_price, unit_price_usd: priceForCost(part.cost_price) });
  qtyInput.value = 1;
  renderDraft();
});

quoteForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!draftItems.length) { alert("Add at least one line to the quotation."); return; }

  const job = jobs.find(candidate => candidate.id === jobSelect.value) || null;
  let customer_id = null, walk_in_name = null, walk_in_phone = null, walk_in_email = null;
  if (job) {
    customer_id = job.customer_id;
  } else {
    walk_in_name = document.getElementById("quote-walkin-name").value.trim();
    if (!walk_in_name) { alert("Enter the customer's name, or select a job card."); return; }
    walk_in_phone = document.getElementById("quote-walkin-phone").value.trim() || null;
    walk_in_email = document.getElementById("quote-walkin-email").value.trim() || null;
  }

  const rate = await getRate();
  const totalUsd = totalOf(draftItems);
  const notes = job ? [`Fault reported: ${job.fault_reported || "—"}`, `Diagnosis: ${job.diagnosis || "Not diagnosed yet"}`].join("\n") : null;
  const { data: quote, error } = await supabase.from("quotations").insert([{
    customer_id, repair_job_id: job?.id || null, markup_pct: 25, usd_to_zig_rate: rate,
    total_usd: totalUsd, total_zig: totalUsd * rate,
    walk_in_name, walk_in_phone, walk_in_email, notes,
  }]).select().single();
  if (error) { alert("Failed to save quotation: " + error.message); return; }
  const { error: itemsError } = await supabase.from("quotation_items").insert(draftItems.map(item => ({
    quotation_id: quote.id, part_id: item.part_id, part_name: item.part_name, quantity: item.quantity,
    cost_price_usd: Number(item.cost_price_usd) || 0, markup_pct: markupPctFor(item), unit_price_usd: item.unit_price_usd,
    total_usd: item.quantity * item.unit_price_usd, unit_price_zig: item.unit_price_usd * rate, total_zig: item.quantity * item.unit_price_usd * rate,
  })));
  if (itemsError) { alert("Quotation header saved, but items failed: " + itemsError.message); return; }
  quoteForm.reset(); draftItems = []; renderDraft(); renderJobSummary(null); toggleWalkinFields(); await loadDocuments();
});

async function loadDocuments() {
  const [quotes, orders] = await Promise.all([
    supabase.from("quotations").select("id, quotation_number, status, total_usd, total_zig, created_at, customer_id, customers(full_name), walk_in_name, repair_job_id, repair_jobs(job_number, cro_number)").order("created_at", { ascending: false }),
    supabase.from("sales_orders").select("id, order_number, status, total_usd, total_zig, created_at, customers(full_name), walk_in_name").order("created_at", { ascending: false }),
  ]);
  quoteTable.innerHTML = quotes.data?.length ? quotes.data.map(quote => `<tr><td>#${quote.quotation_number}</td><td>${escapeHtml(quote.customers?.full_name || quote.walk_in_name || "—")}</td><td>${quote.repair_jobs ? escapeHtml(jobRef(quote.repair_jobs)) : "—"}</td><td>${quote.created_at ? new Date(quote.created_at).toLocaleString() : "—"}</td><td>${escapeHtml(quote.status)}</td><td>${money(quote.total_usd)}</td><td>${Number(quote.total_zig || 0).toFixed(2)}</td><td><button type="button" class="btn edit-quote" data-id="${quote.id}"><i data-lucide="pencil"></i> Amend</button></td></tr>`).join("") : `<tr><td colspan="8" class="empty-state"><i data-lucide="file-x-2"></i><span>No quotations yet</span></td></tr>`;
  orderTable.innerHTML = orders.data?.length ? orders.data.map(order => `<tr><td>#${order.order_number}</td><td>${escapeHtml(order.customers?.full_name || order.walk_in_name || "—")}</td><td>${order.created_at ? new Date(order.created_at).toLocaleString() : "—"}</td><td>${escapeHtml(order.status)}</td><td>${money(order.total_usd)}</td><td>${Number(order.total_zig || 0).toFixed(2)}</td><td><button type="button" class="btn edit-order" data-id="${order.id}"><i data-lucide="pencil"></i> Edit</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty-state"><i data-lucide="shopping-cart"></i><span>No sales orders yet</span></td></tr>`;
  document.querySelectorAll(".edit-quote").forEach(button => button.addEventListener("click", () => openQuoteEditor(button.dataset.id)));
  document.querySelectorAll(".edit-order").forEach(button => button.addEventListener("click", () => openOrderEditor(button.dataset.id)));
  if (window.lucide) lucide.createIcons();
}

async function fetchQuote(id) {
  const richSelect = "*, quotation_items(*), customers(full_name, phone, email), repair_jobs(job_number, cro_number, fault_reported, diagnosis, odometer_in, fuel_level_in, vehicles(make, model, year, license_plate, chassis_number, engine_number))";
  let { data, error } = await supabase.from("quotations").select(richSelect).eq("id", id).single();
  if (error) {
    console.warn("Full quotation lookup failed, retrying with fewer fields:", error.message);
    ({ data, error } = await supabase.from("quotations").select("*, quotation_items(*), customers(full_name), repair_jobs(job_number)").eq("id", id).single());
  }
  if (error) console.error("Failed to load quotation details:", error);
  return { data, error };
}
async function fetchOrder(id) {
  const richSelect = "*, sales_order_items(*), customers(full_name, phone, email), repair_jobs(job_number, cro_number, fault_reported, diagnosis, odometer_in, fuel_level_in, vehicles(make, model, year, license_plate, chassis_number, engine_number))";
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

// ---------- Business details (for the document and the message) ----------
let biz = { business_name: "Auto Parts & Repairs", tagline: "Vehicle Sales, Parts & Repairs", address: "", phone: "", email: "" };
async function loadBusiness() {
  const { data } = await supabase.from("business_settings").select("business_name, tagline, address, phone, email").eq("id", 1).maybeSingle();
  if (data) biz = { ...biz, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v)) };
}

function docNumber(record, kind) {
  return kind === "Quotation" ? record.quotation_number : record.order_number;
}
function longDate(value) {
  const d = value ? new Date(value) : new Date();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function usd(value) {
  return "USD " + Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function zig(value) {
  return "ZiG " + Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Customer-facing message (formal) ----------
// Cost price and markup are never shown to the customer — only final prices.
function buildDetailText(record, kind, items) {
  const customer = resolveCustomer(record);
  const job = record.repair_jobs || {};
  const vehicle = job.vehicles || {};
  const number = docNumber(record, kind);
  const isQuote = kind === "Quotation";
  const vehicleText = job.job_number ? `${vehicleLabel(vehicle) || "vehicle"}${vehicle.license_plate ? ` (registration ${vehicle.license_plate})` : ""}` : "";
  const lines = (items || []).map((item, i) =>
    `${i + 1}. ${item.part_name} — ${item.quantity} × ${usd(item.unit_price_usd)} = ${usd(Number(item.quantity) * Number(item.unit_price_usd))}`
  ).join("\n");
  const contact = [biz.phone && `Tel: ${biz.phone}`, biz.email && `Email: ${biz.email}`].filter(Boolean).join(" | ");

  return [
    `Dear ${customer.full_name},`,
    ``,
    isQuote
      ? `Thank you for choosing ${biz.business_name}. Please find below our Quotation No. ${number}, dated ${longDate(record.created_at)}${vehicleText ? `, for your ${vehicleText}` : ""}.`
      : `Thank you for your business. Please find below Sales Order No. ${number}, dated ${longDate(record.created_at)}${vehicleText ? `, for your ${vehicleText}` : ""}.`,
    ``,
    job.job_number ? `Job card: ${jobRef(job)}` : null,
    job.job_number ? `Fault reported: ${job.fault_reported || "Not recorded"}` : null,
    job.job_number ? `Diagnosis: ${job.diagnosis || "Diagnosis in progress"}` : null,
    job.job_number ? `` : null,
    isQuote ? `Quoted items:` : `Order items:`,
    lines || "(No items)",
    ``,
    `Total: ${usd(record.total_usd)} (${zig(record.total_zig)} at ${Number(record.usd_to_zig_rate || 0).toFixed(4)} ZiG per US dollar)`,
    ``,
    isQuote
      ? `This quotation is valid for seven (7) days from the date above, and prices are subject to the availability of parts. To proceed, kindly reply to confirm and we will schedule the work.`
      : `Kindly keep this sales order for your records. Should you have any questions, please do not hesitate to contact us.`,
    ``,
    `The ${isQuote ? "quotation" : "sales order"} document is attached as an image for your reference.`,
    ``,
    `Yours faithfully,`,
    biz.business_name,
    contact || null,
    biz.address || null,
  ].filter(line => line !== null).join("\n");
}

// ---------- Branded document (preview + downloadable image) ----------
function buildDetailHtml(record, kind, items) {
  const customer = resolveCustomer(record);
  const job = record.repair_jobs || {};
  const vehicle = job.vehicles || {};
  const number = docNumber(record, kind);
  const rows = (items || []).map(item => `
    <tr><td>${escapeHtml(item.part_name)}</td><td>${item.quantity}</td><td>${money(item.unit_price_usd)}</td><td>${money(item.quantity * item.unit_price_usd)}</td></tr>
  `).join("") || `<tr><td colspan="4">No line items</td></tr>`;
  const contact = [biz.phone, biz.email].filter(Boolean).map(escapeHtml).join(" · ");

  return `
    <header class="receipt-header">
      <div class="receipt-brand">
        <img src="${SHOP_LOGO_PATH}" alt="${escapeHtml(biz.business_name)}" class="receipt-logo" />
        <div class="receipt-address"><strong>${escapeHtml(biz.business_name)}</strong><br>${escapeHtml(biz.tagline || "")}${biz.address ? `<br>${escapeHtml(biz.address)}` : ""}${contact ? `<br>${contact}` : ""}</div>
      </div>
      <div class="receipt-meta"><strong>${kind.toUpperCase()} No. ${number}</strong>${longDate(record.created_at)}</div>
    </header>
    <h3>${kind === "Quotation" ? "Prepared for" : "Customer"}</h3>
    <div class="receipt-customer">${escapeHtml(customer.full_name)}<br>${escapeHtml(customer.phone)}${customer.email && customer.email !== "—" ? `<br>${escapeHtml(customer.email)}` : ""}</div>
    ${job.job_number ? `<h3>Vehicle &amp; job card</h3><div class="receipt-customer">${escapeHtml(jobRef(job))} · ${escapeHtml(vehicleLabel(vehicle) || "Vehicle")}${vehicle.license_plate ? ` · ${escapeHtml(vehicle.license_plate)}` : ""}${vehicle.chassis_number ? `<br>Chassis ${escapeHtml(vehicle.chassis_number)}` : ""}${vehicle.engine_number ? ` · Engine ${escapeHtml(vehicle.engine_number)}` : ""}${job.odometer_in != null ? `<br>Odometer in ${Number(job.odometer_in).toLocaleString()} km` : ""}</div>
    <h3>Fault reported</h3><div class="receipt-customer">${escapeHtml(job.fault_reported || "—")}</div>
    <h3>Diagnosis</h3><div class="receipt-customer">${escapeHtml(job.diagnosis || "Diagnosis in progress")}</div>` : ""}
    <h3>${kind === "Quotation" ? "Quoted items" : "Order items"}</h3>
    <table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="receipt-total"><span>Total</span><strong>${money(record.total_usd)} / ZiG ${Number(record.total_zig || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
    <p class="receipt-note">${kind === "Quotation" ? "This quotation is valid for seven (7) days from the date above. Prices are subject to the availability of parts." : `Thank you for choosing ${escapeHtml(biz.business_name)}.`}</p>`;
}

// ---------- Send: download the document image first, then open the message ----------
async function downloadDocumentImage(kind, record) {
  const node = document.getElementById(kind === "Quotation" ? "quote-detail-text" : "order-detail-text");
  if (!node) throw new Error("The document preview isn't on this page.");
  if (typeof window.html2canvas !== "function") throw new Error("The image tool didn't load. Check your internet connection and reload the page.");
  // Capture a clean copy on a fixed-width white "paper", away from the
  // modal, so nothing is cropped and the theme colours don't fade it.
  const paper = document.createElement("div");
  paper.id = "doc-capture";
  paper.innerHTML = node.innerHTML;
  document.body.appendChild(paper);
  let canvas;
  try {
    const imgs = [...paper.querySelectorAll("img")];
    await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    const width = paper.offsetWidth, height = paper.offsetHeight;
    canvas = await window.html2canvas(paper, {
      backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false,
      width, height, windowWidth: Math.max(width + 40, document.documentElement.clientWidth),
      scrollX: 0, scrollY: 0,
    });
  } finally {
    paper.remove();
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Couldn't create the image.");
  const name = `${kind === "Quotation" ? "Quotation" : "Sales-Order"}-${docNumber(record, kind)}.png`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return name;
}

function whatsappNumber(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  return digits.length >= 9 ? digits : "";
}

async function withBusy(button, label, fn) {
  const html = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = `<i data-lucide="loader-circle"></i> ${label}`; if (window.lucide) lucide.createIcons(); }
  try { return await fn(); }
  finally { if (button) { button.disabled = false; button.innerHTML = html; if (window.lucide) lucide.createIcons(); } }
}

async function sendByWhatsApp(kind, record, button) {
  const customer = resolveCustomer(record);
  const phone = whatsappNumber(customer.phone !== "—" ? customer.phone : "") ||
    whatsappNumber(prompt("Customer's WhatsApp number (e.g. 0771234567):") || "");
  if (!phone) return;
  // Open the WhatsApp tab inside the click so it isn't blocked as a pop-up.
  const tab = window.open("", "_blank");
  if (tab) tab.document.write("<p style='font:16px system-ui;padding:24px'>Preparing the message…</p>");
  try {
    const file = await withBusy(button, "Saving image…", () => downloadDocumentImage(kind, record));
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(buildDetailText(record, kind, itemsOf(record, kind)))}`;
    if (tab && !tab.closed) tab.location.href = url; else window.location.href = url;
    window.aprToast?.(`${file} downloaded`, "success", "Attach it in WhatsApp with the paperclip, then send.");
  } catch (err) {
    if (tab && !tab.closed) tab.close();
    window.aprToast?.("Couldn't prepare the message", "error", err.message || String(err));
  }
}

async function sendByEmail(kind, record, button) {
  const customer = resolveCustomer(record);
  const email = (customer.email && customer.email !== "—" ? customer.email : "").trim() || (prompt("Customer email address:") || "").trim();
  if (!email) return;
  try {
    const file = await withBusy(button, "Saving image…", () => downloadDocumentImage(kind, record));
    const subject = `${kind === "Quotation" ? "Quotation" : "Sales Order"} No. ${docNumber(record, kind)} — ${biz.business_name}`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildDetailText(record, kind, itemsOf(record, kind)))}`;
    window.aprToast?.(`${file} downloaded`, "success", "Attach it to the email before sending.");
  } catch (err) {
    window.aprToast?.("Couldn't prepare the email", "error", err.message || String(err));
  }
}

function itemsOf(record, kind) {
  return kind === "Quotation" ? record.quotation_items : record.sales_order_items;
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
  const wasAlreadyConfirmed = editingOrder.status === "Confirmed";
  const inputs = [...document.querySelectorAll("#edit-order-lines .amend-qty")]; const prices = [...document.querySelectorAll("#edit-order-lines .amend-price")]; const rate = Number(editingOrder.usd_to_zig_rate || exchangeRate); let total = 0;
  for (let i = 0; i < editingOrder.sales_order_items.length; i++) { const quantity = Number(inputs[i].value); const unit = Number(prices[i].value); total += quantity * unit; await supabase.from("sales_order_items").update({ quantity, unit_price_usd: unit, total_usd: quantity * unit, unit_price_zig: unit * rate, total_zig: quantity * unit * rate }).eq("id", editingOrder.sales_order_items[i].id); }
  const salespersonId = document.getElementById("edit-order-salesperson")?.value || null;
  await supabase.from("sales_orders").update({ total_usd: total, total_zig: total * rate, status: "Confirmed", salesperson_id: salespersonId, updated_at: new Date().toISOString() }).eq("id", editingOrder.id);

  // Stock only gets deducted once — on the actual Draft-to-Confirmed
  // transition. Re-saving an already-confirmed order (amending it later)
  // doesn't deduct again, since that stock was already taken out the
  // first time this order was confirmed. This was the gap Quick Sale
  // didn't have but this flow did.
  if (!wasAlreadyConfirmed) {
    // Parts already on the order's job card were taken from stock when they
    // were added to the job, so only the extra quantity is deducted here.
    const onJob = {};
    if (editingOrder.repair_job_id) {
      const { data: jobParts } = await supabase.from("job_parts").select("part_id, quantity").eq("job_id", editingOrder.repair_job_id);
      (jobParts || []).forEach(jp => { if (jp.part_id) onJob[jp.part_id] = (onJob[jp.part_id] || 0) + Number(jp.quantity || 0); });
    }
    for (let i = 0; i < editingOrder.sales_order_items.length; i++) {
      const item = editingOrder.sales_order_items[i];
      if (!item.part_id) continue;
      const fromJob = Math.min(onJob[item.part_id] || 0, Number(inputs[i].value));
      onJob[item.part_id] = (onJob[item.part_id] || 0) - fromJob;
      const quantity = Number(inputs[i].value) - fromJob;
      if (quantity <= 0) continue;
      const { data: part } = await supabase.from("parts").select("quantity_in_stock").eq("id", item.part_id).single();
      if (part) {
        await supabase.from("parts").update({ quantity_in_stock: Math.max(0, Number(part.quantity_in_stock) - quantity) }).eq("id", item.part_id);
      }
    }
  }

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
on("quote-detail-email", (e) => editingQuote && sendByEmail("Quotation", editingQuote, e.currentTarget));
on("quote-detail-whatsapp", (e) => editingQuote && sendByWhatsApp("Quotation", editingQuote, e.currentTarget));

on("order-detail-copy", () => copyDetailText(editingOrderDetailText, document.getElementById("order-detail-copy-status")));
on("order-detail-email", (e) => editingOrder && sendByEmail("Sales Order", editingOrder, e.currentTarget));
on("order-detail-whatsapp", (e) => editingOrder && sendByWhatsApp("Sales Order", editingOrder, e.currentTarget));

document.addEventListener("DOMContentLoaded", async () => {
  toggleWalkinFields();
  loadBusiness().catch(() => {});
  try {
    await loadBaseData();
    const requestedJob = new URLSearchParams(window.location.search).get("job");
    if (requestedJob && jobs.some(job => job.id === requestedJob)) {
      jobSelect.value = requestedJob;
      toggleWalkinFields();
      await loadFromJob(requestedJob);
    }
  } catch (err) {
    console.error("Failed to load jobs/parts:", err);
    if (jobSelect) jobSelect.innerHTML = `<option value="">Couldn't load job cards — check the console</option>`;
  }

  try {
    await loadDocuments();
  } catch (err) {
    console.error("Failed to load quotations/orders:", err);
    if (quoteTable) quoteTable.innerHTML = `<tr><td colspan="8" class="empty-state">Couldn't load quotations — check the console for details</td></tr>`;
    if (orderTable) orderTable.innerHTML = `<tr><td colspan="7" class="empty-state">Couldn't load sales orders — check the console for details</td></tr>`;
  }
});