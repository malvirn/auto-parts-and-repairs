// ========= Job Cards module =========
import supabase from "./supabaseClient.js";
import { STATUS_META, messageForStatus } from "./portalShared.js";
import { hydrate } from "./data-cache.js";
import { confirmTypedDelete } from "./bulk-delete.js";

const $ = (id) => document.getElementById(id);

const tableBody = $("repairs-table");
const form = $("job-form");
const customerSelect = $("job-customer");
const jobPlateSelect = $("job-plate");
const newPlateField = $("job-new-plate-field");

// ---- Job card (view / update) elements ----
const modal = $("edit-modal");
const editJobNumber = $("edit-job-number");
const editStatus = $("edit-status");
const editWorkReady = $("edit-work-ready");
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
const paymentAmountInput = $("job-payment-amount");
const paymentMethodSelect = $("job-payment-method");
const recordPaymentBtn = $("job-record-payment");

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
let currentJobPaid = null;
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
const STATUS_LIST = ["Draft", "Processing", "Processed", "Received", "Diagnosing", "Ready for Pickup", "Unclaimed"];
const TERMINAL_STATUS = "Collected";
const PARKING_GRACE_DAYS = 7;
const PARKING_FEE_PER_DAY = 3;

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// =====================================================================
// Labour charges (vehicle rate tiers)
// =====================================================================
async function loadRateTiers() {
  const table = $("tiers-table");
  try {
    const { data, error } = await supabase.from("vehicle_rate_tiers").select("*").order("sort_order");
    if (error) throw error;
    rateTiers = (data || []).filter(t => t.is_active !== false);
  } catch (error) {
    console.error("Error loading rate tiers:", error);
    const message = escapeHtml(error?.message || String(error));
    if (table) table.innerHTML = `<tr><td colspan="5" class="empty-state">Couldn't load vehicle rates: ${message}</td></tr>`;
    if (editRateTier) editRateTier.innerHTML = `<option value="">Couldn't load vehicle rates</option>`;
    if (newRateTier) newRateTier.innerHTML = `<option value="">Couldn't load vehicle rates</option>`;
    return;
  }
  const options = rateTiers.map(t => `<option value="${t.id}">${escapeHtml(t.tier_name)} — ${money(t.hourly_rate)}/hr</option>`).join("");
  if (editRateTier) editRateTier.innerHTML = options || `<option value="">No labour charges set — add them in Settings</option>`;
  if (newRateTier) newRateTier.innerHTML = options || `<option value="">No labour charges set — add them in Settings</option>`;
  if (table) {
    table.innerHTML = rateTiers.length ? rateTiers.map(t => `
      <tr>
        <td>${escapeHtml(t.tier_name)}</td>
        <td>${money(t.hourly_rate)}/hr</td>
        <td>${escapeHtml((t.makes || []).join(", ") || "Manual selection")}</td>
        <td>${t.is_default ? "Default" : "—"}</td>
        <td></td>
      </tr>`).join("") : `<tr><td colspan="5" class="empty-state">No vehicle rates yet. Add a tier above.</td></tr>`;
  }
  autoPickNewTier();
}

$("tier-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const nameInput = $("tier-name");
  const rateInput = $("tier-rate");
  const makesInput = $("tier-makes");
  const defaultInput = $("tier-default");
  const message = $("tier-form-message");
  const tier_name = nameInput.value.trim();
  const hourly_rate = Number(rateInput.value);
  const makes = makesInput.value.split(",").map(make => make.trim()).filter(Boolean);
  if (!tier_name) {
    message.textContent = "Enter a name for the vehicle rate.";
    return;
  }
  if (rateInput.value === "" || !Number.isFinite(hourly_rate) || hourly_rate < 0) {
    message.textContent = "Enter a valid hourly rate.";
    return;
  }
  if (rateTiers.some(t => t.tier_name.toLowerCase() === tier_name.toLowerCase())) {
    message.textContent = "A vehicle rate with that name already exists.";
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Adding…";
  message.textContent = "";
  const is_default = defaultInput.checked || rateTiers.length === 0;
  const previousDefault = rateTiers.find(tier => tier.is_default);
  let defaultCleared = false;
  if (is_default && previousDefault) {
    const { error } = await supabase.from("vehicle_rate_tiers").update({ is_default: false }).eq("is_default", true);
    if (error) {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="plus"></i> Add Tier';
      if (window.lucide) lucide.createIcons();
      message.textContent = `Couldn't change the default vehicle rate: ${error.message}`;
      return;
    }
    defaultCleared = true;
  }
  const sort_order = rateTiers.reduce((max, tier) => Math.max(max, tier.sort_order || 0), 0) + 1;
  const { error } = await supabase.from("vehicle_rate_tiers").insert([{
    tier_name,
    hourly_rate,
    makes,
    is_default,
    sort_order
  }]);
  button.disabled = false;
  button.innerHTML = '<i data-lucide="plus"></i> Add Tier';
  if (window.lucide) lucide.createIcons();
  if (error) {
    let restoreMessage = "";
    if (defaultCleared) {
      const { error: restoreError } = await supabase.from("vehicle_rate_tiers").update({ is_default: true }).eq("id", previousDefault.id);
      if (restoreError) {
        console.error("Couldn't restore the previous default vehicle rate:", restoreError);
        restoreMessage = ` The previous default also couldn't be restored: ${restoreError.message}`;
      }
    }
    message.textContent = `Couldn't add vehicle rate: ${error.message}${restoreMessage}`;
    return;
  }
  form.reset();
  message.textContent = `${tier_name} added.`;
  await loadRateTiers();
});

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
  if (currentEditJobId) {
    setText("job-payment-summary", Number.isFinite(currentJobPaid)
      ? `Total ${money(total)} · Paid ${money(currentJobPaid)} · Balance ${money(Math.max(0, total - currentJobPaid))}`
      : "Payment balance unavailable");
  }
  if (!zigTotal) return;
  const rate = await getRate();
  zigTotal.textContent = `≈ ZiG ${(total * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
editLabour?.addEventListener("input", updateZigDisplay);
editParts?.addEventListener("input", updateZigDisplay);

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
  customerSelect.innerHTML =
    `<option value="" disabled ${selectId ? "" : "selected"}>Select a customer…</option>` +
    customersList.map(c => `<option value="${c.id}">${escapeHtml(c.full_name)}${c.phone ? ` — ${escapeHtml(c.phone)}` : ""}</option>`).join("") +
    `<option value="__new_customer__">Register a new customer…</option>`;
  if (selectId && customersList.some(c => c.id === selectId)) {
    customerSelect.value = selectId;
    onCustomerChange(selectVehicleId);
  } else {
    onCustomerChange();
  }
}

function selectedCustomer() {
  return customersList.find(c => c.id === customerSelect.value) || null;
}

function onCustomerChange(selectVehicleId = null) {
  const value = customerSelect.value;
  $("new-customer-box")?.classList.toggle("hidden", value !== "__new_customer__");
  if (value === "__new_customer__") {
    jobPlateSelect.disabled = false;
    jobPlateSelect.innerHTML = `<option value="__new_vehicle__">Register a new vehicle…</option>`;
    jobPlateSelect.value = "__new_vehicle__";
    onVehicleChange();
    return;
  }
  if (!value) {
    jobPlateSelect.innerHTML = `<option value="">Select a customer first…</option>`;
    jobPlateSelect.disabled = true;
    newPlateField?.classList.add("hidden");
    clearVehicleFields();
    return;
  }
  const vehicles = selectedCustomer()?.vehicles || [];
  jobPlateSelect.disabled = false;
  jobPlateSelect.innerHTML =
    `<option value="">Select a registered vehicle…</option>` +
    vehicles.map(v => {
      const label = [v.make, v.model].filter(Boolean).join(" ");
      return `<option value="${v.id}">${escapeHtml(v.license_plate || "No plate")}${label ? ` — ${escapeHtml(label)}` : ""}</option>`;
    }).join("") +
    `<option value="__new_vehicle__">Register a new vehicle…</option>`;
  if (selectVehicleId && vehicles.some(v => v.id === selectVehicleId)) jobPlateSelect.value = selectVehicleId;
  else jobPlateSelect.value = "";
  onVehicleChange();
}
customerSelect.addEventListener("change", () => onCustomerChange());

function onVehicleChange() {
  const isNewVehicle = jobPlateSelect.value === "__new_vehicle__";
  newPlateField?.classList.toggle("hidden", !isNewVehicle);
  const vehicle = (selectedCustomer()?.vehicles || []).find(v => v.id === jobPlateSelect.value);
  if (vehicle) autofillVehicleFields(vehicle);
  else clearVehicleFields();
}
jobPlateSelect.addEventListener("change", onVehicleChange);

function clearVehicleFields() {
  $("job-body-type").value = "Sedan";
  ["job-make", "job-model", "job-year", "job-chassis", "job-engine"].forEach(id => { $(id).value = ""; });
  if ($("job-new-plate")) $("job-new-plate").value = "";
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
  if (!partsEl || !incEl) return;

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
  const { data: openJobs } = await supabase.from("repair_jobs").select("technician_id").not("technician_id", "is", null).not("status", "in", '("Processed","Ready for Pickup","Unclaimed","Collected")');
  const counts = {};
  (openJobs || []).forEach(j => { counts[j.technician_id] = (counts[j.technician_id] || 0) + 1; });
  mechanicsList = mechanicsList.map(m => ({ ...m, openJobs: counts[m.id] || 0 }));
}

async function loadTechniciansIntoSelect() {
  // Only mechanics, read through technician_directory (the safe, name-only view).
  const { data: mechanics, error } = await supabase.from("technician_directory").select("id, full_name").eq("department", "Mechanics").eq("is_active", true).order("full_name");
  if (error) { console.error("Error loading technicians:", error); return; }
  mechanicsList = (mechanics || []).map(m => ({ ...m, openJobs: 0 }));
  await refreshBusyMechanics();
  refreshTechnicianOptions(editTechnician, null);
  refreshTechnicianOptions(newTechnician, null);
  const mechanicFilter = $("jobs-filter-mechanic");
  if (mechanicFilter) {
    mechanicFilter.innerHTML = `<option value="">All Mechanics</option>` + mechanicsList.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)}</option>`).join("");
  }
}

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
      <label class="jc-delete-select"><input type="checkbox" class="job-part-select-checkbox" value="${jp.id}" aria-label="Select ${escapeHtml(jp.part_name)}" /> Select</label>
      <span>${escapeHtml(jp.part_name)} <em>× ${jp.quantity}</em></span><b>${money(jp.price_at_time * jp.quantity)}</b>
      <button type="button" class="btn jc-rm remove-job-part-btn" data-jp-id="${jp.id}" aria-label="Remove part"><i data-lucide="x"></i></button>
    </div>`).join("") : `<div class="jc-empty">No parts added yet</div>`;

  jobPartsList.querySelectorAll(".remove-job-part-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      try { await removeJobPart(btn.dataset.jpId, jobId); }
      catch (error) { alert("Couldn't remove this part: " + error.message); }
    });
  });
  jobPartsList.querySelectorAll(".job-part-select-checkbox").forEach(input => input.addEventListener("change", updateJobPartDeleteControls));
  updateJobPartDeleteControls();
  if (window.lucide) lucide.createIcons();
  applyCollectedLock(currentEditJob?.status === TERMINAL_STATUS);
  recalcPartsCost();
}

function recalcPartsCost() {
  const total = cardParts.reduce((sum, jp) => sum + jp.quantity * jp.price_at_time, 0);
  editParts.value = total.toFixed(2);
  updateZigDisplay();
}

async function removeJobPart(jobPartId, jobId, { confirm = true, refresh = true } = {}) {
  if (currentEditJob?.status === TERMINAL_STATUS) {
    throw new Error("This vehicle has been collected. Parts can no longer be changed.");
  }
  if (confirm && !(await confirmTypedDelete("this part from the job card"))) return false;
  const { data: jp, error: partUseError } = await supabase.from("job_parts").select("part_id, quantity").eq("id", jobPartId).single();
  if (partUseError) throw partUseError;
  if (jp?.part_id) {
    const { data: part, error: stockReadError } = await supabase.from("parts").select("quantity_in_stock").eq("id", jp.part_id).single();
    if (stockReadError) throw stockReadError;
    if (part) {
      const { error: stockUpdateError } = await supabase.from("parts").update({ quantity_in_stock: part.quantity_in_stock + jp.quantity }).eq("id", jp.part_id);
      if (stockUpdateError) throw stockUpdateError;
    }
  }
  const { data: deletedParts, error: deleteError } = await supabase.from("job_parts").delete().eq("id", jobPartId).select("id");
  if (deleteError) throw deleteError;
  if (!deletedParts?.length) throw new Error("The part was not removed. Check your role permissions and try again.");
  if (refresh) {
    await loadJobParts(jobId);
    await loadPartsIntoSelect();
  }
  return true;
}

function updateJobPartDeleteControls() {
  const boxes = [...document.querySelectorAll(".job-part-select-checkbox")];
  const selectedCount = boxes.filter(box => box.checked).length;
  const selectAll = $("job-parts-select-all");
  const deleteButton = $("job-parts-delete-selected");
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && selectedCount === boxes.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < boxes.length;
    selectAll.disabled = boxes.length === 0 || currentEditJob?.status === TERMINAL_STATUS;
  }
  if (deleteButton) {
    deleteButton.disabled = selectedCount === 0 || currentEditJob?.status === TERMINAL_STATUS;
    deleteButton.textContent = selectedCount ? `Remove selected (${selectedCount})` : "Remove selected";
  }
}

$("job-parts-select-all")?.addEventListener("change", event => {
  jobPartsList?.querySelectorAll(".job-part-select-checkbox").forEach(box => { box.checked = event.currentTarget.checked; });
  updateJobPartDeleteControls();
});

$("job-parts-delete-selected")?.addEventListener("click", async () => {
  const ids = [...(jobPartsList?.querySelectorAll(".job-part-select-checkbox:checked") || [])].map(box => box.value);
  const jobId = currentEditJobId;
  if (!ids.length || !jobId || !(await confirmTypedDelete(`${ids.length} selected job part${ids.length === 1 ? "" : "s"}`))) return;
  const button = $("job-parts-delete-selected");
  const message = $("job-parts-delete-message");
  button.disabled = true;
  let removed = 0;
  try {
    for (const id of ids) {
      await removeJobPart(id, jobId, { confirm: false, refresh: false });
      removed += 1;
    }
    message.textContent = `${removed} job part${removed === 1 ? "" : "s"} removed; stock and job totals refreshed.`;
    message.dataset.tone = "";
  } catch (error) {
    message.textContent = `${removed} removed before an error: ${error.message || String(error)}`;
    message.dataset.tone = "error";
  } finally {
    await loadJobParts(jobId);
    await loadPartsIntoSelect();
  }
});

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
      <label class="jc-delete-select"><input type="checkbox" class="incidental-select-checkbox" value="${inc.id}" aria-label="Select ${escapeHtml(inc.description)}" /> Select</label>
      <span>${escapeHtml(inc.description)}</span><b>${money(inc.amount)}</b>
      <button type="button" class="btn jc-rm remove-incidental-btn" data-inc-id="${inc.id}" aria-label="Remove incidental"><i data-lucide="x"></i></button>
    </div>`).join("") : `<div class="jc-empty">None added yet</div>`;
  list.querySelectorAll(".remove-incidental-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (currentEditJob?.status === TERMINAL_STATUS) return;
      if (!(await confirmTypedDelete("this incidental from the job card"))) return;
      const { data: deleted, error: deleteError } = await supabase.from("job_incidentals").delete().eq("id", btn.dataset.incId).eq("job_id", jobId).select("id");
      if (deleteError) { alert("Couldn't remove this incidental: " + deleteError.message); return; }
      if (!deleted?.length) { alert("This incidental was not removed. Check your role permissions and try again."); return; }
      await loadJobIncidentals(jobId);
    });
  });
  list.querySelectorAll(".incidental-select-checkbox").forEach(input => input.addEventListener("change", updateIncidentalDeleteControls));
  updateIncidentalDeleteControls();
  if (window.lucide) lucide.createIcons();
  applyCollectedLock(currentEditJob?.status === TERMINAL_STATUS);

  cardIncidentalsTotal = cardIncidentals.reduce((sum, inc) => sum + Number(inc.amount), 0);
  updateZigDisplay();
  const { error: totalError } = await supabase.from("repair_jobs").update({ incidentals_cost: cardIncidentalsTotal }).eq("id", jobId);
  if (totalError) {
    console.error("Couldn't update job incidental total:", totalError);
    const message = $("incidentals-delete-message");
    if (message) {
      message.textContent = "Incidentals changed, but the job total couldn't be saved: " + totalError.message;
      message.dataset.tone = "error";
    }
  }
}

function updateIncidentalDeleteControls() {
  const boxes = [...document.querySelectorAll(".incidental-select-checkbox")];
  const selectedCount = boxes.filter(box => box.checked).length;
  const selectAll = $("incidentals-select-all");
  const deleteButton = $("incidentals-delete-selected");
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && selectedCount === boxes.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < boxes.length;
    selectAll.disabled = boxes.length === 0 || currentEditJob?.status === TERMINAL_STATUS;
  }
  if (deleteButton) {
    deleteButton.disabled = selectedCount === 0 || currentEditJob?.status === TERMINAL_STATUS;
    deleteButton.textContent = selectedCount ? `Remove selected (${selectedCount})` : "Remove selected";
  }
}

$("incidentals-select-all")?.addEventListener("change", event => {
  $("incidentals-list")?.querySelectorAll(".incidental-select-checkbox").forEach(box => { box.checked = event.currentTarget.checked; });
  updateIncidentalDeleteControls();
});

$("incidentals-delete-selected")?.addEventListener("click", async () => {
  const ids = [...($("incidentals-list")?.querySelectorAll(".incidental-select-checkbox:checked") || [])].map(box => box.value);
  const jobId = currentEditJobId;
  if (!ids.length || !jobId || currentEditJob?.status === TERMINAL_STATUS || !(await confirmTypedDelete(`${ids.length} selected incidental${ids.length === 1 ? "" : "s"}`))) return;
  const button = $("incidentals-delete-selected");
  const message = $("incidentals-delete-message");
  button.disabled = true;
  const { data, error } = await supabase.from("job_incidentals").delete()
    .in("id", ids)
    .eq("job_id", jobId)
    .select("id");
  if (error) {
    message.textContent = "Couldn't remove selected incidentals: " + error.message;
    message.dataset.tone = "error";
    updateIncidentalDeleteControls();
    return;
  }
  if (!data?.length) {
    message.textContent = "No incidentals were removed. Refresh the job card and try again.";
    message.dataset.tone = "error";
    updateIncidentalDeleteControls();
    return;
  }
  const remaining = ids.length - data.length;
  message.textContent = remaining
    ? `${data.length} removed; ${remaining} were not found. Refreshing the job total…`
    : `${data.length} incidental${data.length === 1 ? "" : "s"} removed; job totals refreshed.`;
  message.dataset.tone = "";
  await loadJobIncidentals(jobId);
});

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
      id, job_number, cro_number, portal_token, vehicle_id, fault_reported, diagnosis, diagnosis_eta, status, work_ready, labour_cost, labour_hours, rate_tier_id, parts_cost, incidentals_cost, total_cost, technician_id, ready_at, collected_at, created_at, ai_suggested_causes, fuel_level_in, odometer_in, driver_name, driver_phone, picked_up_by,
      customers ( full_name, phone, email, customer_type ),
      vehicles ( make, model, year, license_plate, engine_number, chassis_number, body_type )
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

  if (data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--text-muted)">No job cards yet</td></tr>`;
    if (window.lucide) lucide.createIcons();
    applyJobFilters();
    renderWorkload();
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
        <td class="jc-clip">${escapeHtml(job.fault_reported)}</td>
        <td><span class="badge ${meta.cls}"><i data-lucide="${meta.icon}"></i> ${escapeHtml(job.status)}</span></td>
        <td>${escapeHtml(techNamesById[job.technician_id] ?? "Unassigned")}</td>
        <td>${money(job.total_cost)}</td>
        <td><button class="btn edit-job-btn" data-job-id="${job.id}"><i data-lucide="file-text"></i> Open Job Card</button></td>
      </tr>`;
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
const FINISHED = ["Processed", "Ready for Pickup", "Unclaimed", "Collected"];
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

  const eligible = job.ready_at && !job.collected_at && ["Processed", "Ready for Pickup", "Unclaimed"].includes(job.status);
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
  currentJobPaid = null;
  pendingCollection = false;
  cardParts = [];
  cardIncidentals = [];
  cardIncidentalsTotal = Number(job.incidentals_cost) || 0;
  renderCardHeader(job);

  editStatus.value = job.status;
  editWorkReady.checked = Boolean(job.work_ready);
  editDiagnosis.value = job.diagnosis ?? "";
  editDiagnosisEta.value = toDatetimeLocalValue(job.diagnosis_eta);
  editLabour.value = job.labour_cost ?? 0;
  editParts.value = job.parts_cost ?? 0;
  const aiResultEl = $("ai-suggest-causes-result");
  if (aiResultEl) {
    if (job.ai_suggested_causes) { aiResultEl.textContent = job.ai_suggested_causes; aiResultEl.style.display = "block"; }
    else { aiResultEl.style.display = "none"; aiResultEl.textContent = ""; }
  }
  await refreshBusyMechanics();
  refreshTechnicianOptions(editTechnician, job.technician_id || null);
  editTechnician.value = job.technician_id ?? "";
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
    editReceiptLink.classList.toggle("hidden", !["Processed", "Ready for Pickup", "Unclaimed"].includes(job.status));
  }
  if ($("edit-picked-up-by")) $("edit-picked-up-by").value = job.picked_up_by || "";
  updateZigDisplay();
  loadJobParts(job.id);
  loadJobIncidentals(job.id);

  editCollectionFields?.classList.toggle("hidden", !alreadyCollected);
  $("picked-up-by-field")?.classList.toggle("hidden", job.customers?.customer_type !== "company");
  if (editMarkCollectedBtn) {
    editMarkCollectedBtn.classList.toggle("hidden", !["Processed", "Ready for Pickup", "Unclaimed"].includes(job.status));
    editMarkCollectedBtn.innerHTML = '<i data-lucide="check-check"></i> Mark as Collected';
  }
  renderPickupCountdown(job);
  loadJobPayments(job.id);

  modal.classList.remove("hidden");
  modal.querySelector(".jc-mbody")?.scrollTo(0, 0);
  if (window.lucide) lucide.createIcons();
}

function applyCollectedLock(isCollected) {
  [editStatus, editWorkReady, editDiagnosis, editDiagnosisEta, editLabour, editTechnician, editOdometer, editCollectionNotes, jobPartSelect, jobPartQty, jobPartAddBtn, editHours, editRateTier, paymentAmountInput, paymentMethodSelect, recordPaymentBtn].forEach(element => {
    if (element) element.disabled = isCollected;
  });
  [$("incidental-desc"), $("incidental-amount"), incidentalAddBtn].forEach(element => {
    if (element) element.disabled = isCollected;
  });
  document.querySelectorAll(".remove-job-part-btn, .remove-incidental-btn").forEach(button => { button.disabled = isCollected; });
  updateJobPartDeleteControls();
  updateIncidentalDeleteControls();
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

editCancelBtn?.addEventListener("click", closeEditModal);
$("jc-close")?.addEventListener("click", closeEditModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeEditModal(); });
editStatus?.addEventListener("change", () => {
  if (!currentEditJob) return;
  updateWhatsappButton({ ...currentEditJob, status: editStatus.value });
});
modal?.addEventListener("click", (e) => { if (e.target === modal) closeEditModal(); });

editSaveBtn?.addEventListener("click", async () => {
  if (!currentEditJobId) return;

  const status = editStatus.value;
  const labour_cost = parseFloat(editLabour.value) || 0;
  const parts_cost = parseFloat(editParts.value) || 0;

  const updates = {
    status,
    work_ready: editWorkReady.checked,
    diagnosis: editDiagnosis.value.trim() || null,
    diagnosis_eta: editDiagnosisEta.value ? new Date(editDiagnosisEta.value).toISOString() : null,
    labour_cost,
    labour_hours: parseFloat(editHours.value) || null,
    rate_tier_id: editRateTier.value || null,
    parts_cost,
    technician_id: editTechnician.value || null,
  };

  if (status === "Processed") {
    if (!editWorkReady.checked) {
      alert("Mark the repair work ready before processing the job.");
      return;
    }
    const total = Math.max(0, labour_cost + parts_cost + cardIncidentalsTotal);
    const { data: payments, error: paymentError } = await supabase.from("repair_job_payments").select("amount").eq("repair_job_id", currentEditJobId);
    if (paymentError) {
      alert("Couldn't verify the job balance: " + paymentError.message);
      return;
    }
    const paid = (payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    if (total - paid > 0.01) {
      alert(`The job cannot be processed until it is fully paid. Balance due: ${money(total - paid)}.`);
      return;
    }
  }

  // Only set ready_at/completed_at the FIRST time a job enters one of these
  // states, so unrelated edits don't reset the 7-day pickup countdown.
  const isNowReadyOrUnclaimed = ["Processed", "Ready for Pickup", "Unclaimed"].includes(status);
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

  if (["Ready for Pickup", "Unclaimed"].includes(status)) {
    try {
      await ensureReceiptExists(currentEditJobId, labour_cost + parts_cost + cardIncidentalsTotal);
    } catch (receiptError) {
      console.error("Could not keep the job receipt in sync:", receiptError);
      alert(receiptError.message || String(receiptError));
    }
  }
  if (isNowReadyOrUnclaimed) {
    await sendStatusEmail(currentEditJob, status, labour_cost + parts_cost + cardIncidentalsTotal);
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

  if (currentEditJob?.status === "Processed") {
    if (!currentEditJob.work_ready) {
      alert("Mark the repair work ready before collection.");
      return;
    }
    const total = currentJobTotal();
    const { data: payments, error: paymentError } = await supabase.from("repair_job_payments").select("amount").eq("repair_job_id", currentEditJobId);
    if (paymentError) {
      alert("Couldn't verify the job balance: " + paymentError.message);
      return;
    }
    const paid = (payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    if (total - paid > 0.01) {
      alert(`The vehicle cannot be collected until it is fully paid. Balance due: ${money(total - paid)}.`);
      return;
    }
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

function currentJobTotal() {
  return Math.max(0,
    (parseFloat(editLabour?.value) || 0) +
    (parseFloat(editParts?.value) || 0) +
    cardIncidentalsTotal);
}

async function loadJobPayments(jobId) {
  const summary = $("job-payment-summary");
  const history = $("job-payment-history");
  summary.textContent = "Loading payments…";
  history.innerHTML = "";
  const { data, error } = await supabase.from("repair_job_payments")
    .select("id, amount, payment_method, paid_at")
    .eq("repair_job_id", jobId)
    .order("paid_at");
  if (error) {
    currentJobPaid = null;
    summary.textContent = `Couldn't load payments: ${error.message}`;
    console.error("Error loading job payments:", error);
    return;
  }
  const payments = data || [];
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  currentJobPaid = paid;
  const total = currentJobTotal();
  summary.textContent = `Total ${money(total)} · Paid ${money(paid)} · Balance ${money(Math.max(0, total - paid))}`;
  history.innerHTML = payments.length
    ? payments.map(payment => `<div class="jc-line"><span>${escapeHtml(payment.payment_method)} · ${new Date(payment.paid_at).toLocaleString()}</span><strong>${money(payment.amount)}</strong></div>`).join("")
    : `<div class="empty-state">No payments recorded yet.</div>`;
  if (paymentAmountInput) paymentAmountInput.max = Math.max(0, total - paid).toFixed(2);
}

recordPaymentBtn?.addEventListener("click", async () => {
  if (!currentEditJobId) return;
  const amount = Number(paymentAmountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Enter a payment amount greater than zero.");
    return;
  }
  const { data: existing, error: lookupError } = await supabase.from("repair_job_payments")
    .select("amount")
    .eq("repair_job_id", currentEditJobId);
  if (lookupError) {
    alert("Couldn't check existing payments: " + lookupError.message);
    return;
  }
  const totalPaid = (existing || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const balance = currentJobTotal() - totalPaid;
  if (amount > balance + 0.01) {
    alert(`Payment exceeds the balance due (${money(Math.max(0, balance))}).`);
    return;
  }
  recordPaymentBtn.disabled = true;
  const { error } = await supabase.from("repair_job_payments").insert([{
    repair_job_id: currentEditJobId,
    amount,
    payment_method: paymentMethodSelect.value,
  }]);
  recordPaymentBtn.disabled = false;
  if (error) {
    alert("Couldn't record payment: " + error.message);
    return;
  }
  const cumulativePaid = totalPaid + amount;
  try {
    await ensureReceiptExists(currentEditJobId, cumulativePaid);
  } catch (receiptError) {
    console.error("Payment saved but cumulative receipt could not be updated:", receiptError);
    alert(`Payment was saved, but the cumulative receipt could not be updated: ${receiptError.message || receiptError}`);
  }
  paymentAmountInput.value = "";
  currentJobPaid = cumulativePaid;
  await loadJobPayments(currentEditJobId);
});

async function ensureReceiptExists(jobId, amount) {
  const { data: existing, error: checkError } = await supabase.from("receipts").select("id").eq("repair_job_id", jobId).limit(1);
  if (checkError) throw new Error("Couldn't check the existing job receipt: " + checkError.message);
  if (existing?.length) {
    const { error } = await supabase.from("receipts").update({ amount }).eq("id", existing[0].id);
    if (error) throw new Error("Couldn't update the cumulative job receipt: " + error.message);
    return;
  }
  const { error: insertError } = await supabase.from("receipts").insert([{ repair_job_id: jobId, amount }]);
  if (insertError) throw new Error("Couldn't create the job receipt: " + insertError.message);
}

// =====================================================================
// Print job card
// =====================================================================
async function loadBusinessInfo() {
  if (businessInfo) return businessInfo;
  const { data } = await supabase.from("business_settings").select("business_name, tagline, address, phone, email").eq("id", 1).maybeSingle();
  businessInfo = data || { business_name: "Auto Parts & Repairs" };
  return businessInfo;
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
  const submitBtn = form.querySelector('button[type="submit"]');

  const customerValue = customerSelect.value;
  const vehicleValue = jobPlateSelect.value;
  const body_type = $("job-body-type").value;
  const make = $("job-make").value.trim();
  const model = $("job-model").value.trim();
  const year = parseInt($("job-year").value, 10) || null;
  const chassis_number = $("job-chassis").value.trim();
  const engine_number = $("job-engine").value.trim();
  const fuel_level_in = $("job-fuel-in").value || null;
  const odometer_in = parseInt($("job-odometer-in").value, 10);
  const fault_reported = $("job-fault").value.trim();
  const labourHours = parseFloat(newHours?.value || "") || null;
  const etaValue = $("job-diagnosis-eta")?.value || "";
  const intakePath = form.querySelector('input[name="job-intake-path"]:checked')?.value || "direct";
  const statusValue = "Draft";
  const diagnosisValue = $("job-diagnosis")?.value.trim() || null;
  const tierValue = newRateTier?.value || null;
  const labourValue = parseFloat(newLabour?.value || "") || 0;
  const technicianValue = newTechnician?.value || null;
  const driverName = $("job-driver-name")?.value.trim() || null;
  const driverPhone = $("job-driver-phone")?.value.trim() || null;
  const partsToAdd = stagedParts.map(x => ({ ...x }));
  const incidentalsToAdd = stagedIncidentals.map(x => ({ ...x }));

  // ---- Validate everything before writing anything ----
  if (!customerValue) return showFormMessage("Select a customer.");
  const newCustomer = customerValue === "__new_customer__";
  const newVehicle = vehicleValue === "__new_vehicle__";
  if (!vehicleValue || (!newVehicle && !selectedCustomer()?.vehicles.some(vehicle => vehicle.id === vehicleValue))) return showFormMessage("Select a registered vehicle or choose to register a new one.");
  const newCustomerName = $("job-new-customer-name")?.value.trim() || "";
  const newCustomerPhone = $("job-new-customer-phone")?.value.trim() || "";
  const newCustomerEmail = $("job-new-customer-email")?.value.trim() || "";
  if (newCustomer && (!newCustomerName || !newCustomerPhone)) return showFormMessage("Enter the new customer's name and phone number.");
  if (newCustomer && digits(newCustomerPhone).length < 7) return showFormMessage("Enter a valid customer phone number.");
  if (newCustomerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCustomerEmail)) return showFormMessage("Enter a valid email address.");
  if (newVehicle && !$("job-new-plate").value.trim()) return showFormMessage("Enter the vehicle plate number.");
  if (!make) return showFormMessage("Enter the vehicle make.");
  if (!chassis_number || !engine_number) return showFormMessage("Chassis number and engine number are both required — a plate alone isn't a reliable identifier.");
  if ($("job-odometer-in").value && !(odometer_in >= 0)) return showFormMessage("Enter a valid odometer reading.");
  if (!fault_reported) return showFormMessage("Describe the fault reported.");

  submitBtn.disabled = true;
  const originalBtn = submitBtn.innerHTML;
  submitBtn.innerHTML = `<i data-lucide="loader-circle"></i> Creating…`;
  if (window.lucide) lucide.createIcons();

  try {
    const quoteId = new URLSearchParams(window.location.search).get("quote");
    let quotedItems = [];
    if (quoteId) {
      const { data: quote, error: quoteError } = await supabase.from("quotations")
        .select("customer_id, vehicle_id")
        .eq("id", quoteId)
        .single();
      if (quoteError) throw new Error("Couldn't verify the quotation: " + quoteError.message);
      if (quote.customer_id !== customerValue || (quote.vehicle_id && quote.vehicle_id !== vehicleValue)) {
        throw new Error("This intake no longer matches the customer or vehicle on the quotation. Reopen the job-card action from that quotation.");
      }
      const { data: items, error: itemsError } = await supabase.from("quotation_items")
        .select("part_id, item_type, part_name, quantity, unit_price_usd, total_usd")
        .eq("quotation_id", quoteId);
      if (itemsError) throw new Error("Couldn't load the approved quotation items: " + itemsError.message);
      quotedItems = items || [];
    }

    // ---- 1. Customer / company ----
    let customer_id = customerValue;
    if (newCustomer) {
      const { data: existingCustomers, error: lookupError } = await supabase.from("customers")
        .select("id")
        .eq("phone", newCustomerPhone)
        .limit(1);
      if (lookupError) throw new Error("Couldn't check for an existing customer: " + lookupError.message);
      if (existingCustomers?.length) {
        customer_id = existingCustomers[0].id;
      } else {
        const { data: customer, error } = await supabase.from("customers").insert([{
          full_name: newCustomerName,
          phone: newCustomerPhone,
          email: newCustomerEmail || null,
          customer_type: "individual",
        }]).select("id").single();
        if (error) throw new Error("Couldn't register the customer: " + error.message);
        customer_id = customer.id;
      }
    }

    // ---- 2. Create or update the selected vehicle ----
    let vehicle_id = vehicleValue;
    const vehicleDetails = { body_type, make, model: model || null, year, chassis_number, engine_number };
    if (newVehicle) {
      const { data: vehicle, error } = await supabase.from("vehicles").insert([{
        customer_id,
        license_plate: $("job-new-plate").value.trim().toUpperCase(),
        ...vehicleDetails,
      }]).select("id").single();
      if (error) throw new Error("Couldn't register the vehicle: " + error.message);
      vehicle_id = vehicle.id;
    } else {
      const { error } = await supabase.from("vehicles").update(vehicleDetails).eq("id", vehicle_id);
      if (error) throw new Error("Couldn't update the vehicle details: " + error.message);
    }

    if (intakePath === "quote") {
      window.location.href = `quotations.html?customer=${encodeURIComponent(customer_id)}&vehicle=${encodeURIComponent(vehicle_id)}&fault=${encodeURIComponent(fault_reported)}`;
      return;
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
    let quoteLinkWarning = "";
    if (quoteId) {
      const { error: quoteUpdateError } = await supabase.from("quotations")
        .update({ repair_job_id: job.id })
        .eq("id", quoteId);
      if (quoteUpdateError) {
        quoteLinkWarning = ` The job was created, but the quotation link could not be updated: ${quoteUpdateError.message}`;
        console.error("Could not link the created job to its quotation:", quoteUpdateError);
      }
    }

    // ---- 4. Parts (stock is taken here) and incidentals ----
    const skipped = [];
    let partsCost = 0;
    let quotedLabourCost = 0;
    let quotedLabourHours = 0;
    const quoteSundries = [];
    for (const item of quotedItems) {
      const itemType = item.item_type || (item.part_id ? "part" : "other");
      const quantity = Number(item.quantity);
      const amount = Number(item.total_usd ?? quantity * Number(item.unit_price_usd));
      if (itemType === "labour") {
        quotedLabourHours += quantity;
        quotedLabourCost += amount;
      } else if (itemType === "sundry") {
        quoteSundries.push({ description: item.part_name || "Quoted sundry", amount });
      } else if (itemType === "part") {
        if (!item.part_id || !Number.isInteger(quantity) || quantity <= 0) {
          skipped.push(item.part_name || "invalid quoted part");
          continue;
        }
        const { data: consumed, error: stockError } = await supabase.rpc("consume_part_stock", {
          p_part_id: item.part_id,
          p_quantity: quantity,
        });
        if (stockError || !consumed) {
          skipped.push(item.part_name);
          continue;
        }
        const { error: insertError } = await supabase.from("job_parts").insert([{
          job_id: job.id,
          part_id: item.part_id,
          part_name: item.part_name,
          quantity,
          price_at_time: item.unit_price_usd,
        }]);
        if (insertError) {
          await supabase.rpc("restore_part_stock", { p_part_id: item.part_id, p_quantity: quantity });
          skipped.push(item.part_name);
          continue;
        }
        partsCost += amount;
      }
    }
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
    const incidentals = [
      ...quoteSundries,
      ...incidentalsToAdd.map(item => ({ description: item.description, amount: item.amount })),
    ];
    let incCost = 0;
    if (incidentals.length) {
      const { error } = await supabase.from("job_incidentals").insert(incidentals.map(item => ({ job_id: job.id, ...item })));
      if (error) skipped.push("incidentals");
      else incCost = incidentals.reduce((sum, item) => sum + item.amount, 0);
    }
    const labour_cost = labourValue + quotedLabourCost;
    const labour_hours = (labourHours || 0) + quotedLabourHours;
    const { error: totalsError } = await supabase.from("repair_jobs").update({
      labour_cost,
      labour_hours: labour_hours || null,
      parts_cost: partsCost,
      incidentals_cost: incCost,
    }).eq("id", job.id);
    if (totalsError) {
      quoteLinkWarning += ` The job was created, but its quoted totals could not be saved: ${totalsError.message}`;
      console.error("Could not save transferred quotation totals:", totalsError);
    }

    resetIntakeForm();
    const label = job.cro_number || (job.job_number != null ? `#${String(job.job_number).padStart(4, "0")}` : "");
    showFormMessage(skipped.length
      ? `Job card ${label} created, but these weren't added (not enough stock or an error): ${skipped.join(", ")}. Add them from the job card.${quoteLinkWarning}`
      : `Job card ${label} created.${quoteLinkWarning}`.replace("  ", " "), skipped.length || quoteLinkWarning ? "error" : "success");
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
  const etaIso = editDiagnosisEta.value ? new Date(editDiagnosisEta.value).toISOString() : null;

  let phone = null, email = null;
  if (channel === "whatsapp") {
    phone = formatPhoneForWhatsApp(job.customers?.phone)
      || formatPhoneForWhatsApp(prompt("WhatsApp number for this customer (e.g. 0771234567):") || "");
    if (!phone) return;
  } else {
    email = (job.customers?.email || "").trim() || (prompt("Customer email address:") || "").trim();
    if (!email) return;
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
  const btn = $("ai-suggest-causes-btn");
  const resultEl = $("ai-suggest-causes-result");
  const vehicleLabel = vehicleName(currentEditJob.vehicles) || "the vehicle";
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

if (editDiagnosisWhatsappBtn) editDiagnosisWhatsappBtn.addEventListener("click", () => sendDiagnosisUpdate("whatsapp"));
if (editDiagnosisEmailBtn) editDiagnosisEmailBtn.addEventListener("click", () => sendDiagnosisUpdate("email"));

// ---- Voice-powered fault intake ----
// Transcription itself uses the browser's own free, built-in Web Speech
// API — no AI call needed for that part, and it works offline-ish (just
// needs the browser's speech service). Gemini's only job here is
// cleaning up the raw, messy transcript (filler words, false starts)
// into something concise — it never does the actual listening.
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

// =====================================================================
// Filters + start-up
// =====================================================================
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
    if (status === "active") match = !["Processed", "Ready for Pickup", "Collected", "Unclaimed"].includes(job.status);
    else if (status === "completed-month") match = ["Processed", "Ready for Pickup"].includes(job.status);
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
  const quoteId = params.get("quote");
  const statusFilter = params.get("status");
  const highlightId = params.get("highlight");
  if (quoteId) {
    const { data: quote, error } = await supabase.from("quotations")
      .select("customer_id, vehicle_id, fault_reported")
      .eq("id", quoteId)
      .single();
    if (error) {
      showFormMessage(`Couldn't load the quotation for a job card: ${error.message}`, "error");
    } else {
      if (quote.customer_id) {
        customerSelect.value = quote.customer_id;
        onCustomerChange(quote.vehicle_id);
      }
      $("job-fault").value = quote.fault_reported || "";
      const directOption = form.querySelector('input[name="job-intake-path"][value="direct"]');
      if (directOption) directOption.checked = true;
      showFormMessage("Quotation loaded. Confirm the vehicle details, then create the draft job card.");
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } else if (editId && jobsById.has(editId)) openEditModal(jobsById.get(editId));
  else if (statusFilter) filterTableByStatus(statusFilter);
  else if (highlightId) {
    const row = document.querySelector(`#repairs-table tr[data-job-id="${highlightId}"]`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("highlight-flash");
    }
  }
});
