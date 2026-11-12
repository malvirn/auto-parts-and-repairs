import supabase from "./supabaseClient.js";
import { getRate } from "./currency.js";

const quoteForm = document.getElementById("quotation-form");
const jobSelect = document.getElementById("quote-job");
const customerSelect = document.getElementById("quote-customer");
const vehicleSelect = document.getElementById("quote-vehicle");
const partSelect = document.getElementById("quote-part");
const qtyInput = document.getElementById("quote-qty");
const draftList = document.getElementById("quote-draft-items");
const quoteTotal = document.getElementById("quote-total");
const quoteTable = document.getElementById("quotations-table");
const quoteVatEnabled = document.getElementById("quote-vat-enabled");
if (new URLSearchParams(window.location.search).get("vat") === "0" && quoteVatEnabled) quoteVatEnabled.checked = false;
const orderTable = document.getElementById("orders-table");
const quoteModal = document.getElementById("quote-edit-modal");
const orderModal = document.getElementById("order-edit-modal");

let jobs = [];
let customers = [];
let parts = [];
let rateTiers = [];
let draftItems = [];
let editingQuote = null;
let editingOrder = null;
let editingQuoteDetailText = "";
let editingOrderDetailText = "";
let exchangeRate = 26.6908;
let quotationRows = [];\nlet quotationVisibleCount = 50;
let quoteSubmissionInProgress = false;
const busyActions = new WeakSet();
const lib = src => new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = src;
  script.onload = resolve;
  script.onerror = () => reject(new Error(`Couldn't load ${src}`));
  document.head.append(script);
});

const SHOP_LOGO_PATH = "../assets/logo.png";

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function lineTotalOf(item) { return Number((Number(item.quantity) * Number(item.unit_price_usd)).toFixed(2)); }
function totalOf(items) { return items.reduce((sum, item) => sum + lineTotalOf(item), 0); }
function partsTotalOf(items) { return (items || []).filter(item => itemType(item) === "part").reduce((sum, item) => sum + lineTotalOf(item), 0); }
function quotationTotals(items, vatRate = 5) {
  const subtotal = Number(totalOf(items || []).toFixed(2));
  const partsSubtotal = Number(partsTotalOf(items || []).toFixed(2));
  const vat = Number((partsSubtotal * Number(vatRate || 0) / 100).toFixed(2));
  return { subtotal, partsSubtotal, vat, total: Number((subtotal + vat).toFixed(2)) };
}
function quotationVatRate() { return quoteVatEnabled?.checked ? 5 : 0; }
async function zigTotal(usd) { return Number((usd * await getRate()).toFixed(2)); }
function itemType(item) {
  if (item.item_type) return item.item_type;
  if (item.kind) return item.kind;
  if (item.part_id) return "part";
  if (/\(incidental\)\s*$/i.test(item.part_name || "")) return "sundry";
  if (/^labour\b/i.test(item.part_name || "")) return "labour";
  return "other";
}
function itemTypeLabel(item) {
  const type = itemType(item);
  return type === "labour" ? "Labour" : type === "sundry" ? "Sundry" : type === "part" ? "Part" : "Item";
}
function itemDisplayName(item) {
  const type = itemType(item);
  return type === "labour" ? (item.part_name || "Labour") : type === "sundry" ? "Sundry" : item.part_name;
}
function itemQuantityDisplay(item) {
  if (itemType(item) !== "labour") return item.quantity;
  return /provider estimate/i.test(item.part_name || "") ? "Flat charge" : `${item.quantity} hr`;
}
function itemUnitPriceDisplay(item) {
  return `${money(item.unit_price_usd)}${itemType(item) === "labour" && !/provider estimate/i.test(item.part_name || "") ? "/hr" : ""}`;
}

function vehicleLabel(vehicle) {
  if (!vehicle) return "";
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
}

function populateVehicleDetails(vehicle = {}) {
  const values = { "quote-vehicle-make": vehicle.make, "quote-vehicle-model": vehicle.model };
  Object.entries(values).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value ?? "";
  });
}

function quotationVehicleDetails() {
  const read = id => document.getElementById(id)?.value.trim() || null;
  return {
    make: read("quote-vehicle-make"),
    model: read("quote-vehicle-model"),
  };
}

function highlightMissingQuotationFields() {
  const name = document.getElementById("quote-walkin-name");
  const phone = document.getElementById("quote-walkin-phone");
  const missing = [];
  [[name, "name"], [phone, "phone"]].forEach(([input, label]) => {
    const isMissing = !input.value.trim();
    input.setAttribute("data-missing", String(isMissing));
    if (isMissing) missing.push(label);
  });
  const warning = document.getElementById("quote-missing-fields");
  warning.hidden = missing.length === 0;
  warning.textContent = missing.length ? `Enter the customer's ${missing.join(" and ")} before saving.` : "";
  return missing;
}

function findMatchingCustomer(name, phone, email) {
  const normalizedName = name.trim().toLocaleLowerCase();
  const normalizedNameDigits = normalizedName.replace(/\D/g, "");
  if (!normalizedName) return null;
  let matches = customers.filter(customer =>
    [customer.full_name,customer.company_name,customer.customer_code].some(value => String(value || "").trim().toLocaleLowerCase() === normalizedName) ||
    (normalizedNameDigits.length >= 7 && (customer.phone || "").replace(/\D/g, "") === normalizedNameDigits)
  );
  const normalizedPhone = phone.replace(/\D/g, "");
  const normalizedEmail = email.trim().toLocaleLowerCase();
  if (normalizedPhone) matches = matches.filter(customer => (customer.phone || "").replace(/\D/g, "") === normalizedPhone);
  if (normalizedEmail) matches = matches.filter(customer => (customer.email || "").trim().toLocaleLowerCase() === normalizedEmail);
  return matches.length === 1 ? matches[0] : null;
}

function fillWalkinDetails(customer) {
  if (!customer) return;
  document.getElementById("quote-walkin-name").value = customer.full_name || "";
  document.getElementById("quote-walkin-phone").value = customer.phone || "";
  document.getElementById("quote-walkin-email").value = customer.email || "";
  document.getElementById("quote-is-company").checked = Boolean(customer.is_company);
  document.getElementById("quote-company-name").value = customer.company_name || "";
  document.getElementById("quote-company-name-wrap").hidden = !customer.is_company;
  document.getElementById("quote-company-name").required = Boolean(customer.is_company);
}

document.getElementById("quote-walkin-name").addEventListener("change", event => {
  const typedName = event.currentTarget.value.trim().toLocaleLowerCase();
  const typedDigits = typedName.replace(/\D/g, "");
  const matches = customers.filter(customer =>
    [customer.full_name,customer.company_name,customer.customer_code].some(value => String(value || "").trim().toLocaleLowerCase() === typedName) ||
    (typedDigits.length >= 7 && (customer.phone || "").replace(/\D/g, "") === typedDigits)
  );
  if (matches.length !== 1) return;
  const customer = matches[0];
  const phone = document.getElementById("quote-walkin-phone");
  const email = document.getElementById("quote-walkin-email");
  if (!phone.value.trim()) phone.value = customer.phone || "";
  if (!email.value.trim()) email.value = customer.email || "";
});

// A quotation/order's customer is either a linked registered customer, or
// a walk-in entered directly on the form — this resolves whichever applies.
function resolveCustomer(record) {
  return {
    full_name: record.customers?.company_name || record.customers?.full_name || record.walk_in_name || "Customer",
    phone: record.customers?.phone || record.walk_in_phone || "—",
    email: record.customers?.email || record.walk_in_email || "—",
    customer_code: record.customers?.customer_code || "",
    company_name: record.customers?.company_name || "",
    is_company: Boolean(record.customers?.is_company),
  };
}

async function loadBaseData() {
  exchangeRate = await getRate();
  const [jobsResult, partsResult, customersResult, tiersResult] = await Promise.all([
    supabase.from("repair_jobs").select("id, job_number, cro_number, customer_id, vehicle_id, status, fault_reported, diagnosis, labour_cost, labour_hours, labour_mode, fuel_level_in, odometer_in, driver_name, driver_phone, customers(full_name, phone, email, customer_type, customer_code, is_company, company_name), vehicles(id, make, model, year, license_plate, chassis_number, engine_number, body_type), vehicle_rate_tiers(tier_name, hourly_rate)").order("created_at", { ascending: false }),
    supabase.from("parts").select("id, name, cost_price, selling_price, quantity_in_stock").order("name"),
    supabase.from("customers").select("id, customer_code, full_name, phone, email, customer_type, is_company, company_name, vehicles(id, license_plate, make, model, year, body_type, chassis_number, engine_number, odometer_out)").is("deleted_at", null).order("full_name"),
    supabase.from("vehicle_rate_tiers").select("*").order("sort_order"),
  ]);
  if (jobsResult.error) console.error("Quotation jobs load failed:", jobsResult.error);
  if (partsResult.error) console.error("Quotation parts load failed:", partsResult.error);
  if (customersResult.error) console.error("Quotation customers load failed:", customersResult.error);
  if (tiersResult.error) console.error("Quotation labour rates load failed:", tiersResult.error);
  jobs = jobsResult.data || [];
  parts = partsResult.data || [];
  customers = customersResult.data || [];
  rateTiers = (tiersResult.data || []).filter(tier => tier.is_active !== false);
  const labourTierSelect = document.getElementById("quote-labour-tier");
  if (labourTierSelect) {
    labourTierSelect.innerHTML = rateTiers.map(tier => `<option value="${escapeHtml(tier.id)}">${escapeHtml(tier.tier_name)} — ${money(tier.hourly_rate)}/hr</option>`).join("")
      || `<option value="">No time-based rates configured</option>`;
    const defaultTier = rateTiers.find(tier => tier.is_default) || rateTiers[0];
    if (defaultTier) labourTierSelect.value = defaultTier.id;
  }
  jobSelect.innerHTML = `<option value="">No job card — walk-in customer</option>` + jobs.map(job => {
    const vehicle = vehicleLabel(job.vehicles);
    const plate = job.vehicles?.license_plate ? ` (${job.vehicles.license_plate})` : "";
    return `<option value="${job.id}">${escapeHtml(jobRef(job))} — ${escapeHtml(job.customers?.full_name || "Customer")} — ${escapeHtml((vehicle || "Vehicle") + plate)}</option>`;
  }).join("");
  partSelect.innerHTML = parts.map(part => `<option value="${part.id}">${escapeHtml(part.name)} — ${money(part.selling_price)} · ${part.quantity_in_stock} in shop</option>`).join("");
  customerSelect.innerHTML = `<option value="">Select a customer or enter a walk-in below…</option>` + customers.map(customer => `<option value="${customer.id}">${escapeHtml([customer.customer_code,customer.company_name||customer.full_name,customer.phone].filter(Boolean).join(" · "))}</option>`).join("");
  const suggestions = document.getElementById("quote-customer-suggestions");
  if (suggestions) {
    suggestions.innerHTML = customers.map(customer =>
      [customer.full_name,customer.company_name,customer.customer_code,customer.phone].filter(Boolean).map(value =>
        `<option value="${escapeHtml(value)}" label="${escapeHtml([customer.customer_code,customer.company_name,customer.phone,customer.email].filter(Boolean).join(" · "))}"></option>`
      ).join("")
    ).join("");
  }
  renderQuoteVehicles();
}

function jobRef(job) {
  if (!job) return "";
  return job.cro_number || `#${String(job.job_number).padStart(4, "0")}`;
}

function toggleWalkinFields() {
  document.getElementById("quote-walkin-fields").classList.remove("hidden");
  document.getElementById("quote-fault-field").classList.remove("hidden");
}
function renderQuoteVehicles(selectedId = "") {
  const customer = customers.find(candidate => candidate.id === customerSelect.value);
  const vehicles = customer?.vehicles || [];
  vehicleSelect.innerHTML = `<option value="">No vehicle selected</option>` + vehicles.map(vehicle => `<option value="${vehicle.id}">${escapeHtml(vehicle.license_plate || "No plate")} — ${escapeHtml([vehicle.make, vehicle.model].filter(Boolean).join(" "))}</option>`).join("");
  vehicleSelect.value = selectedId;
  populateVehicleDetails(vehicles.find(vehicle => vehicle.id === selectedId) || {});
}
customerSelect.addEventListener("change", () => {
  renderQuoteVehicles();
  toggleWalkinFields();
  const customer = customers.find(candidate => candidate.id === customerSelect.value);
  fillWalkinDetails(customer);
});
vehicleSelect.addEventListener("change", () => {
  const customer = customers.find(candidate => candidate.id === customerSelect.value);
  populateVehicleDetails(customer?.vehicles?.find(vehicle => vehicle.id === vehicleSelect.value) || {});
});
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
      ${cell("Labour charge", Number(job.labour_cost) > 0 ? `${job.labour_mode === "provider_estimate" ? "Provider-estimated task price" : "Time-based tier"} · ${money(job.labour_cost)}` : "")}
    </div>
    <div class="qjs-text"><span>Fault reported</span><p>${escapeHtml(job.fault_reported || "—")}</p></div>
    <div class="qjs-text"><span>Diagnosis</span><p>${escapeHtml(job.diagnosis || "Not diagnosed yet")}</p></div>`;
  box.classList.remove("hidden");
}

async function loadFromJob(jobId) {
  const job = jobs.find(candidate => candidate.id === jobId) || null;
  renderJobSummary(job);
  if (!job) { populateVehicleDetails({}); draftItems = []; renderDraft(); return; }
  customerSelect.value = job.customer_id || "";
  renderQuoteVehicles(job.vehicle_id || "");
  fillWalkinDetails(job.customers);
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
    const unit = item.price_at_time != null ? Number(item.price_at_time) : Number(part?.selling_price ?? 0);
    return { kind: "part", part_id: item.part_id, part_name: item.part_name, quantity: item.quantity, cost_price_usd: cost, unit_price_usd: unit };
  });
  if (Number(job.labour_cost) > 0) {
    const hours = Number(job.labour_hours) > 0 ? Number(job.labour_hours) : 1;
    const estimated = job.labour_mode === "provider_estimate";
    items.push({
      kind: "labour",
      part_id: null,
      part_name: estimated ? "Labour (provider estimate)" : "Labour (time-based tier)",
      quantity: estimated ? 1 : hours,
      cost_price_usd: 0,
      unit_price_usd: Number((Number(job.labour_cost) / (estimated ? 1 : hours)).toFixed(2)),
    });
  }
  (incRes.data || []).forEach(inc => {
    items.push({ kind: "sundry", part_id: null, part_name: "Sundry", quantity: 1, cost_price_usd: 0, unit_price_usd: Number(inc.amount) });
  });
  draftItems = items;
  renderDraft();
}

function markupPctFor(item) {
  const cost = Number(item.cost_price_usd) || 0;
  if (cost <= 0) return 0;
  return Number(((Number(item.unit_price_usd) / cost - 1) * 100).toFixed(2));
}

function renderDraft() {
  if (!draftItems.length) {
    draftList.innerHTML = `<div class="empty-state"><i data-lucide="package-open"></i><span>Add labour, parts or sundries to build the quotation.</span></div>`;
  } else {
    draftList.innerHTML = draftItems.map((item, index) => `
      <div class="quotation-line"><span><strong>${escapeHtml(itemDisplayName(item))}</strong><small>${itemTypeLabel(item)} · ${itemQuantityDisplay(item)} × ${itemUnitPriceDisplay(item)}${item.part_id == null && item.kind === "part" ? ` · Cost ${money(item.cost_price_usd)} · Markup ${Number(markupPctFor(item)).toFixed(2)}% · Profit ${money((Number(item.unit_price_usd) - Number(item.cost_price_usd)) * Number(item.quantity))}` : ""}</small></span><strong>${money(item.quantity * item.unit_price_usd)}</strong><button type="button" class="btn remove-quote-line" data-index="${index}"><i data-lucide="x"></i></button></div>
    `).join("");
    draftList.querySelectorAll(".remove-quote-line").forEach(button => button.addEventListener("click", () => { draftItems.splice(Number(button.dataset.index), 1); renderDraft(); }));
  }
  const vatRate = quotationVatRate();
  const totals = quotationTotals(draftItems, vatRate);
  quoteTotal.textContent = `${money(totals.total)}${vatRate ? ` incl. VAT (${money(totals.vat)} on parts)` : ""} / ZiG ${Number(totals.total * exchangeRate).toFixed(2)}`;
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
  else draftItems.push({ kind: "part", part_id: part.id, part_name: part.name, quantity, cost_price_usd: Number(part.cost_price) || 0, unit_price_usd: Number(part.selling_price) || 0 });
  qtyInput.value = 1;
  renderDraft();
});

const customCostInput = document.getElementById("quote-custom-cost");
const customSellingInput = document.getElementById("quote-custom-selling");
const customMarkupInput = document.getElementById("quote-custom-markup");
const customProfitInput = document.getElementById("quote-custom-profit");

function recalculateCustomPartPricing(changedField) {
  const cost = Number(customCostInput?.value);
  const selling = Number(customSellingInput?.value);
  const markup = Number(customMarkupInput?.value);

  if (changedField === "selling" && Number.isFinite(cost) && cost >= 0 && Number.isFinite(selling) && cost > 0) {
    customMarkupInput.value = (((selling - cost) / cost) * 100).toFixed(2);
  } else if ((changedField === "markup" || changedField === "cost") && Number.isFinite(cost) && cost >= 0 && Number.isFinite(markup)) {
    customSellingInput.value = (cost * (1 + markup / 100)).toFixed(2);
  }

  const finalCost = Number(customCostInput?.value) || 0;
  const finalSelling = Number(customSellingInput?.value) || 0;
  if (customProfitInput) customProfitInput.value = (finalSelling - finalCost).toFixed(2);
}
customCostInput?.addEventListener("input", () => recalculateCustomPartPricing("cost"));
customSellingInput?.addEventListener("input", () => recalculateCustomPartPricing("selling"));
customMarkupInput?.addEventListener("input", () => recalculateCustomPartPricing("markup"));

document.getElementById("quote-add-custom")?.addEventListener("click", () => {
  const nameInput = document.getElementById("quote-custom-name");
  const quantityInput = document.getElementById("quote-custom-qty");
  const name = nameInput.value.trim();
  const quantity = Number(quantityInput.value);
  const cost = Number(customCostInput?.value);
  const selling = Number(customSellingInput?.value);
  const markup = Number(customMarkupInput?.value);

  if (!name) {
    alert("Enter the typed part name.");
    nameInput.focus();
    return;
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    alert("Enter a valid quantity.");
    quantityInput.focus();
    return;
  }
  if (!Number.isFinite(cost) || cost < 0) {
    alert("Enter a valid unit cost price.");
    customCostInput?.focus();
    return;
  }
  if (!Number.isFinite(selling) || selling <= 0) {
    alert("Enter a valid selling price.");
    customSellingInput?.focus();
    return;
  }
  if (!Number.isFinite(markup) || markup < -100 || markup > 999.99) {
    alert("Enter a markup percentage from -100% to 999.99%.");
    customMarkupInput?.focus();
    return;
  }

  const existing = draftItems.find(item =>
    item.part_id == null &&
    item.kind === "part" &&
    String(item.part_name || "").trim().toLowerCase() === name.toLowerCase() &&
    Number(item.cost_price_usd) === cost &&
    Number(item.unit_price_usd) === selling
  );
  if (existing) existing.quantity += quantity;
  else draftItems.push({
    kind: "part",
    part_id: null,
    part_name: name,
    quantity,
    cost_price_usd: Number(cost.toFixed(2)),
    markup_pct: Number(markup.toFixed(2)),
    unit_price_usd: Number(selling.toFixed(2)),
  });

  nameInput.value = "";
  quantityInput.value = 1;
  customCostInput.value = "";
  customSellingInput.value = "";
  customMarkupInput.value = "";
  customProfitInput.value = "";
  nameInput.focus();
  renderDraft();
});

document.getElementById("quote-labour-mode")?.addEventListener("change", event => {
  const timeBased = event.currentTarget.value === "time_based";
  const providerEstimate = event.currentTarget.value === "provider_estimate";
  const customRate = event.currentTarget.value === "custom";
  document.getElementById("quote-time-fields").hidden = !timeBased;
  document.getElementById("quote-estimate-fields").hidden = !providerEstimate;
  document.getElementById("quote-custom-fields").hidden = !customRate;
});

document.getElementById("quote-add-labour")?.addEventListener("click", () => {
  const mode = document.getElementById("quote-labour-mode").value;
  if (mode === "provider_estimate") {
    const estimateInput = document.getElementById("quote-labour-estimate");
    const estimate = Number(estimateInput.value);
    if (!estimateInput.value.trim() || !Number.isFinite(estimate) || estimate < 0) {
      alert("Enter a valid provider-estimated task price.");
      return;
    }
    draftItems.push({
      kind: "labour",
      part_id: null,
      part_name: "Labour (provider estimate)",
      quantity: 1,
      cost_price_usd: 0,
      unit_price_usd: Number(estimate.toFixed(2)),
    });
    estimateInput.value = "";
    renderDraft();
    return;
  }
  if (mode === "custom") {
    const descriptionInput = document.getElementById("quote-custom-labour-desc");
    const hoursInput = document.getElementById("quote-custom-labour-hours");
    const rateInput = document.getElementById("quote-custom-labour-rate");
    const description = descriptionInput.value.trim();
    const hours = Number(hoursInput.value);
    const rate = Number(rateInput.value.trim());
    if (!hoursInput.value.trim() || !Number.isFinite(hours) || hours <= 0) {
      alert("Enter valid labour hours.");
      hoursInput.focus();
      return;
    }
    if (!rateInput.value.trim() || !Number.isFinite(rate) || rate < 0) {
      alert("Enter a valid custom labour rate.");
      rateInput.focus();
      return;
    }
    draftItems.push({
      kind: "labour",
      part_id: null,
      part_name: description ? `Labour - ${description}` : "Labour (custom rate)",
      quantity: hours,
      cost_price_usd: 0,
      unit_price_usd: Number(rate.toFixed(2)),
    });
    descriptionInput.value = "";
    hoursInput.value = 1;
    rateInput.value = "";
    renderDraft();
    return;
  }
  const tier = rateTiers.find(item => item.id === document.getElementById("quote-labour-tier").value);
  const hoursInput = document.getElementById("quote-labour-hours");
  const rawHours = hoursInput.value.trim();
  const hours = Number(rawHours);
  if (!tier || !rawHours || !Number.isFinite(hours) || hours <= 0) {
    alert("Choose a time-based rate tier and enter valid labour hours.");
    return;
  }
  draftItems.push({ kind: "labour", part_id: null, part_name: "Labour (time-based tier)", quantity: hours, cost_price_usd: 0, unit_price_usd: Number(Number(tier.hourly_rate).toFixed(2)) });
  hoursInput.value = "";
  renderDraft();
});

document.getElementById("quote-add-sundry")?.addEventListener("click", () => {
  const rawPrice = document.getElementById("quote-sundry-price").value.trim();
  const price = Number(rawPrice);
  if (!rawPrice || !Number.isFinite(price) || price < 0) {
    alert("Enter a valid sundry price.");
    return;
  }
  draftItems.push({ kind: "sundry", part_id: null, part_name: "Sundry", quantity: 1, cost_price_usd: 0, unit_price_usd: Number(price.toFixed(2)) });
  document.getElementById("quote-sundry-price").value = "";
  renderDraft();
});

quoteForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (quoteSubmissionInProgress) return;
  quoteSubmissionInProgress = true;
  const submitButton = quoteForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  try {
  const missingFields = highlightMissingQuotationFields();
  if (missingFields.length) {
    document.getElementById("quote-walkin-name").focus();
    return;
  }
  if (!draftItems.length) { alert("Add at least one line to the quotation."); return; }

  const job = jobs.find(candidate => candidate.id === jobSelect.value) || null;
  const walk_in_name = document.getElementById("quote-walkin-name").value.trim();
  const walk_in_phone = document.getElementById("quote-walkin-phone").value.trim();
  const walk_in_email = document.getElementById("quote-walkin-email").value.trim() || null;
  const matchedCustomer = findMatchingCustomer(walk_in_name, walk_in_phone, walk_in_email || "");
  let customer_id = job?.customer_id || matchedCustomer?.id || null;
  let createdCustomerCode = null;
  const is_company = document.getElementById("quote-is-company")?.checked || false;
  const company_name = document.getElementById("quote-company-name")?.value.trim() || "";
  if (!job && !matchedCustomer) {
    if (is_company && !company_name) { alert("Enter the company name before saving the quotation."); document.getElementById("quote-company-name")?.focus(); return; }
    const { data: createdCustomer, error: customerError } = await supabase.from("customers").insert({ full_name: walk_in_name, phone: walk_in_phone, email: walk_in_email, is_company, company_name: is_company ? company_name : null }).select("id,customer_code").single();
    if (customerError) throw new Error("Could not register this quotation customer: " + customerError.message);
    customer_id = createdCustomer.id;
    createdCustomerCode = createdCustomer.customer_code || null;
  }
  const vehicle_id = job?.vehicle_id || (matchedCustomer?.id === customerSelect.value ? vehicleSelect.value || null : null);
  const fault_reported = document.getElementById("quote-fault").value.trim() || job?.fault_reported || null;
  if (walk_in_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(walk_in_email)) {
    alert("Enter a valid email address.");
    document.getElementById("quote-walkin-email").focus();
    return;
  }

  const rate = await getRate();
  const vatRate = quotationVatRate();
  const quoteTotals = quotationTotals(draftItems, vatRate);
  const totalUsd = quoteTotals.total;
  const numericLimit = 9999999999.99;
  const itemRows = draftItems.map(item => {
    const cost = Number(item.cost_price_usd) || 0;
    const markup = Number.isFinite(Number(item.markup_pct)) ? Number(item.markup_pct) : markupPctFor(item);
    const unit = Number(item.unit_price_usd);
    const total = Number(item.quantity) * unit;
    return {
      quotation_id: null, part_id: item.part_id, item_type: item.kind || itemType(item), part_name: item.part_name,
      quantity: Number(item.quantity), cost_price_usd: cost, markup_pct: markup, unit_price_usd: unit,
      total_usd: total, unit_price_zig: unit * rate, total_zig: total * rate,
    };
  });
  const invalidItem = itemRows.find(item =>
    !Number.isFinite(item.quantity) || item.quantity < 1 || item.quantity > 99999999.99 ||
    !Number.isFinite(item.markup_pct) || item.markup_pct < -100 || item.markup_pct > 999.99 ||
    !Number.isFinite(item.unit_price_usd) || item.unit_price_usd < 0 ||
    [item.cost_price_usd, item.total_usd, item.unit_price_zig, item.total_zig].some(value => !Number.isFinite(value) || Math.abs(value) > numericLimit)
  );
  if (invalidItem || !Number.isFinite(totalUsd) || Math.abs(totalUsd) > numericLimit || !Number.isFinite(totalUsd * rate) || Math.abs(totalUsd * rate) > numericLimit) {
    alert(`One quotation line is outside the supported numeric range. Check the prices, quantity, markup (maximum 999.99%), and exchange rate.`);
    return;
  }
  itemRows.forEach(item => { item.quotation_id = null; });
  const notes = job?.diagnosis ? `Diagnosis: ${job.diagnosis}` : null;
  const { data: quote, error } = await supabase.from("quotations").insert([{
    customer_id, vehicle_id, fault_reported, repair_job_id: job?.id || null, markup_pct: 25, usd_to_zig_rate: rate,
    vat_rate: vatRate, prepared_by: document.getElementById("quote-prepared-by").value.trim() || null,
    total_usd: totalUsd, total_zig: totalUsd * rate, vehicle_details: quotationVehicleDetails(),
    walk_in_name, walk_in_phone, walk_in_email, notes,
  }]).select().single();
  if (error) { alert("Failed to save quotation: " + error.message); return; }
  itemRows.forEach(item => { item.quotation_id = quote.id; });
  const { error: itemsError } = await supabase.from("quotation_items").insert(itemRows);
  if (itemsError) {
    const { error: cleanupError } = await supabase.from("quotations").delete().eq("id", quote.id);
    if (cleanupError) {
      console.error("Could not remove quotation header after line-item save failed:", cleanupError);
      alert(`Quotation header was saved, but its items failed: ${itemsError.message}. The incomplete quotation could not be removed (${cleanupError.message}); refresh the quotation list before retrying.`);
    } else {
      alert("Failed to save quotation items: " + itemsError.message + ". The incomplete quotation was removed; you can safely try again.");
    }
    return;
  }
  if (createdCustomerCode) {
    let copied = false;
    try { await navigator.clipboard.writeText(createdCustomerCode); copied = true; } catch {}
    const customerLabel = is_company ? company_name : walk_in_name;
    const phoneDigits = walk_in_phone.replace(/\D/g, "");
    if (phoneDigits && confirm(`Customer ID ${createdCustomerCode}${copied ? " copied to clipboard." : ""} Share it with the customer on WhatsApp?`)) {
      window.open("https://wa.me/" + phoneDigits + "?text=" + encodeURIComponent("Hello " + customerLabel + ", your Centric Auto Mobile Customer ID is " + createdCustomerCode + ". Please keep it for future visits."), "_blank", "noopener");
    } else if (!copied) {
      alert("Customer registered. Customer ID: " + createdCustomerCode + ". Copy it and share it with the customer.");
    } else {
      alert("Customer registered. Customer ID: " + createdCustomerCode + " (copied to clipboard).");
    }
  }
  quoteForm.reset(); draftItems = []; renderDraft(); renderJobSummary(null); populateVehicleDetails({}); toggleWalkinFields(); await loadDocuments(); await openQuoteEditor(quote.id);
  } catch (error) {
    console.error("Quotation save failed:", error);
    alert("Couldn't finish saving the quotation: " + (error.message || String(error)) + ". Refresh the quotation list before retrying if the save may have completed.");
  } finally {
    quoteSubmissionInProgress = false;
    if (submitButton) submitButton.disabled = false;
  }
});
quoteForm.addEventListener("input", event => {
  event.target.removeAttribute("data-missing");
});
quoteVatEnabled?.addEventListener("change", renderDraft);

function renderQuotationRows() {
  const search = document.getElementById("quote-filter-search").value.trim().toLocaleLowerCase();
  const number = document.getElementById("quote-filter-number").value.trim();
  const from = document.getElementById("quote-filter-from").value;
  const to = document.getElementById("quote-filter-to").value;
  const status = document.getElementById("quote-filter-status").value;
  const filtered = quotationRows.filter(quote => {
    const customer = quote.customers?.company_name || quote.customers?.full_name || quote.walk_in_name || "";
    const createdBy = quote.prepared_by || "";
    const createdDate = String(quote.created_at || "").slice(0, 10);
    const queryMatch = !search || [quote.quotation_number, customer, quote.customers?.customer_code, quote.customers?.company_name, createdBy, quote.status].some(value => String(value || "").toLocaleLowerCase().includes(search));
    return queryMatch && (!number || String(quote.quotation_number).includes(number))
      && (!from || createdDate >= from) && (!to || createdDate <= to)
      && (!status || quote.status === status);
  });
  const visibleQuotes = filtered.slice(0, quotationVisibleCount);\n  quoteTable.innerHTML = visibleQuotes.length ? visibleQuotes.map(quote => {
    const depositExpired = quote.created_at && Date.now() > Date.parse(quote.created_at) + 7 * 86400000;
    return `<tr class="quotation-row" data-quote-id="${quote.id}" tabindex="0" aria-expanded="false" aria-label="Expand quotation ${quote.quotation_number}"><td><span class="quote-expand-mark" aria-hidden="true">＋</span> #${quote.quotation_number}</td><td>${escapeHtml(quote.customers?.company_name || quote.customers?.full_name || quote.walk_in_name || "—") + `<small>${escapeHtml(quote.customers?.customer_code || "")}</small>`}</td><td>${escapeHtml(quote.prepared_by || "—")}</td><td>${quote.repair_jobs ? escapeHtml(jobRef(quote.repair_jobs)) : "—"}</td><td>${quote.created_at ? new Date(quote.created_at).toLocaleString() : "—"}</td><td>${escapeHtml(quote.status)}${depositExpired ? ' <small class="section-note">Deposit window expired</small>' : ""}</td><td>${money(quote.total_usd)}</td><td>${Number(quote.total_zig || 0).toFixed(2)}</td></tr><tr class="quotation-actions-row" data-actions-for="${quote.id}" hidden><td colspan="9"><div class="quotation-action-bar"><span class="quotation-action-label">Quotation actions</span><div class="quotation-action-buttons"><button type="button" class="quote-action quote-action--green open-quote-job" data-id="${quote.id}" data-job-id="${quote.repair_job_id || ""}"><i data-lucide="clipboard-plus"></i> Open Job Card</button><button type="button" class="quote-action quote-action--orange record-quote-deposit" data-id="${quote.id}" data-job-id="${quote.repair_job_id || ""}" data-number="${quote.quotation_number}" data-total="${quote.total_usd}" ${depositExpired ? 'disabled title="Quotation deposits are accepted for seven days after issue"' : ""}><i data-lucide="badge-dollar-sign"></i> ${depositExpired ? "Deposit expired" : "Record Deposit"}</button><button type="button" class="quote-action quote-action--orange edit-quote" data-id="${quote.id}"><i data-lucide="pencil"></i> Amend / Edit</button><button type="button" class="quote-action quote-action--green print-quote" data-id="${quote.id}"><i data-lucide="printer"></i> Print</button><button type="button" class="quote-action quote-action--green whatsapp-quote" data-id="${quote.id}"><i data-lucide="message-circle"></i> WhatsApp</button><button type="button" class="quote-action quote-action--orange email-quote" data-id="${quote.id}"><i data-lucide="mail"></i> Email</button></div></div></td></tr>`;
  }).join("") : `<tr><td colspan="9" class="empty-state"><i data-lucide="file-x-2"></i><span>${quotationRows.length ? "No quotations match these filters" : "No quotations yet"}</span></td></tr>`;\n  if (filtered.length > quotationVisibleCount) quoteTable.insertAdjacentHTML("beforeend", `<tr class="quotation-load-more-row"><td colspan="9"><button type="button" class="quotation-load-more">Load more (${filtered.length - quotationVisibleCount} remaining)</button></td></tr>`);\n  quoteTable.querySelector(".quotation-load-more")?.addEventListener("click", () => { quotationVisibleCount += 50; renderQuotationRows(); });
  quoteTable.querySelectorAll(".quotation-row").forEach(row => {
    const toggle = () => {
      const expanded = row.getAttribute("aria-expanded") === "true";
      const detail = quoteTable.querySelector(`[data-actions-for="${CSS.escape(row.dataset.quoteId)}"]`);
      row.setAttribute("aria-expanded", String(!expanded));
      row.classList.toggle("is-expanded", !expanded);
      if (detail) detail.hidden = expanded;
      const mark = row.querySelector(".quote-expand-mark");
      if (mark) mark.textContent = expanded ? "＋" : "−";
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", event => {
      if (event.target === row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggle(); }
    });
  });
  quoteTable.querySelectorAll(".quotation-action-bar button").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const id = button.dataset.id;
    if (button.classList.contains("edit-quote")) return openQuoteEditor(id);
    if (button.classList.contains("open-quote-job")) {
      if (button.dataset.jobId) { window.location.href = `repairs.html?edit=${encodeURIComponent(button.dataset.jobId)}`; return; }
      return openQuotationJobApproval(id);
    }
    if (button.classList.contains("print-quote") || button.classList.contains("whatsapp-quote") || button.classList.contains("email-quote")) {
      const { data, error } = await fetchQuote(id);
      if (!data) { window.aprToast?.("Couldn't load quotation", "error", error?.message || "Please try again."); return; }
      if (button.classList.contains("print-quote")) return printDocument(data, "Quotation");
      if (button.classList.contains("whatsapp-quote")) return sendByWhatsApp("Quotation", data, button);
      if (button.classList.contains("email-quote")) return sendByEmail("Quotation", data, button);
    }
  }));
  if (window.lucide) lucide.createIcons();
}

["quote-filter-search", "quote-filter-number", "quote-filter-from", "quote-filter-to", "quote-filter-status"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderQuotationRows);
  document.getElementById(id).addEventListener("change", renderQuotationRows);
});
document.getElementById("quote-filter-clear").addEventListener("click", () => {
  ["quote-filter-search", "quote-filter-number", "quote-filter-from", "quote-filter-to", "quote-filter-status"].forEach(id => { document.getElementById(id).value = ""; });
  renderQuotationRows();
});

async function loadDocuments() {
  const [quotes, orders] = await Promise.all([
    supabase.from("quotations").select("id, quotation_number, status, total_usd, total_zig, created_at, prepared_by, customer_id, vehicle_id, fault_reported, customers(full_name,customer_code,is_company,company_name), walk_in_name, repair_job_id, repair_jobs(job_number, cro_number)").order("created_at", { ascending: false }),
    supabase.from("sales_orders").select("id, order_number, status, total_usd, total_zig, created_at, customers(full_name,customer_code,is_company,company_name), walk_in_name").order("created_at", { ascending: false }),
  ]);
  quotationRows = quotes.data || [];
  renderQuotationRows();
  orderTable.innerHTML = orders.data?.length ? orders.data.map(order => `<tr><td>#${order.order_number}</td><td>${escapeHtml(order.customers?.company_name || order.customers?.full_name || order.walk_in_name || "—")}<small>${escapeHtml(order.customers?.customer_code || "")}${order.customers?.is_company && order.customers?.company_name ? " · Company" : ""}</small></td><td>${order.created_at ? new Date(order.created_at).toLocaleString() : "—"}</td><td>${escapeHtml(order.status)}</td><td>${money(order.total_usd)}</td><td>${Number(order.total_zig || 0).toFixed(2)}</td><td><button type="button" class="btn edit-order" data-id="${order.id}"><i data-lucide="pencil"></i> Edit</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty-state"><i data-lucide="shopping-cart"></i><span>No sales orders yet</span></td></tr>`;
  document.querySelectorAll(".edit-order").forEach(button => button.addEventListener("click", () => openOrderEditor(button.dataset.id)));
  if (window.lucide) lucide.createIcons();
}

async function fetchQuote(id) {
  const richSelect = "*, quotation_items(*), customers(full_name, phone, email, customer_code, is_company, company_name), vehicles(make, model, year, license_plate, chassis_number, engine_number, body_type, odometer_out), repair_jobs(job_number, cro_number, fault_reported, diagnosis, odometer_in, fuel_level_in, driver_name, driver_phone, vehicles(make, model, year, license_plate, chassis_number, engine_number, body_type))";
  let { data, error } = await supabase.from("quotations").select(richSelect).eq("id", id).single();
  if (error) {
    console.warn("Full quotation lookup failed, retrying with fewer fields:", error.message);
    ({ data, error } = await supabase.from("quotations").select("*, quotation_items(*), customers(full_name,customer_code,is_company,company_name), repair_jobs(job_number)").eq("id", id).single());
  }
  if (error) console.error("Failed to load quotation details:", error);
  return { data, error };
}
async function fetchOrder(id) {
  const richSelect = "*, sales_order_items(*), customers(full_name, phone, email, customer_code, is_company, company_name), repair_jobs(job_number, cro_number, fault_reported, diagnosis, odometer_in, fuel_level_in, vehicles(make, model, year, license_plate, chassis_number, engine_number))";
  let { data, error } = await supabase.from("sales_orders").select(richSelect).eq("id", id).single();
  if (error) {
    console.warn("Full sales order lookup failed, retrying with fewer fields:", error.message);
    ({ data, error } = await supabase.from("sales_orders").select("*, sales_order_items(*), customers(full_name), repair_jobs(job_number)").eq("id", id).single());
  }
  if (error) console.error("Failed to load sales order details:", error);
  return { data, error };
}

async function renderEditor(container, totalNode, items, rate = exchangeRate, isQuotation = false, vatRate = 5) {
  const prefix = isQuotation ? "quote" : "order";
  container.innerHTML = items.map((item, index) => {
    const isLabour = itemType(item) === "labour";
    const flatEstimate = isLabour && /provider estimate/i.test(item.part_name || "");
    const min = isLabour && !flatEstimate ? "0.01" : "1";
    const step = isLabour && !flatEstimate ? "any" : "1";
    return `<article class="quotation-line"><span><strong>${escapeHtml(itemDisplayName(item))}</strong><small>${itemTypeLabel(item)} · ${flatEstimate ? "flat estimate USD" : isLabour ? "price per hour USD" : "unit price USD"}</small></span><div class="quotation-qty-control"><button type="button" class="quotation-qty-step" data-qty-action="minus" aria-label="Decrease quantity" ${flatEstimate ? "disabled" : ""}><i data-lucide="minus"></i></button><input class="amend-qty" data-index="${index}" type="number" min="${min}" step="${step}" value="${item.quantity}" ${flatEstimate ? "disabled" : ""} aria-label="Quantity" /><button type="button" class="quotation-qty-step" data-qty-action="plus" aria-label="Increase quantity" ${flatEstimate ? "disabled" : ""}><i data-lucide="plus"></i></button></div><input class="amend-price" data-index="${index}" type="number" min="0" step="0.01" value="${Number(item.unit_price_usd).toFixed(2)}" aria-label="Unit price USD" /></article>`;
  }).join("");
  const recalc = () => {
    const qtyInputs = [...container.querySelectorAll(".amend-qty")], priceInputs = [...container.querySelectorAll(".amend-price")];
    const current = items.map((item, index) => ({ ...item, quantity: Number(qtyInputs[index]?.value || 0), unit_price_usd: Number(priceInputs[index]?.value || 0) }));
    const totals = isQuotation ? quotationTotals(current, vatRate) : { subtotal: totalOf(current), vat: 0, total: totalOf(current) };
    totalNode.textContent = `${money(totals.total)}${totals.vat ? ` incl. VAT (${money(totals.vat)} on parts)` : ""} / ZiG ${Number(totals.total * rate).toFixed(2)}`;
    const put = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    put(`edit-${prefix}-subtotal`, money(totals.subtotal));
    put(`edit-${prefix}-vat`, money(totals.vat));
    put(`edit-${prefix}-summary-total`, money(totals.total));
    put(`edit-${prefix}-footer-total`, money(totals.total));
  };
  container.querySelectorAll("input").forEach(input => input.addEventListener("input", recalc));
  container.querySelectorAll(".quotation-qty-step").forEach(button => button.addEventListener("click", () => {
    const input = button.parentElement.querySelector(".amend-qty");
    if (!input || input.disabled) return;
    const current = Number(input.value) || 0;
    const step = input.step === "any" ? 0.25 : Number(input.step || 1);
    input.value = String(Math.max(Number(input.min || 0), current + (button.dataset.qtyAction === "plus" ? step : -step)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  if (window.lucide) lucide.createIcons();
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
  const vehicle = record.vehicles || job.vehicles || record.vehicle_details || {};
  const number = docNumber(record, kind);
  const isQuote = kind === "Quotation";
  const vatRate = Number(record.vat_rate ?? 5);
  const totals = isQuote ? quotationTotals(items || [], vatRate) : { subtotal: totalOf(items || []), vat: 0, total: Number(record.total_usd || totalOf(items || [])) };
  const vehicleText = vehicle.license_plate || vehicleLabel(vehicle)
    ? `${vehicleLabel(vehicle) || "vehicle"}${vehicle.license_plate ? ` (registration ${vehicle.license_plate})` : ""}`
    : "";
  const faultReported = job.fault_reported || record.fault_reported;
  const lines = (items || []).map((item, i) =>
    `${i + 1}. ${itemTypeLabel(item)}${itemType(item) === "part" ? `: ${item.part_name}` : ""} — ${itemQuantityDisplay(item)} × ${itemUnitPriceDisplay(item)} = ${usd(Number(item.quantity) * Number(item.unit_price_usd))}`
  ).join("\n");
  const contact = [biz.phone && `Tel: ${biz.phone}`, biz.email && `Email: ${biz.email}`].filter(Boolean).join(" | ");

  return [
    `Dear ${customer.full_name},`,
    customer.customer_code ? `Customer ID: ${customer.customer_code}` : null,
    customer.company_name ? `Company: ${customer.company_name}` : null,
    ``,
    isQuote
      ? `Thank you for choosing ${biz.business_name}. Please find below our Quotation No. ${number}, dated ${longDate(record.created_at)}${vehicleText ? `, for your ${vehicleText}` : ""}.`
      : `Thank you for your business. Please find below Sales Order No. ${number}, dated ${longDate(record.created_at)}${vehicleText ? `, for your ${vehicleText}` : ""}.`,
    ``,
    job.job_number ? `Job card: ${jobRef(job)}` : null,
    vehicleLabel(vehicle) || vehicle.license_plate ? `Vehicle: ${[vehicleLabel(vehicle), vehicle.license_plate].filter(Boolean).join(" · ")}` : null,
    vehicle.chassis_number ? `Chassis: ${vehicle.chassis_number}` : null,
    vehicle.engine_number ? `Engine: ${vehicle.engine_number}` : null,
    (job.odometer_in ?? record.vehicle_details?.odometer_in) != null ? `Odometer: ${Number(job.odometer_in ?? record.vehicle_details.odometer_in).toLocaleString()} km` : null,
    (job.fuel_level_in || record.vehicle_details?.fuel_level_in) ? `Fuel level: ${job.fuel_level_in || record.vehicle_details.fuel_level_in}` : null,
    job.driver_name || record.vehicle_details?.driver_name ? `Driver: ${[job.driver_name || record.vehicle_details.driver_name, job.driver_phone || record.vehicle_details?.driver_phone].filter(Boolean).join(" · ")}` : null,
    faultReported ? `Fault reported: ${faultReported}` : null,
    job.job_number ? `Diagnosis: ${job.diagnosis || "Diagnosis in progress"}` : null,
    job.job_number ? `` : null,
    isQuote ? `Quoted items:` : `Order items:`,
    lines || "(No items)",
    ``,
    isQuote && record.prepared_by ? `Created by: ${record.prepared_by}` : null,
    isQuote ? `Subtotal: ${usd(totals.subtotal)}\n${vatRate ? `VAT (${vatRate}% of parts): ${usd(totals.vat)}\n` : "VAT: Not applied\n"}Total: ${usd(totals.total)} (${zig(totals.total * Number(record.usd_to_zig_rate || 0))} at ${Number(record.usd_to_zig_rate || 0).toFixed(4)} ZiG per US dollar)` : `Total: ${usd(record.total_usd)} (${zig(record.total_zig)} at ${Number(record.usd_to_zig_rate || 0).toFixed(4)} ZiG per US dollar)`,
    ``,
    isQuote
      ? `This quotation is valid for seven (7) days from the date above, and prices are subject to the availability of parts. To proceed, kindly reply to confirm and we will schedule the work.`
      : `Kindly keep this sales order for your records. Should you have any questions, please do not hesitate to contact us.`,
    ``,
    `The ${isQuote ? "quotation" : "sales order"} document is attached as a PDF for your reference.`,
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
  const vehicle = record.vehicles || job.vehicles || record.vehicle_details || {};
  const number = docNumber(record, kind);
  const isQuote = kind === "Quotation";
  const vatRate = Number(record.vat_rate ?? 5);
  const totals = isQuote ? quotationTotals(items || [], vatRate) : { subtotal: totalOf(items || []), vat: 0, total: Number(record.total_usd || totalOf(items || [])) };
  const rows = (items || []).map(item => `
    <tr><td>${itemTypeLabel(item)}</td><td>${itemType(item) === "part" ? escapeHtml(item.part_name) : "—"}</td><td>${itemQuantityDisplay(item)}</td><td>${itemUnitPriceDisplay(item)}</td><td>${money(item.quantity * item.unit_price_usd)}</td></tr>
  `).join("") || `<tr><td colspan="5">No line items</td></tr>`;
  const contact = [biz.phone, biz.email].filter(Boolean).map(escapeHtml).join(" · ");

  return `
    <article class="quotation-document">
      <header class="quotation-paper-header">
        <div class="quotation-paper-brand">
          <img src="${SHOP_LOGO_PATH}" alt="${escapeHtml(biz.business_name)}" />
          <div><strong>${escapeHtml(biz.business_name)}</strong><span>${escapeHtml(biz.tagline || "Vehicle Sales, Parts & Repairs")}</span>${biz.address ? `<span>${escapeHtml(biz.address)}</span>` : ""}${contact ? `<span>${contact}</span>` : ""}</div>
        </div>
        <div class="quotation-paper-reference"><span>${kind}</span><strong>${escapeHtml(number)}</strong><time>${longDate(record.created_at)}</time></div>
      </header>
      <section class="quotation-paper-customer">
        <span class="quotation-paper-kicker">${kind === "Quotation" ? "Prepared for" : "Customer"}</span>
        <strong>${escapeHtml(customer.full_name)}</strong>
        <span>Customer ID: ${escapeHtml(customer.customer_code || "—")}${customer.is_company && customer.company_name ? " · Company: " + escapeHtml(customer.company_name) : ""}</span>
        <span>${escapeHtml(customer.phone)}${customer.email && customer.email !== "—" ? ` · ${escapeHtml(customer.email)}` : ""}</span>
      </section>
      ${isQuote && record.prepared_by ? `<p class="quotation-paper-note">Created by: ${escapeHtml(record.prepared_by)}</p>` : ""}
      ${isQuote
        ? (vehicle.make || vehicle.model ? `<section class="quotation-paper-vehicle">
            ${vehicle.make ? `<div><span class="quotation-paper-kicker">Vehicle name</span><strong>${escapeHtml(vehicle.make)}</strong></div>` : ""}
            ${vehicle.model ? `<div><span class="quotation-paper-kicker">Model</span><strong>${escapeHtml(vehicle.model)}</strong></div>` : ""}
          </section>` : "")
        : (job.job_number || record.vehicle_id || record.vehicles ? `<section class="quotation-paper-vehicle">
            ${job.job_number ? `<div><span class="quotation-paper-kicker">Job card</span><strong>${escapeHtml(jobRef(job))}</strong></div>` : ""}
            <div><span class="quotation-paper-kicker">Vehicle</span><strong>${escapeHtml(vehicleLabel(vehicle) || "Vehicle")}${vehicle.license_plate ? ` · ${escapeHtml(vehicle.license_plate)}` : ""}</strong></div>
            ${vehicle.chassis_number ? `<div><span class="quotation-paper-kicker">Chassis</span><strong>${escapeHtml(vehicle.chassis_number)}</strong></div>` : ""}
            ${vehicle.engine_number ? `<div><span class="quotation-paper-kicker">Engine</span><strong>${escapeHtml(vehicle.engine_number)}</strong></div>` : ""}
            ${(job.odometer_in ?? record.vehicle_details?.odometer_in) != null ? `<div><span class="quotation-paper-kicker">Odometer in</span><strong>${Number(job.odometer_in ?? record.vehicle_details.odometer_in).toLocaleString()} km</strong></div>` : ""}
            ${(job.fuel_level_in || record.vehicle_details?.fuel_level_in) ? `<div><span class="quotation-paper-kicker">Fuel level</span><strong>${escapeHtml(job.fuel_level_in || record.vehicle_details.fuel_level_in)}</strong></div>` : ""}
            ${(job.driver_name || record.vehicle_details?.driver_name) ? `<div><span class="quotation-paper-kicker">Driver</span><strong>${escapeHtml([job.driver_name || record.vehicle_details.driver_name, job.driver_phone || record.vehicle_details?.driver_phone].filter(Boolean).join(" · "))}</strong></div>` : ""}
            ${(job.fault_reported || record.fault_reported) ? `<div class="quotation-paper-condition"><span class="quotation-paper-kicker">Customer concern</span><p>${escapeHtml(job.fault_reported || record.fault_reported)}</p></div>` : ""}
            ${job.job_number ? `<div class="quotation-paper-condition"><span class="quotation-paper-kicker">Technician's diagnosis</span><p>${escapeHtml(job.diagnosis || "Diagnosis in progress")}</p></div>` : ""}
          </section>` : "")}
      ${isQuote && record.fault_reported ? `<section class="quotation-paper-condition"><span class="quotation-paper-kicker">Work to be done</span><p>${escapeHtml(record.fault_reported)}</p></section>` : ""}
      <h3 class="quotation-paper-lines-title">${kind === "Quotation" ? "Quoted items" : "Order items"}</h3>
      <table class="quotation-paper-table"><thead><tr><th>Type</th><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <section class="quotation-paper-total">
        ${isQuote ? `<span>Subtotal</span><span>${money(totals.subtotal)}</span><span>${vatRate ? `VAT (${vatRate}% of parts)` : "VAT not applied"}</span><span>${money(totals.vat)}</span>` : ""}
        <span>Total payable</span>
        <strong>${money(totals.total)}</strong>
        <span>ZiG ${Number(totals.total * Number(record.usd_to_zig_rate || 0)).toFixed(2)}</span>
      </section>
      <p class="quotation-paper-note">${kind === "Quotation" ? "Quotation valid for 7 days. Parts and prices are subject to availability." : `Thank you for choosing ${escapeHtml(biz.business_name)}.`}</p>
      <footer class="quotation-paper-footer">
        <span>Vehicle diagnostics · Repairs · Servicing · Spare parts</span>
        <span>Call or WhatsApp: <a href="tel:+263733656061">+263 733 656 061</a> · <a href="tel:+263716421990">+263 716 421 990</a></span>
      </footer>
    </article>`;
}

function printDocument(record, kind) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert(`Allow pop-ups for this site to print the ${kind.toLowerCase()}.`);
    return;
  }
  const html = buildDetailHtml(record, kind, itemsOf(record, kind) || []);
  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <base href="${escapeHtml(window.location.href)}">
      <title>${escapeHtml(kind)} ${escapeHtml(docNumber(record, kind))}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #17212b; font: 14px Arial, sans-serif; }
        .quotation-document { display: block; visibility: visible; max-width: 190mm; margin: 0 auto; padding: 8mm; background: #fff; }
        .quotation-paper-header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #222; padding-bottom: 16px; }
        .quotation-paper-brand { display: flex; gap: 12px; align-items: center; }
        .quotation-paper-brand img { width: 72px; height: 72px; object-fit: contain; }
        .quotation-paper-brand div, .quotation-paper-reference, .quotation-paper-customer { display: grid; gap: 5px; }
        .quotation-paper-reference { text-align: right; align-content: start; }
        .quotation-paper-reference strong { font-size: 20px; }
        .quotation-paper-customer, .quotation-paper-vehicle { margin: 18px 0; padding: 14px; background: #f4f6f7; }
        .quotation-paper-vehicle { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .quotation-paper-kicker { display: block; color: #59636e; font-size: 11px; text-transform: uppercase; }
        .quotation-paper-lines-title { margin: 22px 0 8px; }
        .quotation-paper-table { width: 100%; border-collapse: collapse; }
        .quotation-paper-table th, .quotation-paper-table td { border-bottom: 1px solid #d5d9dc; padding: 9px 7px; text-align: left; }
        .quotation-paper-total { display: grid; justify-items: end; gap: 5px; margin-top: 20px; }
        .quotation-paper-total strong { font-size: 22px; }
        .quotation-paper-note, .quotation-paper-footer { margin-top: 20px; color: #59636e; }
        .quotation-paper-footer { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid #d5d9dc; padding-top: 12px; font-size: 11px; }
        @media print {
          html, body, .quotation-document, .quotation-document * { visibility: visible !important; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          .quotation-document { display: block !important; }
        }
      </style>
    </head><body>${html}<script>
      window.addEventListener("load", async () => {
        await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)));
        window.addEventListener("afterprint", () => window.close(), { once: true });
        window.focus();
        window.print();
      }, { once: true });
    <\/script></body></html>`);
  printWindow.document.close();
}

async function captureDetailCanvas(kind, record) {
  if (typeof window.html2canvas !== "function") {
    try {
      await lib("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    } catch {
      throw new Error("The document image tool could not be loaded. Check your internet connection and reload the page.");
    }
  }
  if (typeof window.html2canvas !== "function") throw new Error("The document image tool did not load correctly.");
  const paper = document.createElement("div");
  paper.id = "doc-capture";
  paper.innerHTML = buildDetailHtml(record, kind, itemsOf(record, kind) || []);
  Object.assign(paper.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "794px",
    maxWidth: "none",
    zIndex: "2147483647",
    visibility: "hidden",
    pointerEvents: "none",
    backgroundColor: "#fff",
  });
  document.body.appendChild(paper);
  try {
    const imgs = [...paper.querySelectorAll("img")];
    await Promise.all(imgs.map(img => img.decode().catch(() => undefined)));
    if (document.fonts?.ready) await document.fonts.ready;
    const width = paper.offsetWidth, height = paper.offsetHeight;
    return await window.html2canvas(paper, {
      backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false,
      width, height, windowWidth: Math.max(width + 40, document.documentElement.clientWidth),
      scrollX: 0, scrollY: 0,
      onclone(clonedDocument) {
        const clonedPaper = clonedDocument.getElementById("doc-capture");
        if (clonedPaper) clonedPaper.style.visibility = "visible";
      },
    });
  } finally {
    paper.remove();
  }
}

// ---------- Send: download the document image first, then open the message ----------
async function downloadDocumentImage(kind, record) {
  const canvas = await captureDetailCanvas(kind, record);
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
  if (button && busyActions.has(button)) return;
  if (button) busyActions.add(button);
  const html = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = `<i data-lucide="loader-circle"></i> ${label}`; if (window.lucide) lucide.createIcons(); }
  try { return await fn(); }
  finally {
    if (button) {
      busyActions.delete(button);
      button.disabled = false;
      button.innerHTML = html;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function createDetailPdf(kind, record) {
  if (!window.jspdf) await lib("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  if (!window.jspdf?.jsPDF) throw new Error("The PDF generator did not load correctly.");
  const canvas = await captureDetailCanvas(kind, record);
  const pdf = new window.jspdf.jsPDF("p", "mm", "a4");
  const width = 190;
  const pageHeight = 277;
  const imageHeight = canvas.height * width / canvas.width;
  const image = canvas.toDataURL("image/png");
  const pageCount = Math.max(1, Math.ceil(imageHeight / pageHeight));
  for (let page = 0; page < pageCount; page++) {
    if (page > 0) pdf.addPage();
    pdf.addImage(image, "PNG", 10, 10 - page * pageHeight, width, imageHeight);
  }
  const prefix = kind === "Quotation" ? "Quotation" : "Sales-Order";
  return new File([pdf.output("blob")], `${prefix}-${docNumber(record, kind)}.pdf`, { type: "application/pdf" });
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function sendByWhatsApp(kind, record, button) {
  const customer = resolveCustomer(record);
  const phone = whatsappNumber(customer.phone !== "—" ? customer.phone : "");
  if (!phone) return window.aprToast?.("Customer WhatsApp number is missing", "error", "Add a phone number to the customer record before sharing.");
  const tab = window.open("", "_blank", "noopener");
  try {
    const file = await withBusy(button, "Preparing PDF…", () => createDetailPdf(kind, record));
    const text = buildDetailText(record, kind, itemsOf(record, kind));
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], text });
        if (tab && !tab.closed) tab.close();
        return;
      } catch (error) {
        if (error.name === "AbortError") { if (tab && !tab.closed) tab.close(); return; }
      }
    }
    saveFile(file);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    if (tab && !tab.closed) tab.location.href = url; else window.location.href = url;
    window.aprToast?.("PDF downloaded; WhatsApp is opening", "success", "Attach the PDF in WhatsApp Web or the app, then send.");
  } catch (err) {
    if (tab && !tab.closed) tab.close();
    window.aprToast?.("Couldn't prepare the message", "error", err.message || String(err));
  }
}

async function sendByEmail(kind, record, button) {
  const customer = resolveCustomer(record);
  const email = (customer.email && customer.email !== "—" ? customer.email : "").trim();
  if (!email) return window.aprToast?.("Customer email address is missing", "error", "Add an email address to the customer record before sharing.");
  try {
    const file = await withBusy(button, "Sending PDF…", () => createDetailPdf(kind, record));
    const subject = `${kind === "Quotation" ? "Quotation" : "Sales Order"} No. ${docNumber(record, kind)} — ${biz.business_name}`;
    const{error}=await supabase.functions.invoke("send-receipt-email",{body:{
      to:email,subject,text:buildDetailText(record,kind,itemsOf(record,kind)),
      fileName:file.name,mimeType:file.type,fileBase64:await fileBase64(file),
    }});
    if(error)throw error;
    window.aprToast?.(`${kind} emailed to ${email}`, "success");
  } catch (err) {
    console.error("Email send failed:",err);
    try {
      const file=await createDetailPdf(kind,record);saveFile(file);
      const subject = `${kind === "Quotation" ? "Quotation" : "Sales Order"} No. ${docNumber(record, kind)} — ${biz.business_name}`;
      window.location.href=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildDetailText(record,kind,itemsOf(record,kind))+"\n\nThe PDF was downloaded. Attach it before sending.")}`;
      window.aprToast?.("Automatic email failed", "error", `${err.message || String(err)}. A draft was opened; attach the downloaded PDF.`);
    } catch (fallbackError) {
      window.aprToast?.("Couldn't prepare the email", "error", fallbackError.message || String(fallbackError));
    }
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

let pendingQuotationJobId = null;

function openQuotationJobApproval(quotationId) {
  pendingQuotationJobId = quotationId;
  const modal = document.getElementById("quote-job-approval-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.style.display = "flex";
  document.getElementById("quote-job-approval-confirm")?.focus();
  if (window.lucide) lucide.createIcons();
}

function closeQuotationJobApproval() {
  pendingQuotationJobId = null;
  const modal = document.getElementById("quote-job-approval-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.style.display = "";
}

document.getElementById("quote-job-approval-cancel")?.addEventListener("click", closeQuotationJobApproval);
document.getElementById("quote-job-approval-modal")?.addEventListener("click", event => {
  if (event.target === event.currentTarget) closeQuotationJobApproval();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.getElementById("quote-job-approval-modal")?.classList.contains("hidden") === false) {
    closeQuotationJobApproval();
  }
});
document.getElementById("quote-job-approval-confirm")?.addEventListener("click", async event => {
  if (!pendingQuotationJobId) return;
  const quotationId = pendingQuotationJobId;
  const button = event.currentTarget;
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<i data-lucide="loader-circle"></i> Opening…`;
  if (window.lucide) lucide.createIcons();
  const { error } = await supabase.from("quotations")
    .update({ status: "Approved", updated_at: new Date().toISOString() })
    .eq("id", quotationId);
  button.disabled = false;
  button.innerHTML = originalHtml;
  if (window.lucide) lucide.createIcons();
  if (error) {
    alert("Couldn't mark the quotation approved: " + error.message);
    return;
  }
  closeQuotationJobApproval();
  window.location.href = `repairs.html?quote=${encodeURIComponent(quotationId)}`;
});

// ---------- Quotation editor ----------

async function openQuoteEditor(id) {
  const { data, error } = await fetchQuote(id);
  if (!data) { alert("Couldn't load that quotation" + (error ? `: ${error.message}` : ".")); return; }
  editingQuote = data;
  setText("edit-quote-number", editingQuote.quotation_number);\n  setText("edit-quote-status", editingQuote.status || "Draft");\n  setText("edit-quote-cid", `CID ${resolveCustomer(editingQuote).customer_code || "—"}`);\n  setText("edit-quote-customer", resolveCustomer(editingQuote).full_name);
  editingQuoteDetailText = buildDetailText(editingQuote, "Quotation", editingQuote.quotation_items);
  document.getElementById("quote-detail-text").innerHTML = buildDetailHtml(editingQuote, "Quotation", editingQuote.quotation_items);\n  quoteModal.querySelector(".quotation-preview-section")?.removeAttribute("open");
  await renderEditor(document.getElementById("edit-quote-lines"), document.getElementById("edit-quote-total"), editingQuote.quotation_items, editingQuote.usd_to_zig_rate, true, Number(editingQuote.vat_rate ?? 5));
  openQuotationModal(quoteModal);
  if (window.lucide) lucide.createIcons();
}
async function saveQuoteChanges() {
  if (!editingQuote) return;
  const inputs = [...document.querySelectorAll("#edit-quote-lines .amend-qty")]; const prices = [...document.querySelectorAll("#edit-quote-lines .amend-price")]; const rate = editingQuote.usd_to_zig_rate;
  const items = [];
  for (let i = 0; i < editingQuote.quotation_items.length; i++) {
    const quantity = Number(inputs[i].value);
    const unit = Number(prices[i].value);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unit) || unit < 0) {
      alert("Every quotation line needs a positive quantity and a non-negative price.");
      return;
    }
    items.push({ id: editingQuote.quotation_items[i].id, quantity, unit_price_usd: unit });
  }
  if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) {
    alert("The quotation exchange rate is invalid.");
    return;
  }
  const { error } = await supabase.rpc("amend_customer_quotation_with_vat", {
    p_quotation_id: editingQuote.id,
    p_items: items,
    p_vat_rate: Number(editingQuote.vat_rate ?? 5),
  });
  if (error) {
    alert(`Couldn't save quotation changes: ${error.message}`);
    return;
  }
  closeModal(quoteModal, true); await loadDocuments();
}
async function createOrderFromQuote() {
  if (!editingQuote) return;
  const { data: existingOrder, error: existingOrderError } = await supabase.from("sales_orders")
    .select("id, order_number")
    .eq("quotation_id", editingQuote.id)
    .limit(1)
    .maybeSingle();
  if (existingOrderError) {
    alert("Couldn't check whether this quotation already has an order: " + existingOrderError.message);
    return;
  }
  if (existingOrder) {
    closeModal(quoteModal);
    await openOrderEditor(existingOrder.id);
    return;
  }
  const { data: order, error } = await supabase.from("sales_orders").insert([{
    quotation_id: editingQuote.id, customer_id: editingQuote.customer_id, repair_job_id: editingQuote.repair_job_id,
    walk_in_name: editingQuote.walk_in_name, walk_in_phone: editingQuote.walk_in_phone, walk_in_email: editingQuote.walk_in_email,
    usd_to_zig_rate: editingQuote.usd_to_zig_rate, total_usd: editingQuote.total_usd, total_zig: editingQuote.total_zig, status: "Draft",
  }]).select().single();
  if (error) {
    if (error.code === "23505") {
      const { data: duplicate } = await supabase.from("sales_orders")
        .select("id")
        .eq("quotation_id", editingQuote.id)
        .limit(1)
        .maybeSingle();
      if (duplicate) {
        closeModal(quoteModal);
        await openOrderEditor(duplicate.id);
        return;
      }
    }
    alert("Failed to confirm sales order: " + error.message);
    return;
  }
  const rate = Number(editingQuote.usd_to_zig_rate);
  const items = (editingQuote.quotation_items || []).map(item => {
    const quantity = Number(item.quantity);
    const unitUsd = Number(item.unit_price_usd);
    const totalUsd = Number.isFinite(Number(item.total_usd)) ? Number(item.total_usd) : quantity * unitUsd;
    const unitZig = Number.isFinite(Number(item.unit_price_zig)) ? Number(item.unit_price_zig) : unitUsd * rate;
    const totalZig = Number.isFinite(Number(item.total_zig)) ? Number(item.total_zig) : totalUsd * rate;
    return {
      sales_order_id: order.id,
      part_id: item.part_id || null,
      item_type: itemType(item) || "part",
      part_name: String(item.part_name || item.description || "Quotation item").trim(),
      quantity,
      cost_price_usd: Number(item.cost_price_usd) || 0,
      markup_pct: Number(item.markup_pct) || 0,
      unit_price_usd: unitUsd,
      total_usd: totalUsd,
      unit_price_zig: unitZig,
      total_zig: totalZig,
    };
  });
  if (!items.length || !Number.isFinite(rate) || rate <= 0 ||
      items.some(item => !item.part_name || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
        !Number.isFinite(item.unit_price_usd) || item.unit_price_usd < 0 ||
        !Number.isFinite(item.total_usd) || !Number.isFinite(item.unit_price_zig) ||
        !Number.isFinite(item.total_zig))) {
    const { error: cleanupError } = await supabase.from("sales_orders").delete().eq("id", order.id);
    alert("This quotation has incomplete or invalid line rows, so the sales order was not confirmed. Check the quotation items and try again." +
      (cleanupError ? " The empty draft order could not be removed: " + cleanupError.message : ""));
    return;
  }
  const { error: itemsError } = await supabase.from("sales_order_items").insert(items);
  if (itemsError) {
    const { error: cleanupError } = await supabase.from("sales_orders").delete().eq("id", order.id);
    if (cleanupError) {
      console.error("Could not remove sales order after its items failed to save:", cleanupError);
      alert(`Sales order was created, but its items failed: ${itemsError.message}. The incomplete order could not be removed (${cleanupError.message}); refresh the order list before retrying.`);
    } else {
      alert("Sales order items failed to save: " + itemsError.message + ". The incomplete order was removed; you can safely try again.");
    }
    return;
  }
  closeModal(quoteModal);
  await loadDocuments();
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
  setText("edit-order-number", editingOrder.order_number);\n  setText("edit-order-status", editingOrder.status || "Draft");\n  setText("edit-order-cid", `CID ${resolveCustomer(editingOrder).customer_code || "—"}`);\n  setText("edit-order-customer", resolveCustomer(editingOrder).full_name);
  editingOrderDetailText = buildDetailText(editingOrder, "Sales Order", editingOrder.sales_order_items);
  document.getElementById("order-detail-text").innerHTML = buildDetailHtml(editingOrder, "Sales Order", editingOrder.sales_order_items);\n  orderModal.querySelector(".quotation-preview-section")?.removeAttribute("open");
  await renderEditor(document.getElementById("edit-order-lines"), document.getElementById("edit-order-total"), editingOrder.sales_order_items, editingOrder.usd_to_zig_rate);
  if (!salespeople.length) await loadSalespeople();
  const salespersonSelect = document.getElementById("edit-order-salesperson");
  if (salespersonSelect) salespersonSelect.value = editingOrder.salesperson_id || "";
  openQuotationModal(orderModal);
  if (window.lucide) lucide.createIcons();
}
async function saveOrderChanges() {
  if (!editingOrder) return;
  const inputs = [...document.querySelectorAll("#edit-order-lines .amend-qty")];
  const prices = [...document.querySelectorAll("#edit-order-lines .amend-price")];
  if (inputs.length !== editingOrder.sales_order_items.length || prices.length !== editingOrder.sales_order_items.length) {
    alert("The order lines changed unexpectedly. Reload the order before saving.");
    return;
  }
  const items = editingOrder.sales_order_items.map((item, index) => ({
    id: item.id,
    quantity: Number(inputs[index].value),
    unit_price_usd: Number(prices[index].value),
  }));
  if (items.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 ||
      !Number.isFinite(item.unit_price_usd) || item.unit_price_usd < 0)) {
    alert("Every order line needs a positive quantity and a non-negative price.");
    return;
  }
  const salespersonId = document.getElementById("edit-order-salesperson")?.value || null;
  const { error: saveError } = await supabase.rpc("save_sales_order_with_stock", {
    p_sales_order_id: editingOrder.id,
    p_salesperson_id: salespersonId,
    p_items: items,
  });
  if (saveError) {
    alert(`Couldn't save the order: ${saveError.message}`);
    return;
  }

  const total = items.reduce((sum, item) => sum + Math.round(item.quantity * item.unit_price_usd * 100) / 100, 0);
  const receiptOk = await ensureReceiptForOrder(editingOrder.id, total);
  closeModal(orderModal);
  await loadDocuments();

  if (receiptOk === "deposit") {
    window.aprToast?.("Sales order saved; the quotation deposit remains customer credit.", "success");
  }
  if (receiptOk === true && await window.aprConfirm("Sales order saved and a receipt has been recorded. View the printed receipt now?", { title: "View receipt", confirmLabel: "Open receipt" })) {
    window.location.href = `receipts.html?order=${encodeURIComponent(editingOrder.id)}`;
  }
}

// Creates (or confirms the existence of) a receipt tied to this sales
// order — this is what makes the amount show up in the Receipts page and
// in the dashboard's revenue figures.
async function ensureReceiptForOrder(orderId, amount) {
  const { data: order, error: orderError } = await supabase.from("sales_orders").select("quotation_id").eq("id", orderId).single();
  if (orderError) {
    alert("Order saved, but its quotation deposit status couldn't be checked: " + orderError.message);
    return false;
  }
  if (order.quotation_id) {
    const { data: availableCredits, error: creditError } = await supabase.from("customer_credit_balances")
      .select("deposit_receipt_id").eq("quotation_id", order.quotation_id).gt("available_amount", 0.005);
    if (creditError) {
      alert("Order saved, but its customer credit couldn't be checked: " + creditError.message);
      return false;
    }
    if (availableCredits?.length) return "deposit";
  }
  const { data: existing, error: checkError } = await supabase.from("receipts").select("id").eq("sales_order_id", orderId).limit(1);
  if (checkError) {
    alert("Order saved, but its existing receipt couldn't be checked: " + checkError.message);
    return false;
  }
  if (existing && existing.length) return true;
  const { error } = await supabase.from("receipts").insert([{ sales_order_id: orderId, amount }]);
  if (error) {
    if (error.code === "23505") {
      const { data: duplicate, error: duplicateError } = await supabase.from("receipts")
        .select("id")
        .eq("sales_order_id", orderId)
        .is("voided_at", null)
        .limit(1)
        .maybeSingle();
      if (!duplicateError && duplicate) return true;
      if (duplicateError) console.error("Could not verify duplicate sales-order receipt:", duplicateError);
    }
    console.error("Failed to create receipt for sales order:", error);
    alert("Order saved, but the receipt couldn't be created: " + error.message);
    return false;
  }
  return true;
}

let activeQuotationModal = null;
let quotationModalReturnFocus = null;
function modalSnapshot(modal) {
  return [...modal.querySelectorAll("input,select,textarea")].map(input => input.value).join("|");
}
function openQuotationModal(modal) {
  quotationModalReturnFocus = document.activeElement;
  activeQuotationModal = modal;
  modal.dataset.initialSnapshot = modalSnapshot(modal);
  modal.classList.remove("hidden");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("quotation-modal-open");
  modal.querySelector("button:not(:disabled),input:not(:disabled),select:not(:disabled)")?.focus();
}
function closeModal(modal, force = false) {
  if (!modal) return;
  const changed = modal.dataset.initialSnapshot !== undefined && modalSnapshot(modal) !== modal.dataset.initialSnapshot;
  if (!force && changed && !window.confirm("Discard changes?")) return;
  modal.classList.add("hidden");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  delete modal.dataset.initialSnapshot;
  if (activeQuotationModal === modal) {
    activeQuotationModal = null;
    document.body.classList.remove("quotation-modal-open");
    quotationModalReturnFocus?.focus?.();
    quotationModalReturnFocus = null;
  }
}

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

for (const modal of [quoteModal, orderModal, document.getElementById("quote-job-approval-modal")]) {
  if (!modal) continue;
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(modal); });
}
document.getElementById("quote-edit-close")?.addEventListener("click", () => closeModal(quoteModal));
document.getElementById("order-edit-close")?.addEventListener("click", () => closeModal(orderModal));
document.addEventListener("keydown", event => {
  if (!activeQuotationModal) return;
  if (event.key === "Escape") { event.preventDefault(); closeModal(activeQuotationModal); return; }
  if (event.key !== "Tab") return;
  const focusable = [...activeQuotationModal.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href],[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
on("edit-quote-save", event => withBusy(event.currentTarget, "Saving…", saveQuoteChanges));
on("edit-quote-order", event => withBusy(event.currentTarget, "Creating order…", createOrderFromQuote));
on("edit-quote-cancel", () => closeModal(quoteModal));
on("edit-order-save", event => withBusy(event.currentTarget, "Saving order…", saveOrderChanges));
on("edit-order-cancel", () => closeModal(orderModal));

on("quote-detail-copy", () => copyDetailText(editingQuoteDetailText, document.getElementById("quote-detail-copy-status")));
on("quote-detail-print", () => editingQuote && printDocument(editingQuote, "Quotation"));
on("quote-detail-pdf", async event => {
  if (!editingQuote) return;
  try { saveFile(await withBusy(event.currentTarget, "Preparing PDF…", () => createDetailPdf("Quotation", editingQuote))); }
  catch (error) { window.aprToast?.("Couldn't create quotation PDF", "error", error.message || String(error)); }
});
on("quote-detail-email", (e) => editingQuote && sendByEmail("Quotation", editingQuote, e.currentTarget));
on("quote-detail-whatsapp", (e) => editingQuote && sendByWhatsApp("Quotation", editingQuote, e.currentTarget));

on("order-detail-copy", () => copyDetailText(editingOrderDetailText, document.getElementById("order-detail-copy-status")));
on("order-detail-print", () => editingOrder && printDocument(editingOrder, "Sales Order"));
on("order-detail-email", (e) => editingOrder && sendByEmail("Sales Order", editingOrder, e.currentTarget));
on("order-detail-whatsapp", (e) => editingOrder && sendByWhatsApp("Sales Order", editingOrder, e.currentTarget));

document.addEventListener("DOMContentLoaded", async () => {
  toggleWalkinFields();
  loadBusiness().catch(() => {});
  try {
    await loadBaseData();
    const requestedJob = new URLSearchParams(window.location.search).get("job");
    const params = new URLSearchParams(window.location.search);
    const requestedCustomer = params.get("customer");
    const requestedVehicle = params.get("vehicle");
    if (requestedCustomer && customers.some(customer => customer.id === requestedCustomer)) {
      customerSelect.value = requestedCustomer;
      renderQuoteVehicles(params.get("vehicle") || "");
      fillWalkinDetails(customers.find(customer => customer.id === requestedCustomer));
      document.getElementById("quote-fault").value = params.get("fault") || "";
      toggleWalkinFields();
    }
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


document.getElementById("quote-is-company")?.addEventListener("change", event => {
 const enabled=event.currentTarget.checked,wrap=document.getElementById("quote-company-name-wrap"),input=document.getElementById("quote-company-name");
 if(wrap)wrap.hidden=!enabled;if(input){input.required=enabled;if(!enabled)input.value="";}
});
