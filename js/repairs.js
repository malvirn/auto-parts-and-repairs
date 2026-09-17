// ========= Repair Jobs module =========
import supabase from "./supabaseClient.js";
import { STATUS_META, messageForStatus } from "./portalShared.js";

const tableBody = document.getElementById("repairs-table");
const form = document.getElementById("job-form");
const customerSelect = document.getElementById("job-customer");
const jobPlateSelect = document.getElementById("job-plate");

const modal = document.getElementById("edit-modal");
const editJobNumber = document.getElementById("edit-job-number");
const editStatus = document.getElementById("edit-status");
const editDiagnosis = document.getElementById("edit-diagnosis");
const editLabour = document.getElementById("edit-labour");
const editParts = document.getElementById("edit-parts");
const editTechnician = document.getElementById("edit-technician");
const editSaveBtn = document.getElementById("edit-save");
const editCancelBtn = document.getElementById("edit-cancel");
const editMarkCollectedBtn = document.getElementById("edit-mark-collected");
const editWhatsappBtn = document.getElementById("edit-whatsapp");
const editDiagnosisEta = document.getElementById("edit-diagnosis-eta");
const editDiagnosisWhatsappBtn = document.getElementById("edit-diagnosis-whatsapp");
const editDiagnosisEmailBtn = document.getElementById("edit-diagnosis-email");
const editQuoteLink = document.getElementById("edit-quote-link");
const editReceiptLink = document.getElementById("edit-receipt-link");
const zigTotal = document.getElementById("zig-total");
const editCollectionFields = document.getElementById("edit-collection-fields");
const editOdometer = document.getElementById("edit-odometer");
const editCollectionNotes = document.getElementById("edit-collection-notes");
const jobPartSelect = document.getElementById("job-part-select");
const jobPartQty = document.getElementById("job-part-qty");
const jobPartAddBtn = document.getElementById("job-part-add");
const jobPartsList = document.getElementById("job-parts-list");
const pickupCountdownBlock = document.getElementById("pickup-countdown-block");
const pickupCountdownDisplay = document.getElementById("pickup-countdown");
const applyParkingFeeBtn = document.getElementById("apply-parking-fee");

let currentEditJobId = null;
let currentEditJob = null;
let cachedRate = null;
let customerVehiclesMap = {};   // customer_id -> [{ id, license_plate, make, model, year, chassis_number, engine_number, body_type }]
let pendingCollection = false;
let countdownInterval = null;
let rateTiers = [];

const editRateTier = document.getElementById("edit-rate-tier");
const editHours = document.getElementById("edit-hours");

// ---- Vehicle rate tiers: load once, used for auto-detection by make ----
async function loadRateTiers() {
  const { data, error } = await supabase.from("vehicle_rate_tiers").select("*").order("sort_order");
  if (error) { console.error("Error loading rate tiers:", error); return; }
  rateTiers = data || [];
  if (editRateTier) {
    editRateTier.innerHTML = rateTiers.map(t => `<option value="${t.id}">${escapeHtml(t.tier_name)} — $${Number(t.hourly_rate).toFixed(2)}/hr</option>`).join("");
  }
}

// Case-insensitive match against each tier's makes list; falls back to
// whichever tier is flagged is_default if nothing matches (or the first
// tier at all, if somehow no default is set).
function detectTierForMake(make) {
  if (!make) return rateTiers.find(t => t.is_default) || rateTiers[0];
  const needle = make.trim().toLowerCase();
  const matched = rateTiers.find(t => (t.makes || []).some(m => m.toLowerCase() === needle));
  return matched || rateTiers.find(t => t.is_default) || rateTiers[0];
}

function recalcLabourFromHours() {
  const tier = rateTiers.find(t => t.id === editRateTier.value);
  const hours = parseFloat(editHours.value) || 0;
  if (tier && hours > 0) {
    editLabour.value = (hours * Number(tier.hourly_rate)).toFixed(2);
    updateZigDisplay();
  }
}
if (editRateTier) editRateTier.addEventListener("change", recalcLabourFromHours);
if (editHours) editHours.addEventListener("input", recalcLabourFromHours);

// Only these show up in the day-to-day status dropdown. The Postgres enum
// itself is untouched (still has the old values for historical rows) — this
// just narrows what staff can pick going forward. "Ready for Pickup" now
// doubles as the old "Completed" (job finished, waiting on the customer).
// "Collected" is intentionally not selectable here — it's reached only via
// the dedicated "Mark as Collected" button below, since it's a one-way,
// record-keeping action rather than a routine status change.
const STATUS_LIST = ["Received", "Diagnosing", "Ready for Pickup", "Unclaimed"];
const TERMINAL_STATUS = "Collected";

const PARKING_GRACE_DAYS = 7;
const PARKING_FEE_PER_DAY = 3;

async function getRate() {
  if (cachedRate) return cachedRate;
  const { data, error } = await supabase.from("settings").select("usd_to_zwg_rate").single();
  cachedRate = error ? 26.6908 : Number(data.usd_to_zwg_rate);
  return cachedRate;
}

async function updateZigDisplay() {
  if (!zigTotal) return;
  const rate = await getRate();
  const total = (parseFloat(editLabour.value) || 0) + (parseFloat(editParts.value) || 0);
  zigTotal.textContent = `≈ ZiG ${(total * rate).toLocaleString("en-US", { maximumFractionDigits: 2 })} (rate: ${rate})`;
}

if (editLabour) editLabour.addEventListener("input", updateZigDisplay);
if (editParts) editParts.addEventListener("input", updateZigDisplay);

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
    editWhatsappBtn.onclick = () => {
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    };
  } else {
    editWhatsappBtn.classList.add("hidden");
    editWhatsappBtn.onclick = null;
  }
}

// ---- Customers + their registered vehicles ----
// The license plate is no longer free text: it must be one of the vehicles
// already registered for that customer (via the Customers page), so this
// pulls full vehicle records per customer up front and caches them client-side
// rather than re-querying every time the customer selection changes.
async function loadCustomersIntoSelect() {
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, vehicles(id, license_plate, make, model, year, chassis_number, engine_number, body_type)")
    .order("full_name");

  if (error) { console.error("Error loading customers:", error); return; }

  customerVehiclesMap = {};
  customerSelect.innerHTML =
    `<option value="" disabled selected>Select a customer…</option>` +
    data.map(c => {
      customerVehiclesMap[c.id] = c.vehicles || [];
      return `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`;
    }).join("");

  resetVehicleSelect();
}

function resetVehicleSelect() {
  jobPlateSelect.innerHTML = `<option value="">Select a customer first…</option>`;
  jobPlateSelect.disabled = true;
  clearVehicleFields();
}

function clearVehicleFields() {
  document.getElementById("job-body-type").value = "Sedan";
  document.getElementById("job-make").value = "";
  document.getElementById("job-model").value = "";
  document.getElementById("job-year").value = "";
  document.getElementById("job-chassis").value = "";
  document.getElementById("job-engine").value = "";
}

function autofillVehicleFields(vehicle) {
  if (!vehicle) return;
  document.getElementById("job-body-type").value = vehicle.body_type || "Other";
  document.getElementById("job-make").value = vehicle.make || "";
  document.getElementById("job-model").value = vehicle.model || "";
  document.getElementById("job-year").value = vehicle.year || "";
  document.getElementById("job-chassis").value = vehicle.chassis_number || "";
  document.getElementById("job-engine").value = vehicle.engine_number || "";
}

function populateVehicleOptions(customerId) {
  const vehicles = customerVehiclesMap[customerId] || [];
  if (!vehicles.length) {
    jobPlateSelect.innerHTML = `<option value="">No vehicles registered — add one via the Customers page</option>`;
    jobPlateSelect.disabled = true;
    clearVehicleFields();
    return;
  }
  jobPlateSelect.disabled = false;
  jobPlateSelect.innerHTML = vehicles.map(v => {
    const label = [v.make, v.model].filter(Boolean).join(" ");
    return `<option value="${v.id}">${escapeHtml(v.license_plate)}${label ? ` — ${escapeHtml(label)}` : ""}</option>`;
  }).join("");
  autofillVehicleFields(vehicles[0]);
}

customerSelect.addEventListener("change", () => populateVehicleOptions(customerSelect.value));
jobPlateSelect.addEventListener("change", () => {
  const vehicles = customerVehiclesMap[customerSelect.value] || [];
  autofillVehicleFields(vehicles.find(v => v.id === jobPlateSelect.value));
});

let mechanicsList = []; // [{ id, full_name, busyWith: label | null }]

async function refreshBusyMechanics() {
  const { data: busyJobs } = await supabase.from("repair_jobs").select("technician_id, cro_number, job_number").not("technician_id", "is", null).not("status", "in", '("Ready for Pickup","Unclaimed","Collected")');
  const busyMap = Object.fromEntries((busyJobs || []).map(j => [j.technician_id, j.cro_number || `Job #${String(j.job_number).padStart(4, "0")}`]));
  mechanicsList = mechanicsList.map(m => ({ ...m, busyWith: busyMap[m.id] || null }));
}

async function loadTechniciansIntoSelect() {
  // Only mechanics show up here — this table now holds every employee
  // (sales, admin, etc.), and a repair job can only be assigned to
  // someone who actually works on cars. Uses technician_directory (not
  // the technicians table directly) since that table is now admin-only
  // at the database level — this view is the safe, name-only subset
  // every logged-in staff member is still allowed to read.
  const { data: mechanics, error } = await supabase.from("technician_directory").select("id, full_name").eq("department", "Mechanics").eq("is_active", true).order("full_name");
  if (error) { console.error("Error loading technicians:", error); return; }

  mechanicsList = (mechanics || []).map(m => ({ ...m, busyWith: null }));
  await refreshBusyMechanics();
  refreshTechnicianOptions(null);

  const mechanicFilter = document.getElementById("jobs-filter-mechanic");
  if (mechanicFilter) {
    mechanicFilter.innerHTML = `<option value="">All Mechanics</option>` + mechanicsList.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)}</option>`).join("");
  }
}

// Rebuilds the dropdown's options every time the modal opens, since
// whether a given mechanic is "busy" depends on context — a mechanic
// busy with THIS job specifically isn't actually unavailable, they're
// just already on it.
function refreshTechnicianOptions(currentJobTechnicianId) {
  editTechnician.innerHTML =
    `<option value="">Unassigned</option>` +
    mechanicsList.map(m => {
      const isBusyElsewhere = m.busyWith && m.id !== currentJobTechnicianId;
      const label = isBusyElsewhere ? `${m.full_name} — Busy (${m.busyWith})` : m.full_name;
      return `<option value="${m.id}" ${isBusyElsewhere ? "disabled" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
  if (currentJobTechnicianId) editTechnician.value = currentJobTechnicianId;
}

async function loadPartsIntoSelect() {
  if (!jobPartSelect) return;
  const { data, error } = await supabase
    .from("parts")
    .select("id, name, selling_price, quantity_in_stock")
    .order("name");
  if (error) { console.error("Error loading parts:", error); return; }

  jobPartSelect.innerHTML = (data || []).map(p =>
    `<option value="${p.id}" data-price="${p.selling_price}" data-stock="${p.quantity_in_stock}" ${Number(p.quantity_in_stock) < 1 ? "disabled" : ""}>
      ${escapeHtml(p.name)} — $${Number(p.selling_price).toFixed(2)} (${p.quantity_in_stock} in stock)
    </option>`
  ).join("");
}

async function loadJobParts(jobId) {
  if (!jobPartsList) return;
  const { data, error } = await supabase
    .from("job_parts")
    .select("id, part_name, quantity, price_at_time")
    .eq("job_id", jobId);
  if (error) { console.error("Error loading job parts:", error); return; }

  if (!data || data.length === 0) {
    jobPartsList.innerHTML = `<div style="color:var(--text-muted)">No parts added yet</div>`;
    await recalcPartsCost(jobId);
    return;
  }

  jobPartsList.innerHTML = data.map(jp => `
    <div class="part-row" style="justify-content:space-between; padding:4px 0;" data-jp-id="${jp.id}">
      <span>${escapeHtml(jp.part_name)} × ${jp.quantity} — $${(jp.price_at_time * jp.quantity).toFixed(2)}</span>
      <button type="button" class="btn remove-job-part-btn" data-jp-id="${jp.id}">✕</button>
    </div>
  `).join("");

  document.querySelectorAll(".remove-job-part-btn").forEach(btn => {
    btn.addEventListener("click", () => removeJobPart(btn.dataset.jpId, jobId));
  });
  applyCollectedLock(currentEditJob?.status === TERMINAL_STATUS);

  await recalcPartsCost(jobId);
}

async function recalcPartsCost(jobId) {
  const { data } = await supabase.from("job_parts").select("quantity, price_at_time").eq("job_id", jobId);
  const total = (data || []).reduce((sum, jp) => sum + jp.quantity * jp.price_at_time, 0);
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

if (jobPartAddBtn) {
  jobPartAddBtn.addEventListener("click", async () => {
    if (!currentEditJobId) return;
    if (currentEditJob?.status === TERMINAL_STATUS) {
      alert("This vehicle has been collected. Parts can no longer be changed.");
      return;
    }
    const partId = jobPartSelect.value;
    const opt = jobPartSelect.options[jobPartSelect.selectedIndex];
    const qty = parseInt(jobPartQty.value) || 1;
    const price = parseFloat(opt?.dataset.price || 0);

    if (!partId) { alert("Select a part first."); return; }
    if (!Number.isInteger(qty) || qty < 1) { alert("Enter a valid quantity."); return; }

    const { data: stockConsumed, error: stockError } = await supabase.rpc("consume_part_stock", {
      p_part_id: partId,
      p_quantity: qty,
    });
    if (stockError) { alert("Unable to reserve this part: " + stockError.message); return; }
    if (!stockConsumed) { alert("That part is out of stock or does not have enough units available."); return; }

    const { error: insertError } = await supabase.from("job_parts").insert([{
      job_id: currentEditJobId,
      part_id: partId,
      part_name: opt.textContent.split(" — ")[0].trim(),
      quantity: qty,
      price_at_time: price,
    }]);
    if (insertError) {
      await supabase.rpc("restore_part_stock", { p_part_id: partId, p_quantity: qty });
      alert("Failed to add part: " + insertError.message);
      return;
    }
    jobPartQty.value = 1;
    await loadJobParts(currentEditJobId);
    await loadPartsIntoSelect();
  });
}

async function loadJobIncidentals(jobId) {
  const list = document.getElementById("incidentals-list");
  if (!list) return;
  const { data, error } = await supabase.from("job_incidentals").select("id, description, amount").eq("job_id", jobId).order("created_at");
  if (error) { console.error("Error loading incidentals:", error); return; }

  if (!data || data.length === 0) {
    list.innerHTML = `<div style="color:var(--text-muted)">None added yet</div>`;
  } else {
    list.innerHTML = data.map(inc => `
      <div class="part-row" style="justify-content:space-between; padding:4px 0;" data-inc-id="${inc.id}">
        <span>${escapeHtml(inc.description)} — $${Number(inc.amount).toFixed(2)}</span>
        <button type="button" class="btn remove-incidental-btn" data-inc-id="${inc.id}">✕</button>
      </div>
    `).join("");
    list.querySelectorAll(".remove-incidental-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await supabase.from("job_incidentals").delete().eq("id", btn.dataset.incId);
        await loadJobIncidentals(jobId);
      });
    });
  }

  const total = (data || []).reduce((sum, inc) => sum + Number(inc.amount), 0);
  await supabase.from("repair_jobs").update({ incidentals_cost: total }).eq("id", jobId);
}

const incidentalAddBtn = document.getElementById("incidental-add");
if (incidentalAddBtn) {
  incidentalAddBtn.addEventListener("click", async () => {
    if (!currentEditJobId) return;
    if (currentEditJob?.status === TERMINAL_STATUS) {
      alert("This vehicle has been collected. Incidentals can no longer be changed.");
      return;
    }
    const description = document.getElementById("incidental-desc").value.trim();
    const amount = parseFloat(document.getElementById("incidental-amount").value);
    if (!description || !amount || amount <= 0) { alert("Enter a description and a valid amount."); return; }

    const { error } = await supabase.from("job_incidentals").insert([{ job_id: currentEditJobId, description, amount }]);
    if (error) { alert("Failed to add incidental: " + error.message); return; }

    document.getElementById("incidental-desc").value = "";
    document.getElementById("incidental-amount").value = "";
    await loadJobIncidentals(currentEditJobId);
  });
}

function initStatusOptions() {
  editStatus.innerHTML = STATUS_LIST.map(s => `<option value="${s}">${s}</option>`).join("");
}

async function loadJobs() {
  // technicians is no longer embeddable here now that it's admin-only at
  // the database level (Phase 0 security) — instead, pull names from
  // technician_directory (the safe, no-salary view) separately and match
  // them up client-side by technician_id.
  const [{ data, error }, { data: techs }] = await Promise.all([
    supabase.from("repair_jobs").select(`
      id, job_number, cro_number, portal_token, vehicle_id, fault_reported, diagnosis, diagnosis_eta, status, labour_cost, labour_hours, rate_tier_id, parts_cost, total_cost, technician_id, ready_at, collected_at,
      customers ( full_name, phone, email, customer_type ),
      vehicles ( make, model, year, license_plate, engine_number )
    `).order("created_at", { ascending: false }),
    supabase.from("technician_directory").select("id, full_name"),
  ]);
  const techNames = Object.fromEntries((techs || []).map(t => [t.id, t.full_name]));

  if (error) {
    console.error("Error loading repair jobs:", error);
    tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--danger)">Failed to load jobs: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="color:var(--text-muted)">No repair jobs yet</td></tr>`;
    return;
  }

  tableBody.innerHTML = data.map(job => {
    const meta = STATUS_META[job.status] || { cls: "", icon: "circle" };
    const vehicleLabel = [job.vehicles?.year, job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" ")
      + (job.vehicles?.license_plate ? ` (${job.vehicles.license_plate})` : "");
    const isCompany = job.customers?.customer_type === "company";
    const customerLabel = escapeHtml(job.customers?.full_name ?? "—")
      + (isCompany ? ` <span style="font-size:.7rem; padding:1px 6px; border-radius:999px; background:rgba(0,0,0,.08); color:var(--text-muted);">Company</span>` : "");
    return `
      <tr data-job-id="${job.id}">
        <td>${escapeHtml(job.cro_number || `#${String(job.job_number).padStart(4, "0")}`)}</td>
        <td>${customerLabel}</td>
        <td>${escapeHtml(vehicleLabel)}</td>
        <td>${escapeHtml(job.fault_reported)}</td>
        <td><span class="badge ${meta.cls}"><i data-lucide="${meta.icon}"></i> ${job.status}</span></td>
        <td>${escapeHtml(techNames[job.technician_id] ?? "Unassigned")}</td>
        <td>$${Number(job.total_cost ?? 0).toFixed(2)}</td>
        <td><button class="btn edit-job-btn" data-job='${JSON.stringify(job).replace(/'/g, "&apos;")}'><i data-lucide="eye"></i> View Details</button></td>
      </tr>
    `;
  }).join("");

  if (window.lucide) lucide.createIcons();

  document.querySelectorAll(".edit-job-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const job = JSON.parse(btn.dataset.job);
      openEditModal(job);
    });
  });
}

// ---- Live pickup countdown / parking fee ----
// Purely date-math off ready_at, independent of whatever the status field
// says — so it works whether the job is "Ready for Pickup" or already
// flagged "Unclaimed", and stops the moment collected_at is set.
function renderPickupCountdown(job) {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  if (!pickupCountdownBlock || !pickupCountdownDisplay) return;

  const eligible = job.ready_at && !job.collected_at && ["Ready for Pickup", "Unclaimed"].includes(job.status);
  if (!eligible) {
    pickupCountdownBlock.classList.add("hidden");
    if (applyParkingFeeBtn) applyParkingFeeBtn.classList.add("hidden");
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
      if (applyParkingFeeBtn) applyParkingFeeBtn.classList.add("hidden");
    } else {
      const overdueDays = Math.floor(-remaining / 86400000) + 1;
      const fee = overdueDays * PARKING_FEE_PER_DAY;
      pickupCountdownDisplay.innerHTML = `<strong style="color:var(--danger)">Overdue ${overdueDays} day${overdueDays === 1 ? "" : "s"} — parking fee: $${fee.toFixed(2)}</strong>`;
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

async function openEditModal(job) {
  currentEditJobId = job.id;
  currentEditJob = job;
  pendingCollection = false;
  editJobNumber.textContent = job.cro_number || String(job.job_number).padStart(4, "0");
  editStatus.value = job.status;
  editDiagnosis.value = job.diagnosis ?? "";
  editDiagnosisEta.value = toDatetimeLocalValue(job.diagnosis_eta);
  editLabour.value = job.labour_cost ?? 0;
  editParts.value = job.parts_cost ?? 0;
  editTechnician.value = job.technician_id ?? "";
  await refreshBusyMechanics();
  refreshTechnicianOptions(job.technician_id || null);
  editHours.value = job.labour_hours ?? "";
  const detectedTier = job.rate_tier_id ? rateTiers.find(t => t.id === job.rate_tier_id) : detectTierForMake(job.vehicles?.make);
  if (editRateTier) editRateTier.value = detectedTier?.id || "";

  const alreadyCollected = job.status === TERMINAL_STATUS;
  applyCollectedLock(alreadyCollected);
  updateWhatsappButton(job);
  if (editQuoteLink) editQuoteLink.href = `quotations.html?job=${encodeURIComponent(job.id)}`;
  if (editReceiptLink) {
    editReceiptLink.href = `receipts.html?job=${encodeURIComponent(job.id)}`;
    editReceiptLink.classList.toggle("hidden", job.status !== "Ready for Pickup");
  }
  updateZigDisplay();
  loadJobParts(job.id);
  loadJobIncidentals(job.id);
  loadPartsIntoSelect();

  if (editCollectionFields) editCollectionFields.classList.toggle("hidden", !alreadyCollected);
  const pickedUpByField = document.getElementById("picked-up-by-field");
  if (pickedUpByField) pickedUpByField.classList.toggle("hidden", job.customers?.customer_type !== "company");
  if (editMarkCollectedBtn) {
    editMarkCollectedBtn.classList.toggle("hidden", !["Ready for Pickup", "Unclaimed"].includes(job.status));
    editMarkCollectedBtn.innerHTML = '<i data-lucide="check-check"></i> Mark as Collected';
  }
  renderPickupCountdown(job);

  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

function applyCollectedLock(isCollected) {
  [editStatus, editDiagnosis, editLabour, editParts, editTechnician, editOdometer, editCollectionNotes, jobPartSelect, jobPartQty, jobPartAddBtn, editHours, editRateTier].forEach(element => {
    if (element) element.disabled = isCollected;
  });
  const incidentalDesc = document.getElementById("incidental-desc");
  const incidentalAmount = document.getElementById("incidental-amount");
  [incidentalDesc, incidentalAmount, incidentalAddBtn].forEach(element => {
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

if (editCancelBtn) editCancelBtn.addEventListener("click", closeEditModal);
if (editStatus) {
  editStatus.addEventListener("change", () => {
    if (!currentEditJob) return;
    updateWhatsappButton({ ...currentEditJob, status: editStatus.value });
  });
}
if (modal) {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeEditModal();
  });
}

if (editSaveBtn) {
  editSaveBtn.addEventListener("click", async () => {
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
      technician_id: editTechnician.value || null
    };

    // "Ready for Pickup" absorbed the old "Completed" status, and a job
    // marked "Unclaimed" is by definition also already finished — both are
    // treated as "the job is done" for billing/receipt purposes.
    // IMPORTANT: only set ready_at/completed_at the FIRST time a job enters
    // one of these states — previously this ran on every single Save while
    // already in "Ready for Pickup", resetting the 7-day countdown back to
    // zero on every unrelated edit (e.g. just tweaking labour cost).
    const isNowReadyOrUnclaimed = ["Ready for Pickup", "Unclaimed"].includes(status);
    if (isNowReadyOrUnclaimed && !currentEditJob?.ready_at) {
      updates.ready_at = new Date().toISOString();
    }
    if (isNowReadyOrUnclaimed && !currentEditJob?.completed_at) {
      updates.completed_at = new Date().toISOString();
    }

    const { data: updatedRows, error } = await supabase
      .from("repair_jobs")
      .update(updates)
      .eq("id", currentEditJobId)
      .select();

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
  });
}

// ---- Mark as Collected ----
// A one-way, record-keeping action rather than a routine status change —
// two clicks: first reveals the odometer/notes fields, second confirms and
// actually closes the job out.
if (editMarkCollectedBtn) {
  editMarkCollectedBtn.addEventListener("click", async () => {
    if (!currentEditJobId) return;

    if (!pendingCollection) {
      pendingCollection = true;
      if (editCollectionFields) editCollectionFields.classList.remove("hidden");
      editMarkCollectedBtn.innerHTML = '<i data-lucide="check-check"></i> Confirm Collection';
      if (window.lucide) lucide.createIcons();
      return;
    }

    const { data: updatedRows, error } = await supabase
      .from("repair_jobs")
      .update({
        status: "Collected",
        collected_at: new Date().toISOString(),
        picked_up_by: document.getElementById("edit-picked-up-by")?.value.trim() || null,
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
        .update({
          odometer_out: parseInt(editOdometer.value) || null,
          collection_notes: editCollectionNotes.value.trim() || null,
        })
        .eq("id", currentEditJob.vehicle_id);
      if (vehicleUpdateError) console.error("Error updating vehicle on collection:", vehicleUpdateError);
    }

    pendingCollection = false;
    closeEditModal();
    loadJobs();
  });
}

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
  const { data: existing, error: checkError } = await supabase
    .from("receipts")
    .select("id")
    .eq("repair_job_id", jobId)
    .limit(1);

  if (checkError) {
    console.error("Error checking for existing receipt:", checkError);
    return;
  }
  if (existing && existing.length > 0) return;

  const { error: insertError } = await supabase
    .from("receipts")
    .insert([{ repair_job_id: jobId, amount }]);

  if (insertError) console.error("Error auto-creating receipt:", insertError);
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const customer_id = customerSelect.value;
    const vehicle_id = jobPlateSelect.value;
    const body_type = document.getElementById("job-body-type").value;
    const make = document.getElementById("job-make").value.trim();
    const model = document.getElementById("job-model").value.trim();
    const year = parseInt(document.getElementById("job-year").value) || null;
    const chassis_number = document.getElementById("job-chassis").value.trim();
    const engine_number = document.getElementById("job-engine").value.trim();
    const fuel_level_in = document.getElementById("job-fuel-in").value || null;
    const odometer_in = parseInt(document.getElementById("job-odometer-in").value) || null;
    const fault_reported = document.getElementById("job-fault").value.trim();

    if (!customer_id || !vehicle_id) {
      alert("Select a customer and one of their registered vehicles. If this customer has no vehicles yet, add one via the Customers page first.");
      return;
    }
    if (!make || !fault_reported) {
      alert("Make and fault description are required.");
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

    const { error: jobError } = await supabase
      .from("repair_jobs")
      .insert([{ customer_id, vehicle_id, fault_reported, status: "Received", fuel_level_in, odometer_in }]);

    if (jobError) {
      console.error("Error creating repair job:", jobError);
      alert("Failed to create repair job: " + jobError.message);
      return;
    }

    form.reset();
    resetVehicleSelect();
    loadJobs();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Converts a stored ISO timestamp to the value a <input type="datetime-local">
// expects (local time, no timezone suffix), or "" if there's nothing stored.
function toDatetimeLocalValue(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---- AI-generated diagnosis update (WhatsApp / Email) ----
// Calls a Supabase Edge Function that holds the Anthropic API key
// server-side (never put an LLM API key in this file — see
// supabase/functions/generate-diagnosis-update). WhatsApp still opens a
// pre-filled wa.me link for staff to send themselves, same as elsewhere in
// this app; email opens the customer's own mail client via mailto:.
async function generateDiagnosisMessage(job, diagnosisText, eta) {
  const vehicleLabel = [job.vehicles?.year, job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" ");
  const { data, error } = await supabase.functions.invoke("generate-diagnosis-update", {
    body: {
      customerName: job.customers?.full_name || "there",
      jobNumber: job.job_number,
      vehicle: vehicleLabel,
      diagnosis: diagnosisText,
      eta: eta || null,
    },
  });
  if (error) throw error;
  if (!data?.message) throw new Error(data?.error || "No message returned.");
  return data.message;
}

async function sendDiagnosisUpdate(channel) {
  if (!currentEditJob) return;
  const diagnosisText = editDiagnosis.value.trim();
  if (!diagnosisText) {
    alert("Add diagnosis notes first — the update message is generated from them.");
    return;
  }

  const btn = channel === "whatsapp" ? editDiagnosisWhatsappBtn : editDiagnosisEmailBtn;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i data-lucide="loader-circle"></i> Generating…`;
  if (window.lucide) lucide.createIcons();

  try {
    const etaIso = editDiagnosisEta.value ? new Date(editDiagnosisEta.value).toISOString() : null;
    const message = await generateDiagnosisMessage(currentEditJob, diagnosisText, etaIso);

    if (channel === "whatsapp") {
      const phone = formatPhoneForWhatsApp(currentEditJob.customers?.phone);
      if (!phone) { alert("No phone number on file for this customer."); return; }
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
    } else {
      const email = (currentEditJob.customers?.email || "").trim() || prompt("Customer email address:");
      if (!email) return;
      const subject = encodeURIComponent(`Update on your repair — Job #${String(currentEditJob.job_number).padStart(4, "0")}`);
      window.open(`mailto:${email}?subject=${subject}&body=${encodeURIComponent(message)}`, "_blank");
    }
  } catch (err) {
    console.error("Failed to generate diagnosis update:", err);
    alert("Couldn't generate the update message: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (window.lucide) lucide.createIcons();
  }
}

if (editDiagnosisWhatsappBtn) editDiagnosisWhatsappBtn.addEventListener("click", () => sendDiagnosisUpdate("whatsapp"));
if (editDiagnosisEmailBtn) editDiagnosisEmailBtn.addEventListener("click", () => sendDiagnosisUpdate("email"));

function renderTiersTable() {
  const tbody = document.getElementById("tiers-table");
  if (!tbody) return;
  tbody.innerHTML = rateTiers.length ? rateTiers.map(t => `
    <tr>
      <td>${escapeHtml(t.tier_name)}</td>
      <td>$${Number(t.hourly_rate).toFixed(2)}/hr</td>
      <td>${(t.makes || []).length ? escapeHtml(t.makes.join(", ")) : `<span style="color:var(--text-muted);">Manual selection only</span>`}</td>
      <td>${t.is_default ? "✓" : ""}</td>
      <td><button type="button" class="btn delete-tier-btn" data-id="${t.id}"><i data-lucide="trash-2"></i></button></td>
    </tr>
  `).join("") : `<tr><td colspan="5" class="empty-state">No rate tiers yet</td></tr>`;
  if (window.lucide) lucide.createIcons();
  tbody.querySelectorAll(".delete-tier-btn").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("Delete this rate tier? Jobs that already used it keep their recorded rate — this only removes it from future selection.")) return;
    await supabase.from("vehicle_rate_tiers").delete().eq("id", btn.dataset.id);
    await loadRateTiers();
    renderTiersTable();
  }));
}

const tierForm = document.getElementById("tier-form");
if (tierForm) {
  tierForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tier_name = document.getElementById("tier-name").value.trim();
    const hourly_rate = parseFloat(document.getElementById("tier-rate").value);
    const makes = document.getElementById("tier-makes").value.split(",").map(m => m.trim()).filter(Boolean);
    const is_default = document.getElementById("tier-default").checked;
    const message = document.getElementById("tier-form-message");

    if (!tier_name || !hourly_rate) { message.textContent = "Tier name and rate are required."; message.dataset.tone = "error"; return; }

    if (is_default) {
      await supabase.from("vehicle_rate_tiers").update({ is_default: false }).eq("is_default", true);
    }

    const { error } = await supabase.from("vehicle_rate_tiers").insert([{ tier_name, hourly_rate, makes, is_default, sort_order: rateTiers.length + 1 }]);
    if (error) { message.textContent = "Failed to add tier: " + error.message; message.dataset.tone = "error"; return; }

    tierForm.reset();
    message.textContent = "Tier added."; message.dataset.tone = "success";
    await loadRateTiers();
    renderTiersTable();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  initStatusOptions();
  loadCustomersIntoSelect();
  loadTechniciansIntoSelect();
  loadPartsIntoSelect();
  await loadRateTiers();
  renderTiersTable();
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

function applyJobFilters() {
  const searchTerm = (document.getElementById("jobs-search")?.value || "").trim().toLowerCase();
  const mechanicId = document.getElementById("jobs-filter-mechanic")?.value || "";
  const typeFilter = document.getElementById("jobs-filter-type")?.value || "";

  document.querySelectorAll("#repairs-table tr[data-job-id]").forEach(row => {
    const jobJson = row.querySelector(".edit-job-btn")?.dataset.job;
    if (!jobJson) return;
    const job = JSON.parse(jobJson);

    let matches = true;

    if (searchTerm) {
      const haystack = [
        job.cro_number,
        job.customers?.full_name,
        job.vehicles?.engine_number,
        job.vehicles?.make,
        job.vehicles?.model,
      ].filter(Boolean).join(" ").toLowerCase();
      matches = matches && haystack.includes(searchTerm);
    }

    if (mechanicId) {
      matches = matches && job.technician_id === mechanicId;
    }

    if (typeFilter) {
      const isCompany = job.customers?.customer_type === "company";
      matches = matches && (typeFilter === "company" ? isCompany : !isCompany);
    }

    row.style.display = matches ? "" : "none";
  });
}

["jobs-search", "jobs-filter-mechanic", "jobs-filter-type"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", applyJobFilters);
  document.getElementById(id)?.addEventListener("change", applyJobFilters);
});

function filterTableByStatus(status) {
  document.querySelectorAll("#repairs-table tr").forEach(row => {
    const job = row.querySelector(".edit-job-btn")?.dataset.job;
    if (!job) return;
    const parsed = JSON.parse(job);
    let match = false;
    if (status === "active") match = !["Ready for Pickup", "Collected", "Unclaimed"].includes(parsed.status);
    else if (status === "completed-month") match = parsed.status === "Ready for Pickup";
    else match = parsed.status === status;
    row.style.display = match ? "" : "none";
  });
}