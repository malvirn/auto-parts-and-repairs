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
const receiptBackBtn = document.getElementById("receipt-back");
const receiptOrigin = new URLSearchParams(window.location.search).get("from");

let currentReceipt = null; // { receiptNumber, referenceLabel, customer }
const receiptGenerationsInProgress = new Set();

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
      discount: Number(order.discount_usd || 0),
      paymentMethod: order.payment_method || "Not recorded",
      items: (order.sales_order_items || []).map(i => ({ part_name: i.part_name, quantity: i.quantity, price_at_time: i.unit_price_usd })),
      incidentals: [],
      aiNotes: null,
    };
  }
  return null;
}

async function renderReceipt(receipt) {
  const { data: business } = await supabase.from("business_settings").select("business_name, tagline, address, phone, email, hours, vat_number, vat_rate").eq("id", 1).maybeSingle();
  const biz = business || { business_name: SHOP_NAME, tagline: SHOP_TAGLINE, address: "", phone: "+263 71 690 5081", email: "", hours: "" };
  const source = normalizeReceiptSource(receipt);
  if (!source) {
    alert("This receipt isn't linked to a job card or sales order anymore — the underlying record was likely deleted after the receipt was issued.");
    return;
  }

  const items = source.items || [];
  const incidentals = source.incidentals || [];
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price_at_time || 0), 0);
  const incidentalsTotal = incidentals.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const subtotal = source.kind === "order" ? itemsTotal : source.total || itemsTotal + incidentalsTotal + source.labour;
  const discount = Math.min(Number(source.discount || 0), subtotal);
  const total = Math.max(subtotal - discount, 0);
  const amountPaid = Number(receipt.amount ?? total);
  const balanceDue = Math.max(total - amountPaid, 0);
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

  const paidInFull = balanceDue <= 0.005;
  receiptDocument.innerHTML = `
    <style>
      .centric-modal-receipt{background:#fff!important;color:#17212b!important;padding:24px;border:1px solid #cbd2d9;font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;width:100%;max-width:820px;margin:0 auto;overflow-wrap:anywhere}
      .centric-modal-receipt *{box-sizing:border-box}
      .centric-modal-receipt .cm-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;border-bottom:3px solid #b3392b;padding-bottom:14px}
      .centric-modal-receipt .cm-brand{font-size:22px;font-weight:900}.centric-modal-receipt .cm-brand small{display:block;color:#b3392b;font-size:12px}
      .centric-modal-receipt h1{font-size:22px;color:#b3392b;text-align:right;margin:0}
      .centric-modal-receipt .cm-meta,.centric-modal-receipt .cm-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
      .centric-modal-receipt .cm-box{border:1px solid #d6dadd;padding:12px}.centric-modal-receipt small{display:block;color:#626b73;text-transform:uppercase;font-size:10px;font-weight:800;letter-spacing:.06em}
      .centric-modal-receipt .cm-box strong{display:block;margin-top:5px;color:#17212b!important;font-size:14px;line-height:1.45;overflow-wrap:anywhere}.centric-modal-receipt .cm-contact{display:grid;gap:5px;margin-top:9px;color:#17212b!important;font-size:13px;line-height:1.5}.centric-modal-receipt .cm-contact span{display:block;overflow-wrap:anywhere}.centric-modal-receipt .cm-contact b{color:#46515d;font-weight:800;margin-right:5px}.centric-modal-receipt .cm-brand-details{margin-top:8px;color:#34404b;font-size:12px;line-height:1.55}.centric-modal-receipt .cm-brand-details span{display:block;overflow-wrap:anywhere}
      .centric-modal-receipt table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
      .centric-modal-receipt th,.centric-modal-receipt td{padding:8px;border:1px solid #d6dadd;text-align:left}
      .centric-modal-receipt th{background:#eef0f2}.centric-modal-receipt .cm-amount{margin-top:14px;padding:16px;border:2px solid #b3392b;display:flex;justify-content:space-between;align-items:center}
      .centric-modal-receipt .cm-amount strong{font-size:24px;color:#b3392b}
      .centric-modal-receipt .cm-balance{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #d6dadd;font-weight:800}
      .centric-modal-receipt .cm-paid{display:inline-block;border:3px double #b3392b;color:#b3392b;padding:5px 12px;font-weight:900;transform:rotate(-5deg)}
      .centric-modal-receipt .cm-footer{text-align:center;border-top:1px solid #b3392b;margin-top:18px;padding-top:12px;color:#34404b!important;font-size:12px;line-height:1.65}.centric-modal-receipt .cm-footer strong{color:#17212b!important}
      @media(max-width:560px){.centric-modal-receipt{padding:13px!important;font-size:13px}.centric-modal-receipt .cm-meta,.centric-modal-receipt .cm-grid{grid-template-columns:1fr;gap:8px}.centric-modal-receipt .cm-head{align-items:flex-start}.centric-modal-receipt .cm-brand{font-size:20px}.centric-modal-receipt h1{font-size:17px;text-align:left}.centric-modal-receipt .cm-box{padding:11px}.centric-modal-receipt .cm-box strong{font-size:14px}.centric-modal-receipt table{font-size:11px;min-width:0}.centric-modal-receipt th,.centric-modal-receipt td{padding:6px 5px;overflow-wrap:anywhere}.centric-modal-receipt .cm-amount{gap:8px;padding:12px}.centric-modal-receipt .cm-amount strong{font-size:21px}}
      @media print{.centric-modal-receipt{border:0;padding:8mm}}
    </style>
    <article class="centric-modal-receipt">
      <header class="cm-head"><div><div class="cm-brand">${escapeHtml(biz.business_name || SHOP_NAME)}<small>${escapeHtml(biz.tagline || SHOP_TAGLINE)}</small></div><div class="cm-brand-details">${biz.address ? `<span>${escapeHtml(biz.address)}</span>` : ""}${biz.phone ? `<span>Phone: ${escapeHtml(biz.phone)}</span>` : ""}${biz.email ? `<span>Email: ${escapeHtml(biz.email)}</span>` : ""}${biz.hours ? `<span>${escapeHtml(biz.hours)}</span>` : ""}</div></div><h1>PAYMENT RECEIPT</h1></header>
      <div class="cm-meta">
        <div class="cm-box"><small>Receipt number</small><strong>${escapeHtml(String(receipt.receipt_number).padStart(7,"0"))}</strong></div>
        <div class="cm-box"><small>Date issued</small><strong>${issuedDate} · ${issuedTime}</strong></div>
        <div class="cm-box"><small>Payment method</small><strong>${escapeHtml(source.paymentMethod || "Not recorded")}</strong></div>
        <div class="cm-box"><small>Reference</small><strong>${escapeHtml(source.referenceLabel)}</strong></div>
      </div>
      <div class="cm-grid">
        <div class="cm-box"><small>Received from</small><strong>${escapeHtml(source.customer?.full_name || "Walk-in Customer")}</strong><div class="cm-contact">${source.customer?.phone ? `<span><b>Phone</b>${escapeHtml(source.customer.phone)}</span>` : ""}${source.customer?.email ? `<span><b>Email</b>${escapeHtml(source.customer.email)}</span>` : ""}${!source.customer?.phone && !source.customer?.email ? "<span>Contact details not recorded</span>" : ""}</div></div>
        <div class="cm-box"><small>Payment for</small><strong>${escapeHtml(source.vehicleLabel || (source.kind==="order"?"Parts / shop sale":"Vehicle service and repairs"))}</strong>${escapeHtml(source.plate || "")}</div>
      </div>
      <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${itemRows}</tbody></table>
      <div class="cm-amount"><b>Amount paid</b><strong>${formatMoney(amountPaid)}</strong></div>
      <div class="cm-balance"><span>Balance remaining</span><span>${formatMoney(balanceDue)}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px"><span style="font-size:11px;color:#626b73">${paidInFull?"Payment settled in full":"Part payment received"}</span><span class="cm-paid">${paidInFull?"PAID":"PART PAID"}</span></div>
      <div class="cm-footer"><strong>${escapeHtml(biz.business_name || SHOP_NAME)}</strong>${biz.phone ? ` · ${escapeHtml(biz.phone)}` : ""}${biz.email ? `<br>${escapeHtml(biz.email)}` : ""}<br>Thank you for your business.</div>
    </article>`;
  receiptModal.classList.remove("hidden");
  receiptModal.style.display = "flex";
  if (window.lucide) lucide.createIcons();
}

const RECEIPT_SELECT = `id, receipt_number, amount, issued_at,
  repair_jobs(id, job_number, cro_number, status, labour_cost, total_cost, ai_suggested_causes, customers(full_name, phone, email), vehicles(year, make, model, license_plate), job_parts(part_name, quantity, price_at_time), job_incidentals(description, amount)),
  sales_orders(id, order_number, total_usd, discount_usd, payment_method, status, walk_in_name, customers(full_name, phone, email), sales_order_items(part_name, quantity, unit_price_usd))`;

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
  if (!jobId || receiptGenerationsInProgress.has(jobId)) return;
  receiptGenerationsInProgress.add(jobId);
  try {
    const { data: job, error: jobError } = await supabase.from("repair_jobs").select("id, status, total_cost").eq("id", jobId).single();
    if (jobError || !job) { alert("Unable to load job card" + (jobError?.message ? `: ${jobError.message}` : ".")); return; }
    if (!["Ready for Pickup", "Unclaimed"].includes(job.status)) { alert("A receipt can only be generated once the job is marked Ready for Pickup."); return; }

    const { data: existing, error: checkError } = await supabase.from("receipts")
      .select("id")
      .eq("repair_job_id", jobId)
      .limit(1);
    if (checkError) {
      alert("Couldn't check for an existing receipt: " + checkError.message);
      return;
    }

    if (!existing?.length) {
      const { error } = await supabase.rpc("create_validated_receipt", { p_repair_job_id: jobId, p_sales_order_id: null, p_amount: Number(amount || job.total_cost || 0) });
      if (error && error.code !== "23505") {
        alert("Failed to generate receipt: " + error.message);
        return;
      }
    }

    await loadPendingReceipts();
    await loadAllReceipts();
    await openReceiptForJob(jobId);
  } finally {
    receiptGenerationsInProgress.delete(jobId);
  }
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

// html2canvas is only needed when sending a receipt, so it loads on demand
// instead of blocking the page <head> (a slow unpkg response used to freeze
// the whole receipts page before any script could run).
let html2canvasPromise = null;
function loadHtml2Canvas() {
  if (typeof html2canvas === "function") return Promise.resolve();
  if (html2canvasPromise) return html2canvasPromise;
  html2canvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    s.onload = resolve;
    s.onerror = () => {
      html2canvasPromise = null;
      reject(new Error("html2canvas didn't load — check your internet connection and try again."));
    };
    document.head.appendChild(s);
  });
  return html2canvasPromise;
}

async function captureReceiptImage() {
  await loadHtml2Canvas();
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
  const email = (currentReceipt.customer?.email || "").trim();
  if (!email) {
    window.aprToast?.("Customer email is missing", "error", "Add an email address to the customer record before sharing this receipt.");
    return;
  }

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
      window.aprToast?.("Receipt emailed", "success", email);
    } catch (err) {
      console.error("Failed to email receipt:", err);
      alert("Couldn't email the receipt: " + err.message + "\n\nMake sure the send-receipt-email Edge Function is deployed with an email provider API key set.");
    }
  });
}

if (receiptWhatsappBtn) receiptWhatsappBtn.addEventListener("click", sendReceiptWhatsApp);
if (receiptEmailBtn) receiptEmailBtn.addEventListener("click", sendReceiptEmail);
if (receiptBackBtn) receiptBackBtn.addEventListener("click", () => {
  if (receiptOrigin === "shop" || receiptOrigin === "repairs" || receiptOrigin === "quotations") {
    const page = `${receiptOrigin}.html`;
    const relativePath = window.location.pathname.includes("/pages/") ? page : `pages/${page}`;
    window.location.href = new URL(relativePath, window.location.href).href;
  } else {
    receiptModal?.classList.add("hidden");
    if (receiptModal) receiptModal.style.display = "none";
  }
});

document.addEventListener("DOMContentLoaded", () => {
  loadPendingReceipts();
  loadAllReceipts();
  const params = new URLSearchParams(window.location.search);
  const requestedJob = params.get("job");
  const requestedOrder = params.get("order");
  if (requestedJob) {
    setTimeout(() => {
      if (receiptOrigin === "repairs") openReceiptForJob(requestedJob);
      else generateReceipt(requestedJob);
    }, 250);
  } else if (requestedOrder) {
    setTimeout(() => openReceiptForOrder(requestedOrder), 250);
  }
});
document.getElementById("receipt-print")?.addEventListener("click", () => window.print());
document.getElementById("receipt-close")?.addEventListener("click", () => { receiptModal.classList.add("hidden"); receiptModal.style.display = "none"; });
