// ========= Receipts module =========
import supabase from "./supabaseClient.js";

const SHOP_NAME = "Centric Automobile Service";
const SHOP_TAGLINE = "AUTO PARTS & REPAIRS";
const SHOP_LOGO_PATH = "../assets/logo.png";

const pendingTableBody = document.getElementById("pending-receipts-table");
const receiptsTableBody = document.getElementById("receipts-table");
const receiptModal = document.getElementById("receipt-modal");
const receiptDocument = document.getElementById("receipt-document");
const receiptWhatsappBtn = document.getElementById("receipt-whatsapp");
const receiptEmailBtn = document.getElementById("receipt-email");

let currentReceipt = null; // { receiptNumber, referenceLabel, customer }

function formatPhoneForWhatsApp(raw) {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  return digits;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// A receipt links to EITHER a repair job OR a sales order (Quick Sale,
// or a confirmed sale from Quotations) — never both. This normalizes
// whichever one is present into one common shape, so rendering doesn't
// need to know or care which source it came from. A receipt with
// neither present genuinely has no source left (the underlying record
// was deleted after the receipt was issued) — that's the only case
// that's actually "missing", not sales receipts in general.
function normalizeReceiptSource(receipt) {
  const job = receipt.repair_jobs;
  const order = receipt.sales_orders;

  if (job) {
    return {
      kind: "job",
      id: job.id,
      referenceLabel: job.cro_number || `Job #${String(job.job_number || "").padStart(4, "0")}`,
      customer: job.customers || null,
      vehicleLabel: [job.vehicles?.year, job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" "),
      plate: job.vehicles?.license_plate,
      status: job.status,
      labour: Number(job.labour_cost || 0),
      total: Number(job.total_cost || 0),
      items: job.job_parts || [],
      incidentals: job.job_incidentals || [],
      aiNotes: job.ai_suggested_causes,
    };
  }
  if (order) {
    return {
      kind: "order",
      id: order.id,
      referenceLabel: `Order #${String(order.order_number || "").padStart(4, "0")}`,
      customer: order.customers || (order.walk_in_name ? { full_name: order.walk_in_name } : null),
      vehicleLabel: "",
      plate: "",
      status: order.status,
      labour: 0,
      total: Number(order.total_usd || 0),
      items: (order.sales_order_items || []).map(i => ({ part_name: i.part_name, quantity: i.quantity, price_at_time: i.unit_price_usd })),
      incidentals: [],
      aiNotes: null,
    };
  }
  return null;
}

function renderReceipt(receipt) {
  const source = normalizeReceiptSource(receipt);
  if (!source) {
    alert("This receipt isn't linked to a job card or sales order anymore — the underlying record was likely deleted after the receipt was issued.");
    return;
  }

  const items = source.items || [];
  const incidentals = source.incidentals || [];
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price_at_time || 0), 0);
  const incidentalsTotal = incidentals.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const subtotal = source.total || itemsTotal + incidentalsTotal + source.labour;
  const amountPaid = Number(receipt.amount ?? subtotal);
  const balanceDue = Math.max(subtotal - amountPaid, 0);
  const formatMoney = amount => `$${Number(amount || 0).toFixed(2)}`;
  const issuedAt = new Date(receipt.issued_at);
  const issuedDate = Number.isNaN(issuedAt.getTime()) ? "—" : issuedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const issuedTime = Number.isNaN(issuedAt.getTime()) ? "—" : issuedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const itemRows = [
    ...items.map(item => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.price_at_time || 0);
      return `<tr><td>${escapeHtml(item.part_name || "Part")}</td><td>${quantity}</td><td>${formatMoney(unitPrice)}</td><td>${formatMoney(quantity * unitPrice)}</td></tr>`;
    }),
    ...incidentals.map(item => `<tr><td>${escapeHtml(item.description || "Incidental")}</td><td>1</td><td>${formatMoney(item.amount)}</td><td>${formatMoney(item.amount)}</td></tr>`),
    ...(source.labour > 0 ? [`<tr><td>Labour</td><td>1</td><td>${formatMoney(source.labour)}</td><td>${formatMoney(source.labour)}</td></tr>`] : []),
  ].join("") || `<tr><td colspan="4">No items recorded</td></tr>`;

  currentReceipt = {
    receiptNumber: receipt.receipt_number,
    referenceLabel: source.referenceLabel,
    customer: source.customer,
  };

  receiptDocument.innerHTML = `
    <header class="receipt-company">
      <img src="${SHOP_LOGO_PATH}" alt="Centric Automobile Service logo" class="receipt-logo" />
      <div class="receipt-company__details">
        <h2>${SHOP_NAME}</h2>
        <p>${SHOP_TAGLINE}</p>
        <p>No. 14387 Galloway, Norton</p>
        <p>+263 733 656 061</p>
        <p>+263 716 421 990</p>
      </div>
    </header>
    <h1 class="receipt-title">PAYMENT RECEIPT</h1>
    <dl class="receipt-meta">
      <div><dt>Receipt No</dt><dd>${String(receipt.receipt_number).padStart(7, "0")}</dd></div>
      <div><dt>Date of Issue</dt><dd>${issuedDate}</dd></div>
      <div><dt>Time of Issue</dt><dd>${issuedTime}</dd></div>
      <div><dt>Customer Name</dt><dd>${escapeHtml(source.customer?.full_name || "Walk-in Customer")}</dd></div>
      <div><dt>Contact</dt><dd>${escapeHtml(source.customer?.phone || "—")}</dd></div>
      ${source.kind === "job" ? `<div><dt>Vehicle Registration</dt><dd>${escapeHtml(source.plate || "—")}</dd></div>` : ""}
      <div><dt>${source.kind === "job" ? "Work Order No" : "Sales Order No"}</dt><dd>${escapeHtml(source.referenceLabel)}</dd></div>
      <div><dt>Payment Method</dt><dd>Not recorded</dd></div>
      <div><dt>Currency</dt><dd>USD</dd></div>
    </dl>
    <section class="receipt-items">
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
    </section>
    <section class="receipt-totals" aria-label="Receipt totals">
      <div><span>Subtotal</span><span>${formatMoney(subtotal)}</span></div>
      <div><span>Discount</span><span>${formatMoney(0)}</span></div>
      <div class="receipt-paid"><span>Amount Paid</span><span>${formatMoney(amountPaid)}</span></div>
      <div><span>Balance Due</span><span>${formatMoney(balanceDue)}</span></div>
      <div class="receipt-grand"><strong>TOTAL PAID</strong><strong>${formatMoney(amountPaid)}</strong></div>
    </section>
    <p class="receipt-note">Thank you for choosing Centric Automobile Service.<br>Please retain this receipt for your records.</p>
    <footer class="receipt-footer">
      <p class="receipt-footer__services">Centric Auto Mobile | Vehicle Diagnostics · Repairs · Servicing · Spare Parts</p>
      <p class="receipt-footer__copyright">© ${new Date().getFullYear()} Centric Automobile Service. All rights reserved.</p>
    </footer>`;
  receiptModal.classList.remove("hidden");
  receiptModal.style.display = "flex";
  if (window.lucide) lucide.createIcons();
}

const RECEIPT_SELECT = `id, receipt_number, amount, issued_at,
  repair_jobs(id, job_number, cro_number, status, labour_cost, total_cost, ai_suggested_causes, customers(full_name, phone, email), vehicles(year, make, model, license_plate), job_parts(part_name, quantity, price_at_time), job_incidentals(description, amount)),
  sales_orders(id, order_number, total_usd, status, walk_in_name, customers(full_name, phone, email), sales_order_items(part_name, quantity, unit_price_usd))`;

// jobId being missing/empty is exactly what was crashing this with
// "invalid input syntax" — Postgres refusing an empty string where a UUID
// belongs. Guarding here stops it before it ever reaches Supabase, and
// gives a real explanation instead of a raw database error.
async function openReceiptForJob(jobId) {
  if (!jobId) {
    alert("This receipt isn't linked to a job card anymore, so it can't be opened. This usually means the underlying job was deleted after the receipt was issued.");
    return;
  }
  const { data, error } = await supabase.from("receipts").select(RECEIPT_SELECT).eq("repair_job_id", jobId).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { alert("Unable to load receipt: " + error.message); return; }
  if (!data) { alert("No receipt found for this job."); return; }
  renderReceipt(data);
}

// The Sales Order equivalent of openReceiptForJob — used for Quick Sale
// receipts and confirmed Sales Order receipts, neither of which have a
// repair_job_id at all.
async function openReceiptForOrder(orderId) {
  if (!orderId) {
    alert("This receipt isn't linked to a sales order record anymore.");
    return;
  }
  const { data, error } = await supabase.from("receipts").select(RECEIPT_SELECT).eq("sales_order_id", orderId).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { alert("Unable to load receipt: " + error.message); return; }
  if (!data) { alert("No receipt found for this order."); return; }
  renderReceipt(data);
}

async function generateReceipt(jobId, amount) {
  if (!jobId) return; // guards the DOMContentLoaded ?job= path the same way
  const { data: job, error: jobError } = await supabase.from("repair_jobs").select("id, status, total_cost").eq("id", jobId).single();
  if (jobError || !job) { alert("Unable to load job card."); return; }
  if (!["Ready for Pickup", "Unclaimed"].includes(job.status)) { alert("A receipt can only be generated once the job is marked Ready for Pickup."); return; }

  const { error } = await supabase.from("receipts").insert([{ repair_job_id: jobId, amount: Number(amount || job.total_cost || 0) }]);

  if (error && error.code !== "23505") {
    alert("Failed to generate receipt: " + error.message);
    return;
  }

  await loadPendingReceipts();
  await loadAllReceipts();
  openReceiptForJob(jobId);
}

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

async function loadAllReceipts() {
  const { data, error } = await supabase.from("receipts").select(RECEIPT_SELECT).order("issued_at", { ascending: false });

  if (error) {
    console.error("Error loading receipts:", error);
    receiptsTableBody.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">Failed to load receipts: ${error.message}</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    receiptsTableBody.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted)">No receipts yet</td></tr>`;
    return;
  }

  // Only genuinely show "record missing" when NEITHER a repair job NOR a
  // sales order is attached — a sales receipt (Quick Sale or a confirmed
  // Sales Order) is a completely normal, valid receipt, just a different
  // source than a repair job.
  receiptsTableBody.innerHTML = data.map(r => {
    const source = normalizeReceiptSource(r);
    const viewAttr = source
      ? (source.kind === "job" ? `data-job-id="${source.id}"` : `data-order-id="${source.id}"`)
      : "";
    return `
    <tr>
      <td>#${String(r.receipt_number).padStart(4, "0")}</td>
      <td>${source ? escapeHtml(source.referenceLabel) : "—"}</td>
      <td>${escapeHtml(source?.customer?.full_name ?? "—")}</td>
      <td>$${Number(r.amount ?? 0).toFixed(2)}</td>
      <td>${new Date(r.issued_at).toLocaleDateString()}</td>
      <td>${source
        ? `<button type="button" class="btn view-receipt-btn" ${viewAttr}><i data-lucide="eye"></i> View</button>`
        : `<span style="color:var(--text-muted); font-size:.85rem;">Record missing</span>`}</td>
    </tr>
  `;
  }).join("");
  document.querySelectorAll(".view-receipt-btn").forEach(button => {
    button.addEventListener("click", () => {
      if (button.dataset.jobId) openReceiptForJob(button.dataset.jobId);
      else if (button.dataset.orderId) openReceiptForOrder(button.dataset.orderId);
    });
  });
  if (window.lucide) lucide.createIcons();
}

async function captureReceiptImage() {
  if (typeof html2canvas !== "function") {
    throw new Error("html2canvas didn't load — check your internet connection and reload the page.");
  }
  return html2canvas(receiptDocument, {
    scale: 4,
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

      const text = `Hi ${currentReceipt.customer?.full_name || "there"}, here's your receipt for ${currentReceipt.referenceLabel} from ${SHOP_NAME}. The receipt image just downloaded to this device — attach it here to send it through.`;
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
          subject: `Your receipt from ${SHOP_NAME} — ${currentReceipt.referenceLabel}`,
          imageBase64: base64,
          jobNumber: currentReceipt.referenceLabel,
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

document.addEventListener("DOMContentLoaded", () => {
  loadPendingReceipts();
  loadAllReceipts();
  const params = new URLSearchParams(window.location.search);
  const requestedJob = params.get("job");
  const requestedOrder = params.get("order");
  if (requestedJob) {
    setTimeout(() => generateReceipt(requestedJob), 250);
  } else if (requestedOrder) {
    setTimeout(() => openReceiptForOrder(requestedOrder), 250);
  }
});
document.getElementById("receipt-print")?.addEventListener("click", () => window.print());
document.getElementById("receipt-close")?.addEventListener("click", () => { receiptModal.classList.add("hidden"); receiptModal.style.display = "none"; });