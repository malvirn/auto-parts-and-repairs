// ========= Receipts module =========
import supabase from "./supabaseClient.js";

const SHOP_NAME = "Auto Parts and Repairs";
const SHOP_TAGLINE = "Vehicle Sales, Parts &amp; Repairs";
const SHOP_LOGO_PATH = "../assets/logo.png"; // same file already used in the sidebar

const pendingTableBody = document.getElementById("pending-receipts-table");
const receiptsTableBody = document.getElementById("receipts-table");
const receiptModal = document.getElementById("receipt-modal");
const receiptDocument = document.getElementById("receipt-document");
const receiptWhatsappBtn = document.getElementById("receipt-whatsapp");
const receiptEmailBtn = document.getElementById("receipt-email");

// Set whenever a receipt is rendered, so the send buttons know who/what
// they're sending without re-querying the database.
let currentReceipt = null; // { receiptNumber, jobNumber, customer }

function formatPhoneForWhatsApp(raw) {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  return digits;
}

function renderReceipt(receipt) {
  const job = receipt.repair_jobs;
  const customer = job?.customers;
  const vehicle = job?.vehicles;
  const parts = receipt.parts || [];
  const partsTotal = parts.reduce((sum, part) => sum + Number(part.quantity) * Number(part.price_at_time), 0);
  const labour = Number(job?.labour_cost || 0);
  const total = Number(receipt.amount || partsTotal + labour);

  currentReceipt = {
    receiptNumber: receipt.receipt_number,
    jobNumber: job?.job_number,
    customer,
  };

  receiptDocument.innerHTML = `
    <header class="receipt-header">
      <div class="receipt-brand">
        <img src="${SHOP_LOGO_PATH}" alt="${SHOP_NAME}" class="receipt-logo" />
        <div class="receipt-address">${SHOP_NAME}<br>${SHOP_TAGLINE}</div>
      </div>
      <div class="receipt-meta"><strong>RECEIPT #${String(receipt.receipt_number).padStart(4, "0")}</strong>${new Date(receipt.issued_at).toLocaleDateString()}</div>
    </header>
    <h3>Customer</h3><div class="receipt-customer">${escapeHtml(customer?.full_name || "—")}<br>${escapeHtml(customer?.phone || "—")}</div>
    <h3>Repair &amp; Vehicle</h3><div class="receipt-customer">Job #${String(job?.job_number || "").padStart(4, "0")} · ${escapeHtml([vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "Vehicle")}<br>Plate: ${escapeHtml(vehicle?.license_plate || "—")}<br>Status: ${escapeHtml(job?.status || "Ready for Pickup")}</div>
    <h3>Items</h3><table><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Subtotal</th></tr></thead><tbody>${parts.map(part => `<tr><td>${escapeHtml(part.part_name)}</td><td>${part.quantity}</td><td>$${Number(part.price_at_time).toFixed(2)}</td><td>$${(Number(part.quantity) * Number(part.price_at_time)).toFixed(2)}</td></tr>`).join("") || `<tr><td colspan="4">No parts recorded</td></tr>`}<tr><td>Labour</td><td>1</td><td>$${labour.toFixed(2)}</td><td>$${labour.toFixed(2)}</td></tr></tbody></table>
    <div class="receipt-total"><span>Total USD</span><strong>$${total.toFixed(2)}</strong></div>
    <p class="receipt-note">Thank you for choosing ${SHOP_NAME}. Please retain this receipt for your records.</p>`;
  receiptModal.classList.remove("hidden");
  receiptModal.style.display = "flex";
  if (window.lucide) lucide.createIcons();
}

async function openReceiptForJob(jobId) {
  const { data, error } = await supabase
    .from("receipts")
    .select(`id, receipt_number, amount, issued_at, repair_jobs(job_number, status, labour_cost, customers(full_name, phone, email), vehicles(year, make, model, license_plate), job_parts(part_name, quantity, price_at_time))`)
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
  // "Ready for Pickup" and "Unclaimed" both mean the job is finished
  // (Unclaimed just means it's been finished a while without being picked up).
  if (!["Ready for Pickup", "Unclaimed"].includes(job.status)) { alert("A receipt can only be generated once the job is marked Ready for Pickup."); return; }

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
    .in("status", ["Ready for Pickup", "Unclaimed"])
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
        customers ( full_name, phone, email ),
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

// ---- Share as a high-quality image (WhatsApp) ----
// wa.me can only pre-fill text, not attach a file (a WhatsApp platform
// restriction, not something a website can work around) — so this renders
// a high-resolution image of the receipt, downloads it, and opens the
// customer's chat with a short note. Staff attach the already-downloaded
// image with one extra tap.
async function captureReceiptImage() {
  if (typeof html2canvas !== "function") {
    throw new Error("html2canvas didn't load — check your internet connection and reload the page.");
  }
  return html2canvas(receiptDocument, {
    scale: 4, // high resolution for crisp WhatsApp/print quality
    backgroundColor: "#ffffff",
    useCORS: true,
  });
}

async function withButtonBusy(button, busyLabel, fn) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<i data-lucide="loader-circle"></i> ${busyLabel}`;
  if (window.lucide) lucide.createIcons();
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    if (window.lucide) lucide.createIcons();
  }
}

async function sendReceiptWhatsApp() {
  if (!currentReceipt || !receiptWhatsappBtn) return;
  const phone = formatPhoneForWhatsApp(currentReceipt.customer?.phone);
  if (!phone) { alert("No phone number on file for this customer."); return; }

  await withButtonBusy(receiptWhatsappBtn, "Preparing…", async () => {
    try {
      const canvas = await captureReceiptImage();
      const dataUrl = canvas.toDataURL("image/png", 1.0);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `receipt-${String(currentReceipt.receiptNumber).padStart(4, "0")}.png`;
      link.click();

      const text = `Hi ${currentReceipt.customer?.full_name || "there"}, here's your receipt for Job #${String(currentReceipt.jobNumber).padStart(4, "0")} from ${SHOP_NAME}. The receipt image just downloaded to this device — attach it here to send it through.`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
    } catch (err) {
      console.error("Failed to prepare receipt image:", err);
      alert("Couldn't prepare the receipt image: " + err.message);
    }
  });
}

async function sendReceiptEmail() {
  if (!currentReceipt || !receiptEmailBtn) return;
  const email = (currentReceipt.customer?.email || "").trim() || prompt("Customer email address:");
  if (!email) return;

  await withButtonBusy(receiptEmailBtn, "Sending…", async () => {
    try {
      const canvas = await captureReceiptImage();
      const base64 = canvas.toDataURL("image/png", 1.0).split(",")[1];

      const { error } = await supabase.functions.invoke("send-receipt-email", {
        body: {
          to: email,
          subject: `Your receipt from ${SHOP_NAME} — Job #${String(currentReceipt.jobNumber).padStart(4, "0")}`,
          imageBase64: base64,
          jobNumber: currentReceipt.jobNumber,
        },
      });
      if (error) throw error;
      alert("Receipt emailed to " + email);
    } catch (err) {
      console.error("Failed to email receipt:", err);
      alert("Couldn't email the receipt: " + err.message + "\n\nMake sure the send-receipt-email Edge Function is deployed with an email provider API key set.");
    }
  });
}

if (receiptWhatsappBtn) receiptWhatsappBtn.addEventListener("click", sendReceiptWhatsApp);
if (receiptEmailBtn) receiptEmailBtn.addEventListener("click", sendReceiptEmail);

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