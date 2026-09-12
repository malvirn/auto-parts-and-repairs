// ========= Receipts module =========
import supabase from "./supabaseClient.js";

const pendingTableBody = document.getElementById("pending-receipts-table");
const receiptsTableBody = document.getElementById("receipts-table");
const receiptModal = document.getElementById("receipt-modal");
const receiptDocument = document.getElementById("receipt-document");

function renderReceipt(receipt) {
  const job = receipt.repair_jobs;
  const customer = job?.customers;
  const vehicle = job?.vehicles;
  const parts = receipt.parts || [];
  const partsTotal = parts.reduce((sum, part) => sum + Number(part.quantity) * Number(part.price_at_time), 0);
  const labour = Number(job?.labour_cost || 0);
  const total = Number(receipt.amount || partsTotal + labour);
  receiptDocument.innerHTML = `
    <header class="receipt-header">
      <div><h2>CRMS</h2><div class="receipt-address">Computer Repair Management System<br>Professional vehicle service</div></div>
      <div class="receipt-meta"><strong>RECEIPT #${String(receipt.receipt_number).padStart(4, "0")}</strong>${new Date(receipt.issued_at).toLocaleDateString()}</div>
    </header>
    <h3>Customer</h3><div class="receipt-customer">${escapeHtml(customer?.full_name || "—")}<br>${escapeHtml(customer?.phone || "—")}</div>
    <h3>Repair &amp; Vehicle</h3><div class="receipt-customer">Job #${String(job?.job_number || "").padStart(4, "0")} · ${escapeHtml([vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle")}<br>Plate: ${escapeHtml(vehicle?.license_plate || "—")}<br>Status: ${escapeHtml(job?.status || "Completed")}</div>
    <h3>Items</h3><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Subtotal</th></tr></thead><tbody>${parts.map(part => `<tr><td>${escapeHtml(part.part_name)}</td><td>${part.quantity}</td><td>$${Number(part.price_at_time).toFixed(2)}</td><td>$${(Number(part.quantity) * Number(part.price_at_time)).toFixed(2)}</td></tr>`).join("") || `<tr><td colspan="4">No parts recorded</td></tr>`}<tr><td>Labour</td><td>1</td><td>$${labour.toFixed(2)}</td><td>$${labour.toFixed(2)}</td></tr></tbody></table>
    <div class="receipt-total"><span>Total USD</span><strong>$${total.toFixed(2)}</strong></div>
    <p class="receipt-note">Thank you for choosing CRMS. Please retain this receipt for your records.</p>`;
  receiptModal.classList.remove("hidden");
  receiptModal.style.display = "flex";
  if (window.lucide) lucide.createIcons();
}

async function openReceiptForJob(jobId) {
  const { data, error } = await supabase
    .from("receipts")
    .select(`id, receipt_number, amount, issued_at, repair_jobs(job_number, status, labour_cost, customers(full_name, phone), vehicles(year, make, model, license_plate), job_parts(part_name, quantity, price_at_time))`)
    .eq("repair_job_id", jobId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) { alert("Unable to load receipt: " + error.message); return; }
  if (!data) { alert("No receipt found for this job."); return; }
  renderReceipt({ ...data, parts: data.repair_jobs?.job_parts || [] });
}

async function generateReceipt(jobId, amount) {
  const { data: job, error: jobError } = await supabase.from("repair_jobs").select("id, status, total_cost").eq("id", jobId).single();
  if (jobError || !job) { alert("Unable to load repair job."); return; }
  if (job.status !== "Completed") { alert("A receipt can only be generated for a completed repair job."); return; }

  const { error } = await supabase.from("receipts").insert([{ repair_job_id: jobId, amount: Number(amount || job.total_cost || 0) }]);

  if (error && error.code !== "23505") { // 23505 = unique_violation — a receipt already exists, which is fine
    alert("Failed to generate receipt: " + error.message);
    return;
  }

  await loadPendingReceipts();
  await loadAllReceipts();
  openReceiptForJob(jobId);
}

// ---- Load completed jobs that don't have a receipt yet ----
async function loadPendingReceipts() {
  const { data: jobs, error: jobsError } = await supabase
    .from("repair_jobs")
    .select(`
      id, job_number, total_cost,
      customers ( full_name )
    `)
    .eq("status", "Completed")
    .order("completed_at", { ascending: false });

  if (jobsError) {
    console.error("Error loading completed jobs:", jobsError);
    pendingTableBody.innerHTML = `<tr><td colspan="4" style="color:var(--danger)">Failed to load: ${jobsError.message}</td></tr>`;
    return;
  }

  const { data: receipts, error: receiptsError } = await supabase
    .from("receipts")
    .select("repair_job_id");

  if (receiptsError) {
    console.error("Error loading receipts:", receiptsError);
    pendingTableBody.innerHTML = `<tr><td colspan="4" style="color:var(--danger)">Failed to load: ${receiptsError.message}</td></tr>`;
    return;
  }

  const receiptedJobIds = new Set((receipts || []).map(r => r.repair_job_id));
  const pending = (jobs || []).filter(j => !receiptedJobIds.has(j.id));

  if (pending.length === 0) {
    pendingTableBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-muted)">No completed jobs awaiting a receipt</td></tr>`;
    return;
  }

  pendingTableBody.innerHTML = pending.map(job => `
    <tr>
      <td>#${String(job.job_number).padStart(4, "0")}</td>
      <td>${escapeHtml(job.customers?.full_name ?? "—")}</td>
      <td>$${Number(job.total_cost ?? 0).toFixed(2)}</td>
      <td><button class="btn generate-receipt-btn" data-job-id="${job.id}" data-amount="${job.total_cost ?? 0}"><i data-lucide="receipt"></i> Generate</button></td>
    </tr>
  `).join("");

  if (window.lucide) lucide.createIcons();

  document.querySelectorAll(".generate-receipt-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const jobId = btn.dataset.jobId;
      const amount = parseFloat(btn.dataset.amount) || 0;
      await generateReceipt(jobId, amount);
      btn.disabled = false;
    });
  });
}

// ---- Load all receipts ----
async function loadAllReceipts() {
  const { data, error } = await supabase
    .from("receipts")
    .select(`
      id, receipt_number, amount, issued_at,
      repair_jobs (
        id, status, labour_cost,
        job_number,
        customers ( full_name, phone ),
        vehicles ( year, make, model, license_plate ),
        job_parts ( part_name, quantity, price_at_time )
      )
    `)
    .order("issued_at", { ascending: false });

  if (error) {
    console.error("Error loading receipts:", error);
    receiptsTableBody.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">Failed to load receipts: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    receiptsTableBody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted)">No receipts yet</td></tr>`;
    return;
  }

  receiptsTableBody.innerHTML = data.map(r => `
    <tr>
      <td>#${String(r.receipt_number).padStart(4, "0")}</td>
      <td>#${String(r.repair_jobs?.job_number ?? "").padStart(4, "0")}</td>
      <td>${escapeHtml(r.repair_jobs?.customers?.full_name ?? "—")}</td>
      <td>$${Number(r.amount ?? 0).toFixed(2)}</td>
      <td>${new Date(r.issued_at).toLocaleDateString()}</td>
      <td><button type="button" class="btn view-receipt-btn" data-job-id="${r.repair_jobs?.id || ""}"><i data-lucide="eye"></i> View</button></td>
    </tr>
  `).join("");
  document.querySelectorAll(".view-receipt-btn").forEach(button => button.addEventListener("click", () => openReceiptForJob(button.dataset.jobId)));
  if (window.lucide) lucide.createIcons();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  loadPendingReceipts();
  loadAllReceipts();
  const requestedJob = new URLSearchParams(window.location.search).get("job");
  if (requestedJob) {
    setTimeout(() => generateReceipt(requestedJob), 250);
  }
});
document.getElementById("receipt-print")?.addEventListener("click", () => window.print());
document.getElementById("receipt-close")?.addEventListener("click", () => { receiptModal.classList.add("hidden"); receiptModal.style.display = "none"; });