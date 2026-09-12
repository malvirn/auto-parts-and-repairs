// ========= Repair Jobs module =========
import supabase from "./supabaseClient.js";
import { STATUS_META, messageForStatus } from "./portalShared.js";

const tableBody = document.getElementById("repairs-table");
const form = document.getElementById("job-form");
const customerSelect = document.getElementById("job-customer");

const modal = document.getElementById("edit-modal");
const editJobNumber = document.getElementById("edit-job-number");
const editStatus = document.getElementById("edit-status");
const editDiagnosis = document.getElementById("edit-diagnosis");
const editLabour = document.getElementById("edit-labour");
const editParts = document.getElementById("edit-parts");
const editTechnician = document.getElementById("edit-technician");
const editSaveBtn = document.getElementById("edit-save");
const editCancelBtn = document.getElementById("edit-cancel");
const editWhatsappBtn = document.getElementById("edit-whatsapp");
const editPortalBtn = document.getElementById("edit-portal-link");
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

let currentEditJobId = null;
let currentEditJob = null;
let cachedRate = null;

const STATUS_LIST = [
  "Received", "Diagnosing", "Awaiting Parts", "In Repair",
  "Ready for Pickup", "Completed", "Collected", "Unclaimed"
];
const TERMINAL_STATUS = "Collected";

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

async function loadCustomersIntoSelect() {
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, vehicles(license_plate)")
    .order("full_name");

  if (error) { console.error("Error loading customers:", error); return; }

  customerSelect.innerHTML =
    `<option value="" disabled selected>Select a customer…</option>` +
    data.map(c => {
      const plates = (c.vehicles || []).map(v => v.license_plate).filter(Boolean).join(", ");
      return `<option value="${c.id}" data-plates="${escapeHtml(plates)}">${escapeHtml(c.full_name)}${plates ? ` (${escapeHtml(plates)})` : ""}</option>`;
    }).join("");
}

async function loadTechniciansIntoSelect() {
  const { data, error } = await supabase
    .from("technicians")
    .select("id, full_name")
    .order("full_name");

  if (error) { console.error("Error loading technicians:", error); return; }

  editTechnician.innerHTML =
    `<option value="">Unassigned</option>` +
    (data || []).map(t => `<option value="${t.id}">${escapeHtml(t.full_name)}</option>`).join("");
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

function initStatusOptions() {
  editStatus.innerHTML = STATUS_LIST.map(s => `<option value="${s}">${s}</option>`).join("");
}

async function loadJobs() {
  const { data, error } = await supabase
    .from("repair_jobs")
    .select(`
      id, job_number, portal_token, vehicle_id, fault_reported, diagnosis, status, labour_cost, parts_cost, total_cost, technician_id,
      customers ( full_name, phone, email ),
      vehicles ( make, model, year, license_plate ),
      technicians ( full_name )
    `)
    .order("created_at", { ascending: false });

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
    return `
      <tr data-job-id="${job.id}">
        <td>#${String(job.job_number).padStart(4, "0")}</td>
        <td>${escapeHtml(job.customers?.full_name ?? "—")}</td>
        <td>${escapeHtml(vehicleLabel)}</td>
        <td>${escapeHtml(job.fault_reported)}</td>
        <td><span class="badge ${meta.cls}"><i data-lucide="${meta.icon}"></i> ${job.status}</span></td>
        <td>${escapeHtml(job.technicians?.full_name ?? "Unassigned")}</td>
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

function openEditModal(job) {
  currentEditJobId = job.id;
  currentEditJob = job;
  editJobNumber.textContent = String(job.job_number).padStart(4, "0");
  editStatus.value = job.status;
  editDiagnosis.value = job.diagnosis ?? "";
  editLabour.value = job.labour_cost ?? 0;
  editParts.value = job.parts_cost ?? 0;
  editTechnician.value = job.technician_id ?? "";
  applyCollectedLock(job.status === TERMINAL_STATUS);
  updateWhatsappButton(job);
  if (editQuoteLink) editQuoteLink.href = `quotations.html?job=${encodeURIComponent(job.id)}`;
  if (editReceiptLink) {
    editReceiptLink.href = `receipts.html?job=${encodeURIComponent(job.id)}`;
    editReceiptLink.classList.toggle("hidden", job.status !== "Completed");
  }
  setupPortalLink(job);
  updateZigDisplay();
  loadJobParts(job.id);
  loadPartsIntoSelect();
  if (editCollectionFields) {
    editCollectionFields.classList.toggle("hidden", job.status !== "Collected");
  }
  modal.classList.remove("hidden");
}

function applyCollectedLock(isCollected) {
  [editStatus, editDiagnosis, editLabour, editParts, editTechnician, editOdometer, editCollectionNotes, jobPartSelect, jobPartQty, jobPartAddBtn].forEach(element => {
    if (element) element.disabled = isCollected;
  });
  document.querySelectorAll(".remove-job-part-btn").forEach(button => { button.disabled = isCollected; });
  if (editSaveBtn) editSaveBtn.disabled = isCollected;
  if (isCollected && editStatus) editStatus.value = TERMINAL_STATUS;
}

async function setupPortalLink(job) {
  if (!editPortalBtn) return;
  let token = job.portal_token;
  if (!token) {
    token = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const { error } = await supabase
      .from("repair_jobs")
      .update({ portal_token: token })
      .eq("id", job.id);
    if (error) {
      console.error("Error creating portal token:", error);
      editPortalBtn.disabled = true;
      return;
    }
    job.portal_token = token;
    if (currentEditJob?.id === job.id) currentEditJob.portal_token = token;
  }

  editPortalBtn.disabled = false;
  editPortalBtn.onclick = async () => {
    const portalUrl = new URL("../portal.html", window.location.href);
    portalUrl.searchParams.set("job", job.job_number);
    portalUrl.searchParams.set("token", token);
    try {
      await navigator.clipboard.writeText(portalUrl.href);
      editPortalBtn.innerHTML = '<i data-lucide="check"></i> Link Copied';
      if (window.lucide) lucide.createIcons();
      setTimeout(() => {
        editPortalBtn.innerHTML = '<i data-lucide="share-2"></i> Copy Portal Link';
        if (window.lucide) lucide.createIcons();
      }, 1800);
    } catch (error) {
      window.prompt("Copy this customer portal link:", portalUrl.href);
    }
  };
}

function closeEditModal() {
  modal.classList.add("hidden");
  currentEditJobId = null;
  currentEditJob = null;
  if (editWhatsappBtn) {
    editWhatsappBtn.classList.add("hidden");
    editWhatsappBtn.onclick = null;
  }
}

if (editCancelBtn) editCancelBtn.addEventListener("click", closeEditModal);
if (editStatus) {
  editStatus.addEventListener("change", () => {
    if (!currentEditJob) return;
    if (currentEditJob.status === TERMINAL_STATUS && editStatus.value !== TERMINAL_STATUS) {
      editStatus.value = TERMINAL_STATUS;
      alert("Collected vehicles are locked and cannot move back to earlier statuses.");
      return;
    }
    updateWhatsappButton({ ...currentEditJob, status: editStatus.value });
    if (editCollectionFields) {
      editCollectionFields.classList.toggle("hidden", editStatus.value !== "Collected");
    }
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
    if (currentEditJob?.status === TERMINAL_STATUS && status !== TERMINAL_STATUS) {
      alert("Collected vehicles are locked and cannot move back to earlier statuses.");
      return;
    }
    const labour_cost = parseFloat(editLabour.value) || 0;
    const parts_cost = parseFloat(editParts.value) || 0;

    const updates = {
      status,
      diagnosis: editDiagnosis.value.trim() || null,
      labour_cost,
      parts_cost,
      technician_id: editTechnician.value || null
    };

    if (status === "Ready for Pickup") updates.ready_at = new Date().toISOString();
    if (status === "Completed") updates.completed_at = new Date().toISOString();
    if (status === "Collected") updates.collected_at = new Date().toISOString();

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

    if (status === "Collected" && currentEditJob?.vehicle_id) {
      const { error: vehicleUpdateError } = await supabase
        .from("vehicles")
        .update({
          odometer_out: parseInt(editOdometer.value) || null,
          collection_notes: editCollectionNotes.value.trim() || null,
        })
        .eq("id", currentEditJob.vehicle_id);

      if (vehicleUpdateError) console.error("Error updating vehicle on collection:", vehicleUpdateError);
    }

    if (status === "Completed") {
      await ensureReceiptExists(currentEditJobId, labour_cost + parts_cost);
    }

    if (status === "Ready for Pickup" || status === "Completed") {
      await sendStatusEmail(currentEditJob, status, labour_cost + parts_cost);
    }

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
    const body_type = document.getElementById("job-body-type").value;
    const make = document.getElementById("job-make").value.trim();
    const model = document.getElementById("job-model").value.trim();
    const year = parseInt(document.getElementById("job-year").value) || null;
    const license_plate = document.getElementById("job-plate").value.trim();
    const vin = document.getElementById("job-vin").value.trim();
    const fault_reported = document.getElementById("job-fault").value.trim();

    if (!customer_id || !make || !fault_reported) {
      alert("Customer, make, and fault description are required.");
      return;
    }

    let vehicleData = null;
    if (license_plate) {
      const { data: existingVehicle, error: lookupError } = await supabase
        .from("vehicles")
        .select("id")
        .eq("customer_id", customer_id)
        .ilike("license_plate", license_plate)
        .maybeSingle();
      if (lookupError) console.error("Error checking existing vehicle:", lookupError);
      if (existingVehicle) {
        const { data: updatedVehicle, error: updateVehicleError } = await supabase
          .from("vehicles")
          .update({ body_type, make, model: model || null, year, vin: vin || null })
          .eq("id", existingVehicle.id)
          .select()
          .single();
        if (updateVehicleError) {
          console.error("Error updating vehicle:", updateVehicleError);
          alert("Failed to update vehicle: " + updateVehicleError.message);
          return;
        }
        vehicleData = updatedVehicle;
      }
    }

    if (!vehicleData) {
      const { data: newVehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .insert([{ customer_id, body_type, make, model: model || null, year, license_plate: license_plate || null, vin: vin || null }])
        .select()
        .single();

      if (vehicleError) {
        console.error("Error creating vehicle:", vehicleError);
        alert("Failed to save vehicle: " + vehicleError.message);
        return;
      }
      vehicleData = newVehicle;
    }

    const { error: jobError } = await supabase
      .from("repair_jobs")
      .insert([{ customer_id, vehicle_id: vehicleData.id, fault_reported, status: "Received" }]);

    if (jobError) {
      console.error("Error creating repair job:", jobError);
      alert("Failed to create repair job: " + jobError.message);
      return;
    }

    form.reset();
    loadJobs();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  initStatusOptions();
  loadCustomersIntoSelect();
  loadTechniciansIntoSelect();
  loadPartsIntoSelect();
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

function filterTableByStatus(status) {
  document.querySelectorAll("#repairs-table tr").forEach(row => {
    const job = row.querySelector(".edit-job-btn")?.dataset.job;
    if (!job) return;
    const parsed = JSON.parse(job);
    let match = false;
    if (status === "active") match = !["Completed", "Collected", "Unclaimed"].includes(parsed.status);
    else if (status === "completed-month") match = parsed.status === "Completed";
    else match = parsed.status === status;
    row.style.display = match ? "" : "none";
  });
}
