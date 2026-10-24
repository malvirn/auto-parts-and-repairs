// ========= Job Cards module =========
import supabase from "./supabaseClient.js";
import { STATUS_META, messageForStatus } from "./portalShared.js";
import { hydrate } from "./data-cache.js";

<<<<<<< HEAD
const $ = (id) => document.getElementById(id);
=======
const tableBody = document.getElementById("repairs-table");
const form = document.getElementById("job-form");
const customerSelect = document.getElementById("job-customer");
const jobPlateSelect = document.getElementById("job-plate");
const jobTechnicianSelect = document.getElementById("job-technician");
const jobFormMessage = document.getElementById("job-form-message");
>>>>>>> bfabf35 (Initial project upload)

const tableBody = $("repairs-table");
const form = $("job-form");
const customerSelect = $("job-customer");
const jobPlateSelect = $("job-plate");

// ---- Job card (view / update) elements ----
const modal = $("edit-modal");
const editJobNumber = $("edit-job-number");
const editStatus = $("edit-status");
const editDiagnosis = $("edit-diagnosis");
const editLabour = $("edit-labour");
const editParts = $("edit-parts");
const editTechnician = $("edit-technician");
const editSaveBtn = $("edit-save");
const editCancelBtn = $("edit-cancel");
const editMarkCollectedBtn = $("edit-mark-collected");
const editWhatsappBtn = $("edit-whatsapp");
const editDiagnosisEta = $("edit-diagnosis-eta");
const editDiagnosisWhatsappBtn = $("edit-diagnosis-whatsapp");
const editDiagnosisEmailBtn = $("edit-diagnosis-email");
const editQuoteLink = $("edit-quote-link");
const editReceiptLink = $("edit-receipt-link");
const zigTotal = $("zig-total");
const editCollectionFields = $("edit-collection-fields");
const editOdometer = $("edit-odometer");
const editCollectionNotes = $("edit-collection-notes");
const jobPartSelect = $("job-part-select");
const jobPartQty = $("job-part-qty");
const jobPartAddBtn = $("job-part-add");
const jobPartsList = $("job-parts-list");
const pickupCountdownBlock = $("pickup-countdown-block");
const pickupCountdownDisplay = $("pickup-countdown");
const applyParkingFeeBtn = $("apply-parking-fee");
const editRateTier = $("edit-rate-tier");
const editHours = $("edit-hours");
const incidentalAddBtn = $("incidental-add");

// ---- New job card (intake) elements ----
const newRateTier = $("job-rate-tier");
const newHours = $("job-hours");
const newLabour = $("job-labour");
const newTechnician = $("job-technician");
const newPartSelect = $("new-part-select");
const newPartQty = $("new-part-qty");
const formMessage = $("job-form-message");

let currentEditJobId = null;
let currentEditJob = null;
let newlyCreatedJobId = null;
let cachedRate = null;
let customersList = [];          // [{ id, full_name, phone, email, customer_type, vehicles: [...] }]
let pendingCollection = false;
let countdownInterval = null;
let rateTiers = [];
let mechanicsList = [];          // [{ id, full_name, openJobs: number }]
let partsCatalog = [];           // [{ id, name, selling_price, quantity_in_stock }]
let jobsById = new Map();
let techNamesById = {};
let businessInfo = null;

// Intake state
let ownerType = "individual";    // "individual" | "company"
let stagedParts = [];            // [{ part_id, name, price, qty }]
let stagedIncidentals = [];      // [{ description, amount }]
let tierTouched = false;         // staff picked a tier by hand → stop auto-detecting from make
let labourTouched = false;       // staff typed a labour amount by hand

// Current job card line items (for totals + printing)
let cardParts = [];
let cardIncidentals = [];
let cardIncidentalsTotal = 0;

// Only these show up in the day-to-day status dropdown. "Collected" is
// reached only via the dedicated "Mark as Collected" button.
const STATUS_LIST = ["Received", "Diagnosing", "Ready for Pickup", "Unclaimed"];
const TERMINAL_STATUS = "Collected";
const NEW_VALUE = "__new";

const PARKING_GRACE_DAYS = 7;
const PARKING_FEE_PER_DAY = 3;

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// =====================================================================
// Labour charges (vehicle rate tiers) — managed in Settings → Labour charges
// =====================================================================
async function loadRateTiers() {
  const { data, error } = await supabase.from("vehicle_rate_tiers").select("*").order("sort_order");
  if (error) { console.error("Error loading rate tiers:", error); return; }
  rateTiers = data || [];
<<<<<<< HEAD
  const options = rateTiers.map(t => `<option value="${t.id}">${escapeHtml(t.tier_name)} — ${money(t.hourly_rate)}/hr</option>`).join("");
  if (editRateTier) editRateTier.innerHTML = options || `<option value="">No labour charges set — add them in Settings</option>`;
  if (newRateTier) newRateTier.innerHTML = options || `<option value="">No labour charges set — add them in Settings</option>`;
  autoPickNewTier();
=======
  if (editRateTier) {
    editRateTier.innerHTML = rateTiers
      .filter(t => t.is_active !== false)
      .map(t => `<option value="${t.id}">${escapeHtml(t.tier_name)} — $${Number(t.hourly_rate).toFixed(2)}/hr</option>`)
      .join("");
  }
>>>>>>> bfabf35 (Initial project upload)
}

// Case-insensitive match against each tier's makes list; falls back to the
// default tier if nothing matches (or the first tier at all).
function detectTierForMake(make) {
  const activeRateTiers = rateTiers.filter(t => t.is_active !== false);
  if (!make) return activeRateTiers.find(t => t.is_default) || activeRateTiers[0];
  const needle = make.trim().toLowerCase();
  const matched = activeRateTiers.find(t => (t.makes || []).some(m => m.toLowerCase() === needle));
  return matched || activeRateTiers.find(t => t.is_default) || activeRateTiers[0];
}

function recalcLabourFromHours() {
  const tier = rateTiers.find(t => t.id === editRateTier.value && t.is_active !== false);
  const hours = parseFloat(editHours.value) || 0;
  if (tier && hours > 0) {
    editLabour.value = (hours * Number(tier.hourly_rate)).toFixed(2);
  }
  updateZigDisplay();
}
editRateTier?.addEventListener("change", recalcLabourFromHours);
editHours?.addEventListener("input", recalcLabourFromHours);

async function getRate() {
  if (cachedRate) return cachedRate;
  const { data, error } = await supabase.from("settings").select("usd_to_zwg_rate").single();
  cachedRate = error || !data ? 26.6908 : Number(data.usd_to_zwg_rate);
  return cachedRate;
}

// Job card totals bar (labour + parts + incidentals) and ZiG equivalent.
async function updateZigDisplay() {
  const labour = parseFloat(editLabour?.value) || 0;
  const parts = parseFloat(editParts?.value) || 0;
  const total = labour + parts + cardIncidentalsTotal;
  setText("jc-t-labour", money(labour));
  setText("jc-t-parts", money(parts));
  setText("jc-t-inc", money(cardIncidentalsTotal));
  setText("jc-t-total", money(total));
  if (!zigTotal) return;
  const rate = await getRate();
  zigTotal.textContent = `≈ ZiG ${(total * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
editLabour?.addEventListener("input", updateZigDisplay);

function setText(id, text) { const el = $(id); if (el) el.textContent = text; }

function formatPhoneForWhatsApp(raw) {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  return digits;
}

function updateWhatsappButton(job) {
  if (!editWhatsappBtn) return;
  const msg = messageForStatus(job);
  const phone = formatPhoneForWhatsApp(job?.customers?.phone);
  if (msg && phone) {
    editWhatsappBtn.classList.remove("hidden");
    editWhatsappBtn.onclick = () => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  } else {
    editWhatsappBtn.classList.add("hidden");
    editWhatsappBtn.onclick = null;
  }
}

// =====================================================================
// Intake: owner type, customers/companies and vehicles
// =====================================================================
async function loadCustomers(selectId = null, selectVehicleId = null) {
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone, email, customer_type, vehicles(id, license_plate, make, model, year, chassis_number, engine_number, body_type)")
    .order("full_name");
  if (error) { console.error("Error loading customers:", error); return; }
  customersList = data || [];
  renderCustomerOptions(selectId, selectVehicleId);
}

function renderCustomerOptions(selectId = null, selectVehicleId = null) {
  const isCompany = ownerType === "company";
  const list = customersList.filter(c => (c.customer_type === "company") === isCompany);
  customerSelect.innerHTML =
    `<option value="" disabled ${selectId ? "" : "selected"}>${isCompany ? "Select a company…" : "Select a customer…"}</option>` +
    `<option value="${NEW_VALUE}">＋ Add a new ${isCompany ? "company" : "customer"}</option>` +
    list.map(c => `<option value="${c.id}">${escapeHtml(c.full_name)}${c.phone ? ` — ${escapeHtml(c.phone)}` : ""}</option>`).join("");
  if (selectId && list.some(c => c.id === selectId)) {
    customerSelect.value = selectId;
    onCustomerChange(selectVehicleId);
  } else {
    onCustomerChange();
  }
}

function setOwnerType(type) {
  ownerType = type;
  document.querySelectorAll(".jc-seg button").forEach(b => {
    const on = b.dataset.owner === type;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  });
  setText("job-customer-label", type === "company" ? "Company *" : "Customer *");
  setText("new-customer-title", type === "company" ? "New company" : "New customer");
  setText("new-cust-name-label", type === "company" ? "Company name *" : "Full name *");
  $("driver-box")?.classList.toggle("hidden", type !== "company");
  renderCustomerOptions();
}
document.querySelectorAll(".jc-seg button").forEach(b => b.addEventListener("click", () => setOwnerType(b.dataset.owner)));

function selectedCustomer() {
  return customersList.find(c => c.id === customerSelect.value) || null;
}

function onCustomerChange(selectVehicleId = null) {
  const value = customerSelect.value;
  const isNew = value === NEW_VALUE;
  $("new-customer-box")?.classList.toggle("hidden", !isNew);
  if (!value) {
    jobPlateSelect.innerHTML = `<option value="">Select a ${ownerType === "company" ? "company" : "customer"} first…</option>`;
    jobPlateSelect.disabled = true;
    showNewPlate(false);
    clearVehicleFields();
    return;
  }
  const vehicles = isNew ? [] : (selectedCustomer()?.vehicles || []);
  jobPlateSelect.disabled = false;
  jobPlateSelect.innerHTML =
    vehicles.map(v => {
      const label = [v.make, v.model].filter(Boolean).join(" ");
      return `<option value="${v.id}">${escapeHtml(v.license_plate || "No plate")}${label ? ` — ${escapeHtml(label)}` : ""}</option>`;
    }).join("") +
    `<option value="${NEW_VALUE}">＋ Register a new vehicle</option>`;
  if (selectVehicleId && vehicles.some(v => v.id === selectVehicleId)) jobPlateSelect.value = selectVehicleId;
  else jobPlateSelect.value = vehicles.length ? vehicles[0].id : NEW_VALUE;
  onVehicleChange();
}
customerSelect.addEventListener("change", () => onCustomerChange());

function onVehicleChange() {
  const isNew = jobPlateSelect.value === NEW_VALUE;
  showNewPlate(isNew);
  if (isNew) { clearVehicleFields(); return; }
  const vehicle = (selectedCustomer()?.vehicles || []).find(v => v.id === jobPlateSelect.value);
  autofillVehicleFields(vehicle);
}
jobPlateSelect.addEventListener("change", onVehicleChange);

function showNewPlate(show) {
  $("new-plate-field")?.classList.toggle("hidden", !show);
  if (!show && $("job-new-plate")) $("job-new-plate").value = "";
}

function clearVehicleFields() {
  $("job-body-type").value = "Sedan";
  ["job-make", "job-model", "job-year", "job-chassis", "job-engine"].forEach(id => { $(id).value = ""; });
  autoPickNewTier();
}

function autofillVehicleFields(vehicle) {
  if (!vehicle) return;
  $("job-body-type").value = vehicle.body_type || "Other";
  $("job-make").value = vehicle.make || "";
  $("job-model").value = vehicle.model || "";
  $("job-year").value = vehicle.year || "";
  $("job-chassis").value = vehicle.chassis_number || "";
  $("job-engine").value = vehicle.engine_number || "";
  autoPickNewTier();
}

// ---- Intake labour ----
function autoPickNewTier() {
  if (!newRateTier || tierTouched || !rateTiers.length) return;
  const tier = detectTierForMake($("job-make")?.value);
  if (tier) newRateTier.value = tier.id;
  recalcNewLabour();
}
function recalcNewLabour() {
  if (labourTouched) { updateNewTotals(); return; }
  const tier = rateTiers.find(t => t.id === newRateTier?.value);
  const hours = parseFloat(newHours?.value) || 0;
  newLabour.value = tier && hours > 0 ? (hours * Number(tier.hourly_rate)).toFixed(2) : "";
  updateNewTotals();
}
$("job-make")?.addEventListener("input", autoPickNewTier);
newRateTier?.addEventListener("change", () => { tierTouched = true; recalcNewLabour(); });
newHours?.addEventListener("input", recalcNewLabour);
newLabour?.addEventListener("input", () => { labourTouched = newLabour.value !== ""; updateNewTotals(); });

// ---- Intake parts & incidentals (staged until the job is created) ----
function renderPartOptions(select) {
  if (!select) return;
  select.innerHTML = `<option value="">Choose a part…</option>` + partsCatalog.map(p =>
    `<option value="${p.id}" ${Number(p.quantity_in_stock) < 1 ? "disabled" : ""}>${escapeHtml(p.name)} — ${money(p.selling_price)} (${p.quantity_in_stock} in stock)</option>`
  ).join("");
}

async function loadPartsIntoSelect() {
  const { data, error } = await supabase.from("parts").select("id, name, selling_price, quantity_in_stock").order("name");
  if (error) { console.error("Error loading parts:", error); return; }
  partsCatalog = data || [];
  renderPartOptions(jobPartSelect);
  renderPartOptions(newPartSelect);
}

$("new-part-add")?.addEventListener("click", () => {
  const part = partsCatalog.find(p => p.id === newPartSelect.value);
  const qty = parseInt(newPartQty.value, 10);
  if (!part) { showFormMessage("Choose a part first."); return; }
  if (!Number.isInteger(qty) || qty < 1) { showFormMessage("Enter a valid quantity."); return; }
  const already = stagedParts.filter(s => s.part_id === part.id).reduce((n, s) => n + s.qty, 0);
  if (already + qty > Number(part.quantity_in_stock)) { showFormMessage(`Only ${part.quantity_in_stock} of ${part.name} in stock.`); return; }
  stagedParts.push({ part_id: part.id, name: part.name, price: Number(part.selling_price) || 0, qty });
  newPartQty.value = 1;
  newPartSelect.value = "";
  showFormMessage("");
  renderStaged();
});

<<<<<<< HEAD
$("new-inc-add")?.addEventListener("click", () => {
  const description = $("new-inc-desc").value.trim();
  const amount = parseFloat($("new-inc-amount").value);
  if (!description || !(amount > 0)) { showFormMessage("Enter an incidental description and a valid amount."); return; }
  stagedIncidentals.push({ description, amount });
  $("new-inc-desc").value = "";
  $("new-inc-amount").value = "";
  showFormMessage("");
  renderStaged();
});

function renderStaged() {
  const partsEl = $("new-parts-list");
  const incEl = $("new-inc-list");
  partsEl.innerHTML = stagedParts.length ? stagedParts.map((p, i) => `
    <div class="jc-line"><span>${escapeHtml(p.name)} <em>× ${p.qty}</em></span><b>${money(p.price * p.qty)}</b>
    <button type="button" class="btn jc-rm" data-kind="part" data-i="${i}" aria-label="Remove ${escapeHtml(p.name)}"><i data-lucide="x"></i></button></div>`).join("")
    : `<div class="jc-empty">No parts added</div>`;
  incEl.innerHTML = stagedIncidentals.length ? stagedIncidentals.map((x, i) => `
    <div class="jc-line"><span>${escapeHtml(x.description)}</span><b>${money(x.amount)}</b>
    <button type="button" class="btn jc-rm" data-kind="inc" data-i="${i}" aria-label="Remove ${escapeHtml(x.description)}"><i data-lucide="x"></i></button></div>`).join("")
    : `<div class="jc-empty">No incidentals added</div>`;
  [partsEl, incEl].forEach(el => el.querySelectorAll(".jc-rm").forEach(btn => btn.addEventListener("click", () => {
    const i = Number(btn.dataset.i);
    if (btn.dataset.kind === "part") stagedParts.splice(i, 1); else stagedIncidentals.splice(i, 1);
    renderStaged();
  })));
  if (window.lucide) lucide.createIcons();
  updateNewTotals();
}

async function updateNewTotals() {
  const labour = parseFloat(newLabour?.value) || 0;
  const parts = stagedParts.reduce((s, p) => s + p.price * p.qty, 0);
  const inc = stagedIncidentals.reduce((s, x) => s + x.amount, 0);
  const total = labour + parts + inc;
  setText("sum-labour", money(labour));
  setText("sum-parts", money(parts));
  setText("sum-inc", money(inc));
  setText("sum-total", money(total));
  const rate = await getRate();
  setText("sum-zig", total > 0 ? `≈ ZiG ${(total * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "");
}

function showFormMessage(text, tone = "error") {
  if (!formMessage) return;
  formMessage.textContent = text;
  formMessage.dataset.tone = tone;
}

// =====================================================================
// Mechanics
// =====================================================================
// A mechanic can work on several job cards at once; this just counts how
// many open ones each has so the dropdown can show it.
async function refreshBusyMechanics() {
  const { data: openJobs } = await supabase.from("repair_jobs").select("technician_id").not("technician_id", "is", null).not("status", "in", '("Ready for Pickup","Unclaimed","Collected")');
  const counts = {};
  (openJobs || []).forEach(j => { counts[j.technician_id] = (counts[j.technician_id] || 0) + 1; });
  mechanicsList = mechanicsList.map(m => ({ ...m, openJobs: counts[m.id] || 0 }));
=======
let mechanicsList = []; // [{ id, full_name, activeJobCount }]

async function refreshMechanicWorkloads() {
  const { data: activeJobs, error } = await supabase
    .from("repair_jobs")
    .select("technician_id")
    .not("technician_id", "is", null)
    .not("status", "in", '("Ready for Pickup","Completed","Unclaimed","Collected")');
  if (error) {
    console.error("Error loading mechanic workloads:", error);
    return;
  }
  const workloadCounts = (activeJobs || []).reduce((counts, job) => {
    counts[job.technician_id] = (counts[job.technician_id] || 0) + 1;
    return counts;
  }, {});
  mechanicsList = mechanicsList.map(mechanic => ({
    ...mechanic,
    activeJobCount: workloadCounts[mechanic.id] || 0,
  }));
>>>>>>> bfabf35 (Initial project upload)
}

async function loadTechniciansIntoSelect() {
  // Only mechanics, read through technician_directory (the safe, name-only view).
  const { data: mechanics, error } = await supabase.from("technician_directory").select("id, full_name").eq("department", "Mechanics").eq("is_active", true).order("full_name");
  if (error) { console.error("Error loading technicians:", error); return; }
<<<<<<< HEAD
  mechanicsList = (mechanics || []).map(m => ({ ...m, openJobs: 0 }));
  await refreshBusyMechanics();
  refreshTechnicianOptions(editTechnician, null);
  refreshTechnicianOptions(newTechnician, null);
  const mechanicFilter = $("jobs-filter-mechanic");
=======

  mechanicsList = (mechanics || []).map(m => ({ ...m, activeJobCount: 0 }));
  await refreshMechanicWorkloads();
  refreshTechnicianOptions(null);
  if (jobTechnicianSelect) {
    jobTechnicianSelect.innerHTML = `<option value="">Unassigned</option>` + mechanicsList.map(mechanic =>
      `<option value="${mechanic.id}">${escapeHtml(mechanic.full_name)}${mechanic.activeJobCount ? ` — ${mechanic.activeJobCount} active job${mechanic.activeJobCount === 1 ? "" : "s"}` : ""}</option>`
    ).join("");
  }

  const mechanicFilter = document.getElementById("jobs-filter-mechanic");
>>>>>>> bfabf35 (Initial project upload)
  if (mechanicFilter) {
    mechanicFilter.innerHTML = `<option value="">All Mechanics</option>` + mechanicsList.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)}</option>`).join("");
  }
}

<<<<<<< HEAD
// Every mechanic can be picked; the label shows how many open job cards
// they already have so work can be spread sensibly.
function refreshTechnicianOptions(select, currentJobTechnicianId) {
  if (!select) return;
  const keep = select === newTechnician ? select.value : null;
  select.innerHTML =
    `<option value="">Unassigned</option>` +
    mechanicsList.map(m => {
      const n = m.openJobs || 0;
      const label = n ? `${m.full_name} — ${n} open job${n === 1 ? "" : "s"}` : `${m.full_name} — free`;
      return `<option value="${m.id}">${escapeHtml(label)}</option>`;
=======
function refreshTechnicianOptions(currentJobTechnicianId) {
  editTechnician.innerHTML =
    `<option value="">Unassigned</option>` +
    mechanicsList.map(mechanic => {
      const label = `${mechanic.full_name}${mechanic.activeJobCount ? ` — ${mechanic.activeJobCount} active job${mechanic.activeJobCount === 1 ? "" : "s"}` : ""}`;
      return `<option value="${mechanic.id}">${escapeHtml(label)}</option>`;
>>>>>>> bfabf35 (Initial project upload)
    }).join("");
  if (currentJobTechnicianId) select.value = currentJobTechnicianId;
  else if (keep && mechanicsList.some(m => m.id === keep)) select.value = keep;
}

// =====================================================================
// Job card: parts & incidentals
// =====================================================================
async function loadJobParts(jobId) {
  if (!jobPartsList) return;
  const { data, error } = await supabase.from("job_parts").select("id, part_name, quantity, price_at_time").eq("job_id", jobId);
  if (error) { console.error("Error loading job parts:", error); return; }
  cardParts = data || [];

  jobPartsList.innerHTML = cardParts.length ? cardParts.map(jp => `
    <div class="jc-line" data-jp-id="${jp.id}">
      <span>${escapeHtml(jp.part_name)} <em>× ${jp.quantity}</em></span><b>${money(jp.price_at_time * jp.quantity)}</b>
      <button type="button" class="btn jc-rm remove-job-part-btn" data-jp-id="${jp.id}" aria-label="Remove part"><i data-lucide="x"></i></button>
    </div>`).join("") : `<div class="jc-empty">No parts added yet</div>`;

  jobPartsList.querySelectorAll(".remove-job-part-btn").forEach(btn => {
    btn.addEventListener("click", () => removeJobPart(btn.dataset.jpId, jobId));
  });
  if (window.lucide) lucide.createIcons();
  applyCollectedLock(currentEditJob?.status === TERMINAL_STATUS);
  recalcPartsCost();
}

function recalcPartsCost() {
  const total = cardParts.reduce((sum, jp) => sum + jp.quantity * jp.price_at_time, 0);
  editParts.value = total.toFixed(2);
  updateZigDisplay();
}

async function removeJobPart(jobPartId, jobId) {
  if (currentEditJob?.status === TERMINAL_STATUS) {
    alert("This vehicle has been collected. Parts can no longer be changed.");
    return;
  }
  const { data: jp } = await supabase.from("job_parts").select("part_id, quantity").eq("id", jobPartId).single();
  if (jp?.part_id) {
    const { data: part } = await supabase.from("parts").select("quantity_in_stock").eq("id", jp.part_id).single();
    if (part) {
      await supabase.from("parts").update({ quantity_in_stock: part.quantity_in_stock + jp.quantity }).eq("id", jp.part_id);
    }
  }
  await supabase.from("job_parts").delete().eq("id", jobPartId);
  await loadJobParts(jobId);
  await loadPartsIntoSelect();
}

jobPartAddBtn?.addEventListener("click", async () => {
  if (!currentEditJobId) return;
  if (currentEditJob?.status === TERMINAL_STATUS) {
    alert("This vehicle has been collected. Parts can no longer be changed.");
    return;
  }
  const part = partsCatalog.find(p => p.id === jobPartSelect.value);
  const qty = parseInt(jobPartQty.value, 10) || 1;
  if (!part) { alert("Select a part first."); return; }
  if (!Number.isInteger(qty) || qty < 1) { alert("Enter a valid quantity."); return; }

  const { data: stockConsumed, error: stockError } = await supabase.rpc("consume_part_stock", { p_part_id: part.id, p_quantity: qty });
  if (stockError) { alert("Unable to reserve this part: " + stockError.message); return; }
  if (!stockConsumed) { alert("That part is out of stock or does not have enough units available."); return; }

  const { error: insertError } = await supabase.from("job_parts").insert([{
    job_id: currentEditJobId, part_id: part.id, part_name: part.name, quantity: qty, price_at_time: Number(part.selling_price) || 0,
  }]);
  if (insertError) {
    await supabase.rpc("restore_part_stock", { p_part_id: part.id, p_quantity: qty });
    alert("Failed to add part: " + insertError.message);
    return;
  }
  jobPartQty.value = 1;
  await loadJobParts(currentEditJobId);
  await loadPartsIntoSelect();
});

async function loadJobIncidentals(jobId) {
  const list = $("incidentals-list");
  if (!list) return;
  const { data, error } = await supabase.from("job_incidentals").select("id, description, amount").eq("job_id", jobId).order("created_at");
  if (error) { console.error("Error loading incidentals:", error); return; }
  cardIncidentals = data || [];

  list.innerHTML = cardIncidentals.length ? cardIncidentals.map(inc => `
    <div class="jc-line" data-inc-id="${inc.id}">
      <span>${escapeHtml(inc.description)}</span><b>${money(inc.amount)}</b>
      <button type="button" class="btn jc-rm remove-incidental-btn" data-inc-id="${inc.id}" aria-label="Remove incidental"><i data-lucide="x"></i></button>
    </div>`).join("") : `<div class="jc-empty">None added yet</div>`;
  list.querySelectorAll(".remove-incidental-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (currentEditJob?.status === TERMINAL_STATUS) return;
      await supabase.from("job_incidentals").delete().eq("id", btn.dataset.incId);
      await loadJobIncidentals(jobId);
    });
  });
  if (window.lucide) lucide.createIcons();
  applyCollectedLock(currentEditJob?.status === TERMINAL_STATUS);

  cardIncidentalsTotal = cardIncidentals.reduce((sum, inc) => sum + Number(inc.amount), 0);
  updateZigDisplay();
  await supabase.from("repair_jobs").update({ incidentals_cost: cardIncidentalsTotal }).eq("id", jobId);
}

incidentalAddBtn?.addEventListener("click", async () => {
  if (!currentEditJobId) return;
  if (currentEditJob?.status === TERMINAL_STATUS) {
    alert("This vehicle has been collected. Incidentals can no longer be changed.");
    return;
  }
  const description = $("incidental-desc").value.trim();
  const amount = parseFloat($("incidental-amount").value);
  if (!description || !amount || amount <= 0) { alert("Enter a description and a valid amount."); return; }
  const { error } = await supabase.from("job_incidentals").insert([{ job_id: currentEditJobId, description, amount }]);
  if (error) { alert("Failed to add incidental: " + error.message); return; }
  $("incidental-desc").value = "";
  $("incidental-amount").value = "";
  await loadJobIncidentals(currentEditJobId);
});

function initStatusOptions() {
  editStatus.innerHTML = STATUS_LIST.map(s => `<option value="${s}">${s}</option>`).join("");
}

// =====================================================================
// Queue
// =====================================================================
function jobLabel(job) {
  if (job.cro_number) return job.cro_number;
  return job.job_number != null ? `#${String(job.job_number).padStart(4, "0")}` : "New job";
}
function vehicleName(v) {
  return [v?.year, v?.make, v?.model].filter(Boolean).join(" ");
}

async function fetchJobsBundle() {
  const [{ data, error }, { data: techs }] = await Promise.all([
    supabase.from("repair_jobs").select(`
      id, job_number, cro_number, portal_token, vehicle_id, fault_reported, diagnosis, diagnosis_eta, status, labour_cost, labour_hours, rate_tier_id, parts_cost, incidentals_cost, total_cost, technician_id, ready_at, collected_at, created_at, ai_suggested_causes, fuel_level_in, odometer_in, driver_name, driver_phone, picked_up_by,
      customers ( full_name, phone, email, customer_type ),
<<<<<<< HEAD
      vehicles ( make, model, year, license_plate, engine_number, chassis_number, body_type )
=======
      vehicles ( make, model, year, license_plate, engine_number, chassis_number )
>>>>>>> bfabf35 (Initial project upload)
    `).order("created_at", { ascending: false }),
    supabase.from("technician_directory").select("id, full_name"),
  ]);
  if (error) throw error;
  return { jobs: data || [], techs: techs || [] };
}

function renderJobsBundle(bundle) {
  const { jobs: data, techs } = bundle;
  techNamesById = Object.fromEntries(techs.map(t => [t.id, t.full_name]));
  jobsById = new Map(data.map(j => [j.id, j]));

<<<<<<< HEAD
  if (data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--text-muted)">No job cards yet</td></tr>`;
    if (window.lucide) lucide.createIcons();
    applyJobFilters();
    renderWorkload();
=======
  if (!data || data.length === 0) {
    mechanicsList = mechanicsList.map(mechanic => ({ ...mechanic, activeJobCount: 0 }));
    tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--text-muted)">No repair jobs yet</td></tr>`;
>>>>>>> bfabf35 (Initial project upload)
    return;
  }

  const activeJobCounts = data.reduce((counts, job) => {
    if (job.technician_id && !["Ready for Pickup", "Completed", "Unclaimed", "Collected"].includes(job.status)) {
      counts[job.technician_id] = (counts[job.technician_id] || 0) + 1;
    }
    return counts;
  }, {});
  mechanicsList = mechanicsList.map(mechanic => ({
    ...mechanic,
    activeJobCount: activeJobCounts[mechanic.id] || 0,
  }));

  tableBody.innerHTML = data.map(job => {
    const meta = STATUS_META[job.status] || { cls: "", icon: "circle" };
    const vehicleLabel = vehicleName(job.vehicles) + (job.vehicles?.license_plate ? ` (${job.vehicles.license_plate})` : "");
    const isCompany = job.customers?.customer_type === "company";
    const customerLabel = escapeHtml(job.customers?.full_name ?? "—")
      + (isCompany ? ` <span class="badge badge--in-repair" style="margin-left:4px">Company</span>` : "");
    return `
      <tr data-job-id="${job.id}">
        <td><b>${escapeHtml(jobLabel(job))}</b></td>
        <td>${customerLabel}</td>
        <td>${escapeHtml(vehicleLabel)}</td>
<<<<<<< HEAD
        <td class="jc-clip">${escapeHtml(job.fault_reported)}</td>
        <td><span class="badge ${meta.cls}"><i data-lucide="${meta.icon}"></i> ${escapeHtml(job.status)}</span></td>
        <td>${escapeHtml(techNamesById[job.technician_id] ?? "Unassigned")}</td>
        <td>${money(job.total_cost)}</td>
        <td><button class="btn edit-job-btn" data-job-id="${job.id}"><i data-lucide="file-text"></i> Open Job Card</button></td>
      </tr>`;
=======
        <td>${escapeHtml(job.fault_reported)}</td>
        <td><span class="badge ${meta.cls}"><i data-lucide="${meta.icon}"></i> ${job.status}</span></td>
        <td><strong>${escapeHtml(techNames[job.technician_id] ?? "Unassigned")}</strong>${job.technician_id ? `<small class="mechanic-workload">${activeJobCounts[job.technician_id] || 0} active job${activeJobCounts[job.technician_id] === 1 ? "" : "s"}</small>` : ""}</td>
        <td>$${Number(job.total_cost ?? 0).toFixed(2)}</td>
        <td><button class="btn edit-job-btn" data-job='${JSON.stringify(job).replace(/'/g, "&apos;")}'><i data-lucide="eye"></i> View Details</button></td>
      </tr>
    `;
>>>>>>> bfabf35 (Initial project upload)
  }).join("");

  if (window.lucide) lucide.createIcons();
  document.querySelectorAll(".edit-job-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const job = jobsById.get(btn.dataset.jobId);
      if (job) openEditModal(job);
    });
  });
  applyJobFilters();
  renderWorkload();
}

// Renders instantly from cache (prefetched at sign-in, or left over from an
// earlier visit this session) and refreshes from the network in the
// background, so opening Job Cards never sits on a blank table while the
// query runs.
async function loadJobs() {
  try {
    await hydrate("repairs:jobs", fetchJobsBundle, renderJobsBundle);
  } catch (error) {
    console.error("Error loading repair jobs:", error);
    tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--danger)">Failed to load jobs: ${escapeHtml(error.message)}</td></tr>`;
  }
}

// =====================================================================
// Mechanics' workload board — every job card each mechanic is on
// =====================================================================
const FINISHED = ["Ready for Pickup", "Unclaimed", "Collected"];
function renderWorkload() {
  const board = $("workload-board");
  if (!board) return;
  const showAll = $("workload-scope")?.value === "all";
  const jobs = [...jobsById.values()].filter(j => showAll ? j.status !== "Collected" : !FINISHED.includes(j.status));
  const byMech = new Map();
  jobs.forEach(j => {
    const key = j.technician_id || "";
    if (!byMech.has(key)) byMech.set(key, []);
    byMech.get(key).push(j);
  });
  const known = new Map(mechanicsList.map(m => [m.id, m.full_name]));
  Object.entries(techNamesById).forEach(([id, name]) => { if (!known.has(id) && byMech.has(id)) known.set(id, name); });
  const cards = [...known.entries()].map(([id, name]) => ({ id, name, jobs: byMech.get(id) || [] }))
    .sort((a, b) => b.jobs.length - a.jobs.length || a.name.localeCompare(b.name));
  if ((byMech.get("") || []).length) cards.push({ id: "", name: "Not assigned yet", jobs: byMech.get("") });

  const total = jobs.length;
  setText("workload-count", `${total} ${showAll ? "unfinished or waiting" : "open"} job card${total === 1 ? "" : "s"}`);
  if (!cards.length) { board.innerHTML = `<div class="jc-empty">No mechanics found. Add them under Mechanics.</div>`; return; }

  board.innerHTML = cards.map(c => `
    <div class="wl-card${c.id ? "" : " wl-none"}">
      <header>
        <span class="wl-av">${escapeHtml((c.name || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase())}</span>
        <div class="wl-name"><b>${escapeHtml(c.name)}</b><span>${c.jobs.length ? `${c.jobs.length} job card${c.jobs.length === 1 ? "" : "s"}` : "Free — no open job cards"}</span></div>
        <span class="wl-n ${c.jobs.length ? "" : "zero"}">${c.jobs.length}</span>
      </header>
      ${c.jobs.length ? `<div class="wl-jobs">${c.jobs.map(j => {
        const meta = STATUS_META[j.status] || { cls: "", icon: "circle" };
        return `<button type="button" class="wl-job" data-job-id="${j.id}">
          <span class="wl-cro">${escapeHtml(jobLabel(j))}</span>
          <span class="wl-veh">${escapeHtml(vehicleName(j.vehicles) || "Vehicle")}${j.vehicles?.license_plate ? ` · ${escapeHtml(j.vehicles.license_plate)}` : ""}<small>${escapeHtml(j.customers?.full_name || "")}</small></span>
          <span class="badge ${meta.cls}">${escapeHtml(j.status)}</span>
        </button>`;
      }).join("")}</div>` : ""}
    </div>`).join("");
  board.querySelectorAll(".wl-job").forEach(b => b.addEventListener("click", () => {
    const job = jobsById.get(b.dataset.jobId);
    if (job) openEditModal(job);
  }));
}
$("workload-scope")?.addEventListener("change", renderWorkload);

// =====================================================================
// Pickup countdown / parking fee
// =====================================================================
function renderPickupCountdown(job) {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  if (!pickupCountdownBlock || !pickupCountdownDisplay) return;

  const eligible = job.ready_at && !job.collected_at && ["Ready for Pickup", "Unclaimed"].includes(job.status);
  if (!eligible) {
    pickupCountdownBlock.classList.add("hidden");
    applyParkingFeeBtn?.classList.add("hidden");
    return;
  }
  pickupCountdownBlock.classList.remove("hidden");
  const graceEndMs = new Date(job.ready_at).getTime() + PARKING_GRACE_DAYS * 24 * 60 * 60 * 1000;

  const tick = () => {
    const remaining = graceEndMs - Date.now();
    if (remaining > 0) {
      const d = Math.floor(remaining / 86400000);
      const h = Math.floor((remaining % 86400000) / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      pickupCountdownDisplay.textContent = `Free pickup window: ${d}d ${h}h ${m}m ${s}s remaining before parking fees begin.`;
      applyParkingFeeBtn?.classList.add("hidden");
    } else {
      const overdueDays = Math.floor(-remaining / 86400000) + 1;
      const fee = overdueDays * PARKING_FEE_PER_DAY;
      pickupCountdownDisplay.innerHTML = `<strong style="color:var(--danger)">Overdue ${overdueDays} day${overdueDays === 1 ? "" : "s"} — parking fee: ${money(fee)}</strong>`;
      if (applyParkingFeeBtn) {
        applyParkingFeeBtn.classList.remove("hidden");
        applyParkingFeeBtn.onclick = () => {
          editLabour.value = ((parseFloat(editLabour.value) || 0) + fee).toFixed(2);
          updateZigDisplay();
        };
      }
    }
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

// =====================================================================
// Job card open / render
// =====================================================================
function infoCell(label, value) {
  return `<div><span>${label}</span><b>${value ? escapeHtml(String(value)) : `<i class="jc-none">—</i>`}</b></div>`;
}

function renderCardHeader(job) {
  const meta = STATUS_META[job.status] || { cls: "", icon: "circle" };
  const isCompany = job.customers?.customer_type === "company";
  editJobNumber.textContent = jobLabel(job);
  $("jc-tags").innerHTML =
    `<span class="badge ${meta.cls}"><i data-lucide="${meta.icon}"></i> ${escapeHtml(job.status)}</span>` +
    `<span class="badge ${isCompany ? "badge--in-repair" : "badge--received"}"><i data-lucide="${isCompany ? "building-2" : "user"}"></i> ${isCompany ? "Company car" : "Private"}</span>` +
    (job.created_at ? `<span class="jc-date">Opened ${new Date(job.created_at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>` : "");

  const v = job.vehicles || {};
  const c = job.customers || {};
  $("jc-info").innerHTML = `
    <div class="jc-infocard">
      <h5><i data-lucide="${isCompany ? "building-2" : "user"}"></i> ${isCompany ? "Company" : "Customer"}</h5>
      <div class="jc-kv">
        ${infoCell(isCompany ? "Company" : "Name", c.full_name)}
        ${infoCell("Phone", c.phone)}
        ${infoCell("Email", c.email)}
        ${isCompany ? infoCell("Brought in by", [job.driver_name, job.driver_phone].filter(Boolean).join(" · ")) : ""}
      </div>
    </div>
    <div class="jc-infocard">
      <h5><i data-lucide="car"></i> Vehicle</h5>
      <div class="jc-kv">
        ${infoCell("Vehicle", vehicleName(v))}
        ${infoCell("Number plate", v.license_plate)}
        ${infoCell("Body type", v.body_type)}
        ${infoCell("Chassis no.", v.chassis_number)}
        ${infoCell("Engine no.", v.engine_number)}
        ${infoCell("Fuel in", job.fuel_level_in)}
        ${infoCell("Odometer in", job.odometer_in != null ? `${Number(job.odometer_in).toLocaleString()} km` : "")}
      </div>
    </div>`;
  $("jc-fault").innerHTML = `<span><i data-lucide="message-square-warning"></i> Fault reported</span><p>${escapeHtml(job.fault_reported || "—")}</p>`;
}

async function openEditModal(job) {
  currentEditJobId = job.id;
  currentEditJob = job;
  pendingCollection = false;
<<<<<<< HEAD
  cardParts = [];
  cardIncidentals = [];
  cardIncidentalsTotal = Number(job.incidentals_cost) || 0;
  renderCardHeader(job);

=======
  const createdMessage = document.getElementById("job-card-created-message");
  if (createdMessage) {
    createdMessage.hidden = newlyCreatedJobId !== job.id;
    createdMessage.textContent = newlyCreatedJobId === job.id
      ? "Repair order added. Complete the job card below with inspection findings, status, parts, labour, and supplies."
      : "";
  }
  if (newlyCreatedJobId === job.id) newlyCreatedJobId = null;
  editJobNumber.textContent = job.cro_number || String(job.job_number).padStart(4, "0");
  const vehicle = job.vehicles || {};
  const vehicleName = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details not recorded";
  const statusMeta = STATUS_META[job.status] || { cls: "", icon: "circle" };
  document.getElementById("job-card-customer").textContent = job.customers?.full_name || "Customer details not recorded";
  document.getElementById("job-card-phone").textContent = job.customers?.phone || "Not recorded";
  document.getElementById("job-card-vehicle").textContent = vehicleName;
  document.getElementById("job-card-plate").textContent = vehicle.license_plate || "Not recorded";
  document.getElementById("job-card-mechanic").textContent = mechanicsList.find(mechanic => mechanic.id === job.technician_id)?.full_name || "Unassigned";
  document.getElementById("job-card-engine").textContent = vehicle.engine_number || "Not recorded";
  document.getElementById("job-card-chassis").textContent = vehicle.chassis_number || "Not recorded";
  document.getElementById("job-card-concern").textContent = job.fault_reported || "No concern recorded";
  const jobCardStatus = document.getElementById("job-card-status");
  jobCardStatus.className = `badge ${statusMeta.cls}`;
  jobCardStatus.innerHTML = `<i data-lucide="${statusMeta.icon}"></i> ${escapeHtml(job.status)}`;
  editStatus.querySelectorAll("option[data-legacy-status]").forEach(option => option.remove());
  if (!STATUS_LIST.includes(job.status)) {
    const legacyStatus = document.createElement("option");
    legacyStatus.value = job.status;
    legacyStatus.textContent = job.status;
    legacyStatus.dataset.legacyStatus = "true";
    editStatus.appendChild(legacyStatus);
  }
>>>>>>> bfabf35 (Initial project upload)
  editStatus.value = job.status;
  editDiagnosis.value = job.diagnosis ?? "";
  editDiagnosisEta.value = toDatetimeLocalValue(job.diagnosis_eta);
  editLabour.value = job.labour_cost ?? 0;
  editParts.value = job.parts_cost ?? 0;
  const aiResultEl = $("ai-suggest-causes-result");
  if (aiResultEl) {
    if (job.ai_suggested_causes) { aiResultEl.textContent = job.ai_suggested_causes; aiResultEl.style.display = "block"; }
    else { aiResultEl.style.display = "none"; aiResultEl.textContent = ""; }
  }
<<<<<<< HEAD
  await refreshBusyMechanics();
  refreshTechnicianOptions(editTechnician, job.technician_id || null);
  editTechnician.value = job.technician_id ?? "";
=======
  const currentTier = rateTiers.find(tier => tier.id === job.rate_tier_id);
  editRateTier?.querySelectorAll("option[data-archived-tier]").forEach(option => option.remove());
  if (currentTier && currentTier.is_active === false && editRateTier) {
    const archivedOption = document.createElement("option");
    archivedOption.value = currentTier.id;
    archivedOption.textContent = `${currentTier.tier_name} — $${Number(currentTier.hourly_rate).toFixed(2)}/hr (Archived; existing repair order)`;
    archivedOption.dataset.archivedTier = "true";
    editRateTier.appendChild(archivedOption);
  }
  editTechnician.value = job.technician_id ?? "";
  await refreshMechanicWorkloads();
  refreshTechnicianOptions(job.technician_id || null);
>>>>>>> bfabf35 (Initial project upload)
  editHours.value = job.labour_hours ?? "";
  const detectedTier = job.rate_tier_id
    ? rateTiers.find(t => t.id === job.rate_tier_id)
    : detectTierForMake(job.vehicles?.make);
  if (editRateTier) editRateTier.value = detectedTier?.id || "";

  const alreadyCollected = job.status === TERMINAL_STATUS;
  applyCollectedLock(alreadyCollected);
  updateWhatsappButton(job);
  if (editQuoteLink) editQuoteLink.href = `quotations.html?job=${encodeURIComponent(job.id)}`;
  if (editReceiptLink) {
    editReceiptLink.href = `receipts.html?job=${encodeURIComponent(job.id)}`;
    editReceiptLink.classList.toggle("hidden", !["Ready for Pickup", "Unclaimed"].includes(job.status));
  }
  if ($("edit-picked-up-by")) $("edit-picked-up-by").value = job.picked_up_by || "";
  updateZigDisplay();
  loadJobParts(job.id);
  loadJobIncidentals(job.id);

  editCollectionFields?.classList.toggle("hidden", !alreadyCollected);
  $("picked-up-by-field")?.classList.toggle("hidden", job.customers?.customer_type !== "company");
  if (editMarkCollectedBtn) {
    editMarkCollectedBtn.classList.toggle("hidden", !["Ready for Pickup", "Unclaimed"].includes(job.status));
    editMarkCollectedBtn.innerHTML = '<i data-lucide="check-check"></i> Mark as Collected';
  }
  renderPickupCountdown(job);

  modal.classList.remove("hidden");
  modal.querySelector(".jc-mbody")?.scrollTo(0, 0);
  if (window.lucide) lucide.createIcons();
}

function applyCollectedLock(isCollected) {
  [editStatus, editDiagnosis, editDiagnosisEta, editLabour, editTechnician, editOdometer, editCollectionNotes, jobPartSelect, jobPartQty, jobPartAddBtn, editHours, editRateTier].forEach(element => {
    if (element) element.disabled = isCollected;
  });
  [$("incidental-desc"), $("incidental-amount"), incidentalAddBtn].forEach(element => {
    if (element) element.disabled = isCollected;
  });
  document.querySelectorAll(".remove-job-part-btn, .remove-incidental-btn").forEach(button => { button.disabled = isCollected; });
  if (editSaveBtn) editSaveBtn.disabled = isCollected;
}

function closeEditModal() {
  modal.classList.add("hidden");
  currentEditJobId = null;
  currentEditJob = null;
  pendingCollection = false;
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  if (editWhatsappBtn) {
    editWhatsappBtn.classList.add("hidden");
    editWhatsappBtn.onclick = null;
  }
}

<<<<<<< HEAD
editCancelBtn?.addEventListener("click", closeEditModal);
$("jc-close")?.addEventListener("click", closeEditModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeEditModal(); });
editStatus?.addEventListener("change", () => {
  if (!currentEditJob) return;
  updateWhatsappButton({ ...currentEditJob, status: editStatus.value });
});
modal?.addEventListener("click", (e) => { if (e.target === modal) closeEditModal(); });
=======
if (editCancelBtn) editCancelBtn.addEventListener("click", closeEditModal);
if (editStatus) {
  editStatus.addEventListener("change", () => {
    if (!currentEditJob) return;
    updateWhatsappButton({ ...currentEditJob, status: editStatus.value });
    const statusMeta = STATUS_META[editStatus.value] || { cls: "", icon: "circle" };
    const jobCardStatus = document.getElementById("job-card-status");
    jobCardStatus.className = `badge ${statusMeta.cls}`;
    jobCardStatus.innerHTML = `<i data-lucide="${statusMeta.icon}"></i> ${escapeHtml(editStatus.value)}`;
    if (editReceiptLink) {
      editReceiptLink.classList.toggle("hidden", !["Ready for Pickup", "Unclaimed"].includes(editStatus.value));
    }
    if (window.lucide) lucide.createIcons();
  });
}
editTechnician?.addEventListener("change", () => {
  document.getElementById("job-card-mechanic").textContent =
    mechanicsList.find(mechanic => mechanic.id === editTechnician.value)?.full_name || "Unassigned";
});
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeEditModal();
  });
}
>>>>>>> bfabf35 (Initial project upload)

editSaveBtn?.addEventListener("click", async () => {
  if (!currentEditJobId) return;

  const status = editStatus.value;
  const labour_cost = parseFloat(editLabour.value) || 0;
  const parts_cost = parseFloat(editParts.value) || 0;

  const updates = {
    status,
    diagnosis: editDiagnosis.value.trim() || null,
    diagnosis_eta: editDiagnosisEta.value ? new Date(editDiagnosisEta.value).toISOString() : null,
    labour_cost,
    labour_hours: parseFloat(editHours.value) || null,
    rate_tier_id: editRateTier.value || null,
    parts_cost,
    technician_id: editTechnician.value || null,
  };

  // Only set ready_at/completed_at the FIRST time a job enters one of these
  // states, so unrelated edits don't reset the 7-day pickup countdown.
  const isNowReadyOrUnclaimed = ["Ready for Pickup", "Unclaimed"].includes(status);
  if (isNowReadyOrUnclaimed && !currentEditJob?.ready_at) updates.ready_at = new Date().toISOString();
  if (isNowReadyOrUnclaimed && !currentEditJob?.completed_at) updates.completed_at = new Date().toISOString();

  const { data: updatedRows, error } = await supabase.from("repair_jobs").update(updates).eq("id", currentEditJobId).select();
  if (error) {
    console.error("Error updating job:", error);
    alert("Failed to update job: " + error.message);
    return;
  }
  if (!updatedRows || updatedRows.length === 0) {
    alert("Update ran with no error, but 0 rows changed — likely an RLS policy blocking the update.");
    return;
  }

  if (isNowReadyOrUnclaimed) {
    await ensureReceiptExists(currentEditJobId, labour_cost + parts_cost);
    await sendStatusEmail(currentEditJob, status, labour_cost + parts_cost);
  }

  closeEditModal();
  loadJobs();
  refreshBusyMechanics().then(() => refreshTechnicianOptions(newTechnician, null));
});

// ---- Mark as Collected (two clicks: reveal fields, then confirm) ----
editMarkCollectedBtn?.addEventListener("click", async () => {
  if (!currentEditJobId) return;
  if (!pendingCollection) {
    pendingCollection = true;
    editCollectionFields?.classList.remove("hidden");
    editMarkCollectedBtn.innerHTML = '<i data-lucide="check-check"></i> Confirm Collection';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const { data: updatedRows, error } = await supabase
    .from("repair_jobs")
    .update({
      status: "Collected",
      collected_at: new Date().toISOString(),
      picked_up_by: $("edit-picked-up-by")?.value.trim() || null,
    })
    .eq("id", currentEditJobId)
    .select();

  if (error) { alert("Failed to mark as collected: " + error.message); return; }
  if (!updatedRows || updatedRows.length === 0) {
    alert("Update ran with no error, but 0 rows changed — likely an RLS policy blocking the update.");
    return;
  }

  if (currentEditJob?.vehicle_id) {
    const { error: vehicleUpdateError } = await supabase
      .from("vehicles")
      .update({ odometer_out: parseInt(editOdometer.value) || null, collection_notes: editCollectionNotes.value.trim() || null })
      .eq("id", currentEditJob.vehicle_id);
    if (vehicleUpdateError) console.error("Error updating vehicle on collection:", vehicleUpdateError);
  }

  pendingCollection = false;
  closeEditModal();
  loadJobs();
});

async function sendStatusEmail(job, status, totalCost) {
  if (!job?.customers?.email) {
    console.warn("No email on file for this customer — skipping auto email.");
    return;
  }
  const { error } = await supabase.functions.invoke("send-status-email", {
    body: {
      to: job.customers.email,
      customerName: job.customers.full_name,
      jobNumber: job.job_number,
      device: [job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" "),
      status,
      totalCost,
    },
  });
  if (error) console.error("Email send failed:", error);
}

async function ensureReceiptExists(jobId, amount) {
  const { data: existing, error: checkError } = await supabase.from("receipts").select("id").eq("repair_job_id", jobId).limit(1);
  if (checkError) { console.error("Error checking for existing receipt:", checkError); return; }
  if (existing && existing.length > 0) return;
  const { error: insertError } = await supabase.from("receipts").insert([{ repair_job_id: jobId, amount }]);
  if (insertError) console.error("Error auto-creating receipt:", insertError);
}

<<<<<<< HEAD
// =====================================================================
// Print job card
// =====================================================================
async function loadBusinessInfo() {
  if (businessInfo) return businessInfo;
  const { data } = await supabase.from("business_settings").select("business_name, tagline, address, phone, email").eq("id", 1).maybeSingle();
  businessInfo = data || { business_name: "Auto Parts & Repairs" };
  return businessInfo;
=======
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (jobFormMessage) {
      jobFormMessage.textContent = "";
      jobFormMessage.dataset.tone = "";
    }

    const customer_id = customerSelect.value;
    const vehicle_id = jobPlateSelect.value;
    const technician_id = jobTechnicianSelect?.value || null;
    const body_type = document.getElementById("job-body-type").value;
    const make = document.getElementById("job-make").value.trim();
    const model = document.getElementById("job-model").value.trim();
    const year = parseInt(document.getElementById("job-year").value) || null;
    const chassis_number = document.getElementById("job-chassis").value.trim();
    const engine_number = document.getElementById("job-engine").value.trim();
    const fuel_level_in = document.getElementById("job-fuel-in").value || null;
    const odometer_in = parseInt(document.getElementById("job-odometer-in").value) || null;
    const fault_reported = document.getElementById("job-fault").value.trim();
    const selectedCustomerName = customerSelect.options[customerSelect.selectedIndex]?.textContent || "Customer";
    const selectedPlate = jobPlateSelect.options[jobPlateSelect.selectedIndex]?.textContent || "vehicle";

    if (!customer_id || !vehicle_id) {
      alert("Select a customer and one of their registered vehicles. If this customer has no vehicles yet, add one via the Customers page first.");
      return;
    }
    if (!make || !fault_reported) {
      alert("Vehicle make and the customer's reported concern are required.");
      return;
    }
    if (!chassis_number || !engine_number) {
      alert("Chassis number and engine number are both required — a plate alone isn't a reliable enough identifier for this vehicle.");
      return;
    }

    // The vehicle already exists (it's one of the customer's registered
    // plates) — just keep its details in sync with whatever was edited here.
    const { error: vehicleUpdateError } = await supabase
      .from("vehicles")
      .update({ body_type, make, model: model || null, year, chassis_number, engine_number })
      .eq("id", vehicle_id);
    if (vehicleUpdateError) {
      console.error("Error updating vehicle:", vehicleUpdateError);
      alert("Failed to update vehicle details: " + vehicleUpdateError.message);
      return;
    }

    const { data: createdJob, error: jobError } = await supabase
      .from("repair_jobs")
      .insert([{ customer_id, vehicle_id, technician_id, fault_reported, status: "Received", fuel_level_in, odometer_in }])
      .select("id, job_number, cro_number")
      .single();

    if (jobError) {
      console.error("Error creating repair job:", jobError);
      alert("Failed to create repair job: " + jobError.message);
      return;
    }

    form.reset();
    resetVehicleSelect();
    if (jobFormMessage) {
      const assignedMechanic = mechanicsList.find(mechanic => mechanic.id === technician_id)?.full_name;
      const repairOrderNumber = createdJob?.cro_number || (createdJob?.job_number ? `#${String(createdJob.job_number).padStart(4, "0")}` : "");
      jobFormMessage.textContent = `Repair order${repairOrderNumber ? ` ${repairOrderNumber}` : ""} added for ${selectedCustomerName} — ${selectedPlate}.${assignedMechanic ? ` Assigned mechanic: ${assignedMechanic}.` : ""} The job card is open for status, findings, parts, and repair charges.`;
      jobFormMessage.dataset.tone = "success";
    }
    await loadJobs();
    newlyCreatedJobId = createdJob?.id || null;
    const newJobRow = [...tableBody.querySelectorAll("tr[data-job-id]")].find(row => row.dataset.jobId === createdJob?.id);
    newJobRow?.querySelector(".edit-job-btn")?.click();
  });
>>>>>>> bfabf35 (Initial project upload)
}

async function printJobCard() {
  const job = currentEditJob;
  if (!job) return;
  const win = window.open("", "_blank");
  if (!win) { alert("Allow pop-ups for this site to print the job card."); return; }
  const biz = await loadBusinessInfo();
  const v = job.vehicles || {};
  const c = job.customers || {};
  const isCompany = c.customer_type === "company";
  const tier = rateTiers.find(t => t.id === editRateTier.value);
  const labour = parseFloat(editLabour.value) || 0;
  const parts = parseFloat(editParts.value) || 0;
  const total = labour + parts + cardIncidentalsTotal;
  const rate = await getRate();
  const row = (k, val) => `<tr><th>${k}</th><td>${val ? escapeHtml(String(val)) : "—"}</td></tr>`;
  const logo = new URL("../assets/logo.png", window.location.href).href;
  const lines = [
    ...cardParts.map(p => `<tr><td>${escapeHtml(p.part_name)}</td><td class="r">${p.quantity}</td><td class="r">${money(p.price_at_time)}</td><td class="r">${money(p.price_at_time * p.quantity)}</td></tr>`),
    ...cardIncidentals.map(x => `<tr><td>${escapeHtml(x.description)} <small>(incidental)</small></td><td class="r">1</td><td class="r">${money(x.amount)}</td><td class="r">${money(x.amount)}</td></tr>`),
    `<tr><td>Labour${tier ? ` — ${escapeHtml(tier.tier_name)} @ ${money(tier.hourly_rate)}/hr` : ""}${editHours.value ? ` × ${escapeHtml(editHours.value)} h` : ""}</td><td class="r"></td><td class="r"></td><td class="r">${money(labour)}</td></tr>`,
  ].join("");

  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Job Card ${escapeHtml(jobLabel(job))}</title>
<style>
*{box-sizing:border-box}body{font:13px/1.45 Inter,system-ui,Arial,sans-serif;color:#0f172a;margin:0;padding:28px}
.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid #1f5fd6;padding-bottom:14px;margin-bottom:16px}
.hd img{height:56px}.biz b{display:block;font-size:17px}.biz span{color:#64748b;font-size:12px;display:block}
.no{text-align:right}.no b{display:block;font-size:22px;letter-spacing:-.02em}.no span{display:inline-block;margin-top:4px;padding:3px 10px;border-radius:99px;background:#e9f0fd;color:#1f5fd6;font-weight:600;font-size:12px}
h2{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#64748b;margin:18px 0 6px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
table{width:100%;border-collapse:collapse}.kv th{width:38%;text-align:left;color:#64748b;font-weight:500;padding:4px 8px 4px 0;vertical-align:top}.kv td{padding:4px 0;font-weight:600}
.box{border:1px solid #e3e8f0;border-radius:10px;padding:10px 12px;white-space:pre-wrap;min-height:44px}
.items th{background:#f6f8fc;text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:7px 8px;border-bottom:1px solid #e3e8f0}
.items td{padding:7px 8px;border-bottom:1px solid #eef2f7}.r{text-align:right}small{color:#64748b}
.tot{display:flex;justify-content:flex-end;margin-top:10px}.tot div{min-width:260px}.tot p{display:flex;justify-content:space-between;margin:3px 0}.tot p.big{font-size:16px;font-weight:700;border-top:2px solid #0f172a;padding-top:6px;margin-top:6px}
.sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:40px}.sig div{border-top:1px solid #94a3b8;padding-top:6px;color:#64748b;font-size:12px}
.ft{margin-top:24px;color:#94a3b8;font-size:11px;text-align:center}
@page{margin:12mm}@media print{body{padding:0}}
</style></head><body>
<div class="hd"><div style="display:flex;gap:14px;align-items:center"><img src="${logo}" alt=""><div class="biz"><b>${escapeHtml(biz.business_name || "Auto Parts & Repairs")}</b>${biz.address ? `<span>${escapeHtml(biz.address)}</span>` : ""}<span>${[biz.phone, biz.email].filter(Boolean).map(escapeHtml).join(" · ")}</span></div></div>
<div class="no"><small>JOB CARD</small><b>${escapeHtml(jobLabel(job))}</b><span>${escapeHtml(editStatus.value || job.status)}</span></div></div>
<div class="two"><div><h2>${isCompany ? "Company" : "Customer"}</h2><table class="kv">${row(isCompany ? "Company" : "Name", c.full_name)}${row("Phone", c.phone)}${row("Email", c.email)}${isCompany ? row("Brought in by", [job.driver_name, job.driver_phone].filter(Boolean).join(" · ")) : ""}${row("Date in", job.created_at ? new Date(job.created_at).toLocaleString() : "")}</table></div>
<div><h2>Vehicle</h2><table class="kv">${row("Vehicle", vehicleName(v))}${row("Number plate", v.license_plate)}${row("Body type", v.body_type)}${row("Chassis no.", v.chassis_number)}${row("Engine no.", v.engine_number)}${row("Fuel in", job.fuel_level_in)}${row("Odometer in", job.odometer_in != null ? Number(job.odometer_in).toLocaleString() + " km" : "")}</table></div></div>
<h2>Fault reported</h2><div class="box">${escapeHtml(job.fault_reported || "")}</div>
<h2>Diagnosis</h2><div class="box">${escapeHtml(editDiagnosis.value || "")}</div>
<div class="two"><div><h2>Mechanic</h2><div class="box">${escapeHtml(techNamesById[editTechnician.value] || "Unassigned")}</div></div><div><h2>Expected diagnosis</h2><div class="box">${editDiagnosisEta.value ? escapeHtml(new Date(editDiagnosisEta.value).toLocaleString()) : "—"}</div></div></div>
<h2>Work &amp; parts</h2><table class="items"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr></thead><tbody>${lines}</tbody></table>
<div class="tot"><div><p><span>Labour</span><b>${money(labour)}</b></p><p><span>Parts</span><b>${money(parts)}</b></p><p><span>Incidentals</span><b>${money(cardIncidentalsTotal)}</b></p><p class="big"><span>Total</span><span>${money(total)}</span></p><p><small>≈ ZiG ${(total * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}</small></p></div></div>
<div class="sig"><div>Customer / driver signature</div><div>Mechanic signature</div><div>Supervisor signature</div></div>
<p class="ft">Printed ${escapeHtml(new Date().toLocaleString())}</p>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
</body></html>`);
  win.document.close();
}
$("jc-print")?.addEventListener("click", printJobCard);

// =====================================================================
// Create job card
// =====================================================================
function digits(s) { return String(s || "").replace(/\D/g, ""); }

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showFormMessage("");
  const submitBtn = $("job-submit");

  const customerValue = customerSelect.value;
  const vehicleValue = jobPlateSelect.value;
  const isNewCustomer = customerValue === NEW_VALUE;
  const isNewVehicle = vehicleValue === NEW_VALUE;
  const body_type = $("job-body-type").value;
  const make = $("job-make").value.trim();
  const model = $("job-model").value.trim();
  const year = parseInt($("job-year").value, 10) || null;
  const chassis_number = $("job-chassis").value.trim();
  const engine_number = $("job-engine").value.trim();
  const license_plate = $("job-new-plate").value.trim().toUpperCase();
  const fuel_level_in = $("job-fuel-in").value || null;
  const odometer_in = parseInt($("job-odometer-in").value, 10);
  const fault_reported = $("job-fault").value.trim();
  const newName = $("new-cust-name").value.trim();
  const newPhone = $("new-cust-phone").value.trim();
  const newEmail = $("new-cust-email").value.trim();
  const who = ownerType === "company" ? "company" : "customer";
  // Read every remaining field now — saving a new customer/vehicle reloads the
  // selectors below, so nothing may be read from the form after that point.
  const owner = ownerType;
  const labourHours = parseFloat(newHours.value);
  const etaValue = $("job-diagnosis-eta").value;
  const statusValue = $("job-status").value === "Diagnosing" ? "Diagnosing" : "Received";
  const diagnosisValue = $("job-diagnosis").value.trim() || null;
  const tierValue = newRateTier.value || null;
  const labourValue = parseFloat(newLabour.value) || 0;
  const technicianValue = newTechnician.value || null;
  const driverName = owner === "company" ? ($("job-driver-name").value.trim() || null) : null;
  const driverPhone = owner === "company" ? ($("job-driver-phone").value.trim() || null) : null;
  const partsToAdd = stagedParts.map(x => ({ ...x }));
  const incidentalsToAdd = stagedIncidentals.map(x => ({ ...x }));

  // ---- Validate everything before writing anything ----
  if (!customerValue) return showFormMessage(`Select a ${who}, or choose “Add a new ${who}”.`);
  if (isNewCustomer && (newName.length < 2 || digits(newPhone).length < 7)) return showFormMessage(`Enter the new ${who}'s name and a valid phone number.`);
  if (isNewCustomer && newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return showFormMessage("Enter a valid email address, or leave it empty.");
  if (!vehicleValue) return showFormMessage("Choose a vehicle, or register a new one.");
  if (isNewVehicle && license_plate.length < 2) return showFormMessage("Enter the number plate for the new vehicle.");
  if (!make) return showFormMessage("Enter the vehicle make.");
  if (!chassis_number || !engine_number) return showFormMessage("Chassis number and engine number are both required — a plate alone isn't a reliable identifier.");
  if ($("job-odometer-in").value && !(odometer_in >= 0)) return showFormMessage("Enter a valid odometer reading.");
  if (!fault_reported) return showFormMessage("Describe the fault reported.");

  submitBtn.disabled = true;
  const originalBtn = submitBtn.innerHTML;
  submitBtn.innerHTML = `<i data-lucide="loader-circle"></i> Creating…`;
  if (window.lucide) lucide.createIcons();

  try {
    // ---- 1. Customer / company ----
    let customer_id = customerValue;
    if (isNewCustomer) {
      const existing = customersList.find(c => c.customer_type === owner && digits(c.phone) && digits(c.phone) === digits(newPhone));
      if (existing) {
        customer_id = existing.id;
      } else {
        const { data: created, error } = await supabase.from("customers")
          .insert([{ full_name: newName, phone: newPhone, email: newEmail || null, customer_type: owner }])
          .select("id").single();
        if (error) throw new Error(`Couldn't save the new ${who}: ${error.message}`);
        customer_id = created.id;
      }
    }

    // ---- 2. Vehicle ----
    let vehicle_id = vehicleValue;
    if (isNewVehicle) {
      const owned = (customersList.find(c => c.id === customer_id)?.vehicles || [])
        .find(v => (v.license_plate || "").replace(/\s/g, "").toUpperCase() === license_plate.replace(/\s/g, ""));
      if (owned) {
        vehicle_id = owned.id;
        const { error } = await supabase.from("vehicles").update({ body_type, make, model: model || null, year, chassis_number, engine_number }).eq("id", vehicle_id);
        if (error) throw new Error("Couldn't update the vehicle: " + error.message);
      } else {
        const { data: v, error } = await supabase.from("vehicles")
          .insert([{ customer_id, license_plate, body_type, make, model: model || null, year, chassis_number, engine_number }])
          .select("id").single();
        if (error) throw new Error("Couldn't register the vehicle: " + error.message);
        vehicle_id = v.id;
      }
    } else {
      const { error } = await supabase.from("vehicles").update({ body_type, make, model: model || null, year, chassis_number, engine_number }).eq("id", vehicle_id);
      if (error) throw new Error("Couldn't update the vehicle details: " + error.message);
    }

    // Keep the new customer/vehicle selected so a retry never duplicates them,
    // then put back what staff typed (the reload re-fills vehicle fields).
    if (isNewCustomer || isNewVehicle) {
      await loadCustomers(customer_id, vehicle_id);
      $("job-body-type").value = body_type; $("job-make").value = make; $("job-model").value = model;
      $("job-year").value = year || ""; $("job-chassis").value = chassis_number; $("job-engine").value = engine_number;
      if (tierValue) { newRateTier.value = tierValue; tierTouched = true; }
      newLabour.value = labourValue ? labourValue.toFixed(2) : ""; labourTouched = !!labourValue;
      if (technicianValue) newTechnician.value = technicianValue;
    }

    // ---- 3. The job itself ----
    const jobRow = {
      customer_id,
      vehicle_id,
      fault_reported,
      status: statusValue,
      fuel_level_in,
      odometer_in: Number.isFinite(odometer_in) ? odometer_in : null,
      diagnosis: diagnosisValue,
      diagnosis_eta: etaValue ? new Date(etaValue).toISOString() : null,
      rate_tier_id: tierValue,
      labour_hours: labourHours > 0 ? labourHours : null,
      labour_cost: labourValue,
      technician_id: technicianValue,
      driver_name: driverName,
      driver_phone: driverPhone,
    };
    const { data: job, error: jobError } = await supabase.from("repair_jobs").insert([jobRow]).select("id, cro_number, job_number").single();
    if (jobError) throw new Error("Couldn't create the job: " + jobError.message);

    // ---- 4. Parts (stock is taken here) and incidentals ----
    const skipped = [];
    let partsCost = 0;
    for (const p of partsToAdd) {
      const { data: ok, error } = await supabase.rpc("consume_part_stock", { p_part_id: p.part_id, p_quantity: p.qty });
      if (error || !ok) { skipped.push(p.name); continue; }
      const { error: insErr } = await supabase.from("job_parts").insert([{ job_id: job.id, part_id: p.part_id, part_name: p.name, quantity: p.qty, price_at_time: p.price }]);
      if (insErr) {
        await supabase.rpc("restore_part_stock", { p_part_id: p.part_id, p_quantity: p.qty });
        skipped.push(p.name);
        continue;
      }
      partsCost += p.price * p.qty;
    }
    let incCost = 0;
    if (incidentalsToAdd.length) {
      const { error } = await supabase.from("job_incidentals").insert(incidentalsToAdd.map(x => ({ job_id: job.id, description: x.description, amount: x.amount })));
      if (error) skipped.push("incidentals");
      else incCost = incidentalsToAdd.reduce((s, x) => s + x.amount, 0);
    }
    if (partsCost || incCost) {
      await supabase.from("repair_jobs").update({ parts_cost: partsCost, incidentals_cost: incCost }).eq("id", job.id);
    }

    resetIntakeForm();
    const label = job.cro_number || (job.job_number != null ? `#${String(job.job_number).padStart(4, "0")}` : "");
    showFormMessage(skipped.length
      ? `Job card ${label} created, but these weren't added (not enough stock or an error): ${skipped.join(", ")}. Add them from the job card.`
      : `Job card ${label} created.`.replace("  ", " "), skipped.length ? "error" : "success");
    await Promise.all([loadJobs(), loadPartsIntoSelect(), loadCustomers()]);
    await refreshBusyMechanics();
    refreshTechnicianOptions(newTechnician, null);
  } catch (err) {
    console.error(err);
    showFormMessage(err.message || String(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtn;
    if (window.lucide) lucide.createIcons();
  }
});

function resetIntakeForm() {
  form.reset();
  stagedParts = [];
  stagedIncidentals = [];
  tierTouched = false;
  labourTouched = false;
  $("new-customer-box")?.classList.add("hidden");
  renderCustomerOptions();
  renderStaged();
}

// =====================================================================
// Helpers
// =====================================================================
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ISO timestamp → value for <input type="datetime-local"> (local time).
function toDatetimeLocalValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- Diagnosis / progress update (WhatsApp / Email) ----
// Always works: a clear message is built from the job card itself. If the
// AI helper (ai-assist edge function) is reachable it polishes the wording;
// if it's slow or unavailable the built message is used as-is.
function buildUpdateMessage(job, diagnosisText, etaIso) {
  const c = job.customers || {};
  const v = job.vehicles || {};
  const biz = businessInfo?.business_name || "Auto Parts & Repairs";
  const vehicle = [vehicleName(v), v.license_plate ? `(${v.license_plate})` : ""].filter(Boolean).join(" ") || "your vehicle";
  const labour = parseFloat(editLabour?.value) || 0;
  const parts = parseFloat(editParts?.value) || 0;
  const total = labour + parts + cardIncidentalsTotal;
  const status = editStatus?.value || job.status;
  const lines = [
    `Hello ${c.full_name || "there"},`,
    ``,
    `This is ${biz} with an update on ${vehicle}, job card ${jobLabel(job)}.`,
    ``,
    `Status: ${status}`,
    diagnosisText ? `Diagnosis: ${diagnosisText}` : `Our mechanic is still diagnosing the fault you reported: ${job.fault_reported || "—"}.`,
    etaIso ? `Expected diagnosis by: ${new Date(etaIso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : null,
    total > 0 ? `Estimated cost so far: ${money(total)}` : null,
    ``,
    `Reply to this message${businessInfo?.phone ? ` or call us on ${businessInfo.phone}` : ""} if you have any questions.`,
  ];
  return lines.filter(l => l !== null).join("\n");
}

async function polishWithAi(baseMessage) {
  try {
    const call = supabase.functions.invoke("ai-assist", {
      body: {
        provider: "groq",
        systemPrompt: "You tidy up short customer update messages for a car repair workshop in Zimbabwe. Keep every fact, number, date, name, job number and vehicle exactly as given. Keep it friendly, professional and brief, plain text with no markdown and no emojis. Output only the message.",
        prompt: baseMessage,
      },
    });
    const timeout = new Promise(resolve => setTimeout(() => resolve({ data: null, error: new Error("timeout") }), 8000));
    const { data, error } = await Promise.race([call, timeout]);
    if (error || !data?.text?.trim()) return baseMessage;
    return data.text.trim();
  } catch (e) {
    return baseMessage;
  }
}

async function sendDiagnosisUpdate(channel) {
  if (!currentEditJob) return;
  const job = currentEditJob;
  const diagnosisText = editDiagnosis.value.trim();
<<<<<<< HEAD
  const etaIso = editDiagnosisEta.value ? new Date(editDiagnosisEta.value).toISOString() : null;

  let phone = null, email = null;
  if (channel === "whatsapp") {
    phone = formatPhoneForWhatsApp(job.customers?.phone)
      || formatPhoneForWhatsApp(prompt("WhatsApp number for this customer (e.g. 0771234567):") || "");
    if (!phone) return;
  } else {
    email = (job.customers?.email || "").trim() || (prompt("Customer email address:") || "").trim();
    if (!email) return;
=======
  if (!diagnosisText) {
    alert("Enter the mechanic's inspection findings first — the customer update is generated from these notes.");
    return;
>>>>>>> bfabf35 (Initial project upload)
  }

  // Open the WhatsApp tab straight away, inside the click, so the browser
  // doesn't treat it as a pop-up; it is pointed at the message once ready.
  const tab = channel === "whatsapp" ? window.open("", "_blank") : null;
  if (tab) tab.document.write("<p style='font:16px system-ui;padding:24px'>Preparing the WhatsApp message…</p>");

  const btn = channel === "whatsapp" ? editDiagnosisWhatsappBtn : editDiagnosisEmailBtn;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-circle"></i> Preparing…`;
  if (window.lucide) lucide.createIcons();

  try {
    await loadBusinessInfo();
    const message = await polishWithAi(buildUpdateMessage(job, diagnosisText, etaIso));
    if (channel === "whatsapp") {
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
      if (tab && !tab.closed) tab.location.href = url;
      else window.location.href = url;
    } else {
      const subject = encodeURIComponent(`Update on your vehicle — ${jobLabel(job)}`);
      window.location.href = `mailto:${email}?subject=${subject}&body=${encodeURIComponent(message)}`;
    }
  } catch (err) {
    console.error("Failed to prepare update:", err);
    if (tab && !tab.closed) tab.close();
    alert("Couldn't prepare the update message: " + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

// ---- AI diagnostic assistance (a suggestion only; never fills Diagnosis) ----
async function suggestPossibleCauses() {
  if (!currentEditJob) return;
<<<<<<< HEAD
  const btn = $("ai-suggest-causes-btn");
  const resultEl = $("ai-suggest-causes-result");
  const vehicleLabel = vehicleName(currentEditJob.vehicles) || "the vehicle";
=======
  const btn = document.getElementById("ai-suggest-causes-btn");
  const resultEl = document.getElementById("ai-suggest-causes-result");
  const vehicleLabel = [currentEditJob.vehicles?.year, currentEditJob.vehicles?.make, currentEditJob.vehicles?.model].filter(Boolean).join(" ") || "the vehicle";
  const mechanicFindings = editDiagnosis.value.trim();
  if (!mechanicFindings) {
    alert("Enter the mechanic's inspection findings before requesting possible causes.");
    return;
  }

>>>>>>> bfabf35 (Initial project upload)
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-circle"></i> Thinking…`;
  if (window.lucide) lucide.createIcons();

  try {
    const { data, error } = await supabase.functions.invoke("ai-assist", {
      body: {
        provider: "groq",
        systemPrompt: "You are an experienced automotive diagnostic assistant supporting a qualified mechanic. Base possible causes only on the mechanic's inspection findings supplied below, not on the customer's reported concern. List 3-5 plausible causes, most likely first, each with a concise practical verification check. Clearly state when findings are insufficient. This is diagnostic support only; the mechanic makes and records the final diagnosis.",
        prompt: `Vehicle: ${vehicleLabel}\nMechanic's inspection findings: ${mechanicFindings}`,
      },
    });
    if (error) throw error;
    if (!data?.text) throw new Error(data?.error || "No suggestion returned.");
    resultEl.textContent = data.text;
    resultEl.style.display = "block";
    const { error: saveError } = await supabase.from("repair_jobs").update({ ai_suggested_causes: data.text }).eq("id", currentEditJobId);
    if (saveError) throw saveError;
  } catch (err) {
    console.error("Diagnostic suggestion failed:", err);
    resultEl.textContent = "Couldn't get a suggestion: " + err.message;
    resultEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    if (window.lucide) lucide.createIcons();
  }
}
$("ai-suggest-causes-btn")?.addEventListener("click", suggestPossibleCauses);
editDiagnosisWhatsappBtn?.addEventListener("click", () => sendDiagnosisUpdate("whatsapp"));
editDiagnosisEmailBtn?.addEventListener("click", () => sendDiagnosisUpdate("email"));

<<<<<<< HEAD
// ---- Voice-powered fault intake (browser speech → AI tidy-up) ----
=======
if (editDiagnosisWhatsappBtn) editDiagnosisWhatsappBtn.addEventListener("click", () => sendDiagnosisUpdate("whatsapp"));
if (editDiagnosisEmailBtn) editDiagnosisEmailBtn.addEventListener("click", () => sendDiagnosisUpdate("email"));

// ---- Voice-powered fault intake ----
// Transcription itself uses the browser's own free, built-in Web Speech
// API — no AI call needed for that part, and it works offline-ish (just
// needs the browser's speech service). Gemini's only job here is
// cleaning up the raw, messy transcript (filler words, false starts)
// into something concise — it never does the actual listening.
>>>>>>> bfabf35 (Initial project upload)
(function setupVoiceFaultIntake() {
  const btn = $("voice-fault-btn");
  if (!btn) return;
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionImpl) return;

  btn.style.display = "inline-flex";
  let recognition = null;
  let isRecording = false;
  let rawTranscript = "";

  function setBtnState(state) {
    if (state === "recording") {
      btn.innerHTML = `<i data-lucide="square"></i> Stop (Listening…)`;
      btn.classList.add("btn--primary");
    } else if (state === "cleaning") {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-circle"></i> Cleaning up…`;
    } else {
      btn.disabled = false;
      btn.classList.remove("btn--primary");
      btn.innerHTML = `<i data-lucide="mic"></i> Dictate Customer Concern`;
    }
    if (window.lucide) lucide.createIcons();
  }

  async function cleanUpTranscript(text) {
    setBtnState("cleaning");
    try {
      const { data, error } = await supabase.functions.invoke("ai-assist", {
        body: {
          provider: "gemini",
          systemPrompt: "You clean up voice-dictated auto repair complaints for a job intake form. Remove filler words (um, uh, like), false starts, and repetition. Keep it as a single concise sentence or two, in the customer's own words as much as possible — don't add technical diagnosis, just clean up how it's phrased. Output only the cleaned text, nothing else.",
          prompt: text,
        },
      });
      if (error) throw error;
      $("job-fault").value = data?.text?.trim() || text;
    } catch (err) {
      console.error("Transcript cleanup failed, using raw transcript instead:", err);
      $("job-fault").value = text;
    } finally {
      setBtnState("idle");
    }
  }

  btn.addEventListener("click", () => {
    if (isRecording) { recognition?.stop(); return; }
    recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    rawTranscript = "";
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) rawTranscript += event.results[i][0].transcript + " ";
      }
    };
    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      isRecording = false;
      setBtnState("idle");
    };
    recognition.onend = () => {
      isRecording = false;
      if (rawTranscript.trim()) cleanUpTranscript(rawTranscript.trim());
      else setBtnState("idle");
    };
    recognition.start();
    isRecording = true;
    setBtnState("recording");
  });
})();

<<<<<<< HEAD
// =====================================================================
// Filters + start-up
// =====================================================================
=======
document.addEventListener("DOMContentLoaded", async () => {
  initStatusOptions();
  await loadCustomersIntoSelect();
  await loadTechniciansIntoSelect();
  loadPartsIntoSelect();
  await loadRateTiers();
  await loadJobs();

  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  const statusFilter = params.get("status");

  if (editId) {
    const btn = [...document.querySelectorAll(".edit-job-btn")]
      .find(b => JSON.parse(b.dataset.job).id === editId);
    if (btn) btn.click();
  } else if (statusFilter) {
    filterTableByStatus(statusFilter);
  }
});

>>>>>>> bfabf35 (Initial project upload)
function applyJobFilters() {
  const searchTerm = ($("jobs-search")?.value || "").trim().toLowerCase();
  const mechanicId = $("jobs-filter-mechanic")?.value || "";
  const typeFilter = $("jobs-filter-type")?.value || "";

  document.querySelectorAll("#repairs-table tr[data-job-id]").forEach(row => {
    const job = jobsById.get(row.dataset.jobId);
    if (!job) return;
    let matches = true;
    if (searchTerm) {
      const haystack = [
        job.cro_number, job.customers?.full_name, job.driver_name, job.vehicles?.license_plate,
        job.vehicles?.engine_number, job.vehicles?.make, job.vehicles?.model,
      ].filter(Boolean).join(" ").toLowerCase();
      matches = haystack.includes(searchTerm);
    }
    if (mechanicId) matches = matches && job.technician_id === mechanicId;
    if (typeFilter) {
      const isCompany = job.customers?.customer_type === "company";
      matches = matches && (typeFilter === "company" ? isCompany : !isCompany);
    }
    row.style.display = matches ? "" : "none";
  });
}

["jobs-search", "jobs-filter-mechanic", "jobs-filter-type"].forEach(id => {
  $(id)?.addEventListener("input", applyJobFilters);
  $(id)?.addEventListener("change", applyJobFilters);
});

function filterTableByStatus(status) {
  document.querySelectorAll("#repairs-table tr[data-job-id]").forEach(row => {
    const job = jobsById.get(row.dataset.jobId);
    if (!job) return;
    let match;
    if (status === "active") match = !["Ready for Pickup", "Collected", "Unclaimed"].includes(job.status);
    else if (status === "completed-month") match = job.status === "Ready for Pickup";
    else match = job.status === status;
    row.style.display = match ? "" : "none";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  initStatusOptions();
  renderStaged();
  await Promise.all([loadRateTiers(), loadCustomers(), loadTechniciansIntoSelect(), loadPartsIntoSelect()]);
  await loadJobs();

  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  const statusFilter = params.get("status");
  const highlightId = params.get("highlight");
  if (editId && jobsById.has(editId)) openEditModal(jobsById.get(editId));
  else if (statusFilter) filterTableByStatus(statusFilter);
  else if (highlightId) {
    const row = document.querySelector(`#repairs-table tr[data-job-id="${highlightId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("highlight-flash");
    }
  }
});
