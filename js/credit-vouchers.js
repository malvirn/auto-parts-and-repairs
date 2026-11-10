import supabase from "./supabaseClient.js";

let host = document.getElementById("credit-voucher-panel");
let list = document.getElementById("credit-voucher-list");
let search = document.getElementById("credit-voucher-search");
let statusFilter = document.getElementById("credit-voucher-status");
let refresh = document.getElementById("credit-voucher-refresh");
const tabButton = document.getElementById("credit-voucher-tab");
const notesTabButton = document.getElementById("credit-notes-tab");
let redeemCode = document.getElementById("voucher-redeem-code");
let redeemCheck = document.getElementById("voucher-redeem-check");
let redeemScan = document.getElementById("voucher-redeem-scan");
let redeemPreview = document.getElementById("voucher-redeem-preview");
let redeemTarget = document.getElementById("voucher-redeem-target");
let redeemAmount = document.getElementById("voucher-redeem-amount");
let redeemApply = document.getElementById("voucher-redeem-apply");
let redeemMessage = document.getElementById("voucher-redeem-message");
let redeemVideo = document.getElementById("voucher-redeem-video");
const notesPanel = document.getElementById("customer-credit-panel");
let launcher = null;
if (!host) {
  host = document.createElement("section");
  host.id = "credit-voucher-panel";
  host.hidden = true;
  host.className = "credit-voucher-overlay";
  host.innerHTML = '<header><div><small>CENTRIC AUTO MOBILE</small><h2>Customer Credit Vouchers</h2></div><button type="button" id="credit-voucher-close" aria-label="Close vouchers">×</button></header>' +
    '<div class="credit-voucher-overlay-tools"><input id="credit-voucher-search" type="search" placeholder="Search voucher code or customer"><select id="credit-voucher-status"><option value="">All statuses</option><option value="active">Active</option><option value="redeemed">Redeemed</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select><button id="credit-voucher-refresh" type="button">Refresh</button></div>' +
    '<section class="credit-voucher-redeem"><h3>Redeem a voucher</h3><p>Enter the code or scan its QR. Vouchers can be used against eligible outstanding balances.</p>' +
    '<div class="credit-voucher-code-entry"><input id="voucher-redeem-code" type="text" maxlength="11" placeholder="XXXXX-XXXXX"><button id="voucher-redeem-check" type="button">Check code</button><button id="voucher-redeem-scan" type="button">Scan QR</button></div>' +
    '<div id="voucher-redeem-preview" class="credit-voucher-preview" aria-live="polite"></div><label for="voucher-redeem-target">Apply to outstanding balance</label><select id="voucher-redeem-target" disabled><option value="">Check a voucher first</option></select>' +
    '<label for="voucher-redeem-amount">Amount to apply ($)</label><input id="voucher-redeem-amount" type="number" min="0.01" step="0.01" disabled placeholder="0.00"><button id="voucher-redeem-apply" type="button" disabled>Apply voucher</button><p id="voucher-redeem-message" role="status"></p><video id="voucher-redeem-video" playsinline muted hidden></video></section>' +
    '<div id="credit-voucher-list" aria-live="polite"></div>';
  document.body.append(host);
  launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "credit-voucher-launcher";
  launcher.textContent = "Redeem voucher";
  launcher.setAttribute("aria-label","Open customer credit vouchers");
  document.body.append(launcher);
  const style = document.createElement("style");
  style.textContent = '.credit-voucher-launcher{position:fixed;right:16px;bottom:86px;z-index:9990;padding:12px 17px;border:0;border-radius:28px;background:#f58220;color:#fff;font-weight:800;box-shadow:0 8px 24px #0004}.credit-voucher-overlay{position:fixed;z-index:9991;inset:4vh 3vw auto auto;width:min(720px,94vw);max-height:90vh;overflow:auto;padding:18px;border:1px solid #526174;border-radius:16px;background:#10181a;color:#eef3ef;box-shadow:0 18px 60px #0008}.credit-voucher-overlay[hidden]{display:none}.credit-voucher-overlay>header{display:flex;justify-content:space-between;align-items:center;gap:12px}.credit-voucher-overlay>header h2{margin:3px 0 12px}.credit-voucher-overlay>header button{font-size:25px;background:transparent;color:inherit;border:0}.credit-voucher-overlay-tools{display:grid;grid-template-columns:minmax(0,1fr) 140px auto;gap:8px;margin:12px 0}.credit-voucher-overlay input,.credit-voucher-overlay select{min-width:0;padding:10px;border:1px solid #53635a;border-radius:8px;background:#0c1210;color:inherit}.credit-voucher-overlay .credit-voucher-card{background:#14211b}.credit-voucher-overlay .credit-voucher-actions{display:flex;flex-wrap:wrap;gap:7px}.credit-voucher-overlay .credit-voucher-actions button,.credit-voucher-overlay-tools button{padding:9px;border-radius:8px}.credit-voucher-overlay .credit-voucher-redeem{display:grid;gap:9px;margin:12px 0;padding:14px;border:1px solid #40564a;border-radius:12px}.credit-voucher-overlay .credit-voucher-code-entry{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px}.credit-voucher-overlay .credit-voucher-redeem button{min-height:42px}.credit-voucher-overlay #voucher-redeem-apply{width:100%;background:#f58220;color:#fff;border:0;border-radius:8px;font-weight:800}.credit-voucher-overlay .credit-voucher-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.credit-voucher-overlay .credit-voucher-code{font-size:20px}.credit-voucher-overlay video{width:100%;max-height:230px;object-fit:cover}.credit-voucher-overlay .credit-voucher-history{margin-top:12px}.credit-voucher-overlay .credit-voucher-preview{padding:10px;border:1px solid #40564a;border-radius:8px}.credit-voucher-overlay .credit-voucher-expired-note{color:#fbbf24}@media(max-width:560px){.credit-voucher-overlay{inset:2vh 2vw auto;width:96vw;max-height:94vh;padding:12px}.credit-voucher-overlay-tools{grid-template-columns:1fr 1fr}.credit-voucher-overlay-tools input{grid-column:1/-1}.credit-voucher-overlay .credit-voucher-code-entry{grid-template-columns:1fr 1fr}.credit-voucher-overlay .credit-voucher-code-entry input{grid-column:1/-1}.credit-voucher-overlay .credit-voucher-facts{grid-template-columns:1fr 1fr}}';
  document.head.append(style);
  launcher.addEventListener("click", async () => {
    host.hidden = false;
    try { await load(); } catch (error) { list.textContent = error.message || String(error); }
  });
  host.querySelector("#credit-voucher-close").addEventListener("click", () => { host.hidden = true; stopScanner(); });
}
if (!host) throw new Error("Credit voucher panel is missing.");
list = list || host.querySelector("#credit-voucher-list");
if (!list) throw new Error("Credit voucher list is missing.");
search = search || host.querySelector("#credit-voucher-search");
statusFilter = statusFilter || host.querySelector("#credit-voucher-status");
refresh = refresh || host.querySelector("#credit-voucher-refresh");
redeemCode = redeemCode || host.querySelector("#voucher-redeem-code");
redeemCheck = redeemCheck || host.querySelector("#voucher-redeem-check");
redeemScan = redeemScan || host.querySelector("#voucher-redeem-scan");
redeemPreview = redeemPreview || host.querySelector("#voucher-redeem-preview");
redeemTarget = redeemTarget || host.querySelector("#voucher-redeem-target");
redeemAmount = redeemAmount || host.querySelector("#voucher-redeem-amount");
redeemApply = redeemApply || host.querySelector("#voucher-redeem-apply");
redeemMessage = redeemMessage || host.querySelector("#voucher-redeem-message");
redeemVideo = redeemVideo || host.querySelector("#voucher-redeem-video");
let checkedVoucher = null;
let redeemTargets = [];
let scannerStream = null;
let scannerActive = false;

const money = value => "$" + Number(value || 0).toFixed(2);
const esc = value => {
  const node = document.createElement("span");
  node.textContent = value ?? "";
  return node.innerHTML;
};
const dateLabel = value => value ? new Date(value + (String(value).length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-GB", {
  timeZone: "Africa/Harare", day: "2-digit", month: "short", year: "numeric",
}) : "—";
let vouchers = [];
let redemptions = [];
let terms = "Redeemable against eligible Centric Auto Mobile job cards, invoices and sales orders. Not redeemable for cash. Subject to available balance and expiry date.";
let qrPromise;

function setRedeemMessage(message, tone = "info") {
  if (!redeemMessage) return;
  redeemMessage.textContent = message;
  redeemMessage.dataset.tone = tone;
}

function targetLabel(row) {
  const type = row.source_type === "Repair job" ? "repair_job" : row.source_type === "Sales order" ? "sales_order" : "invoice";
  return { ...row, target_type: type, label: row.reference + " · due " + money(row.balance_due) };
}

async function loadRedeemTargets() {
  const { data, error } = await supabase.from("customer_account_statement")
    .select("customer_id,customer_name,source_id,source_type,reference,balance_due")
    .gt("balance_due", 0.005);
  if (error) throw error;
  redeemTargets = (data || []).filter(row => ["Repair job","Sales order","Invoice"].includes(row.source_type)).map(targetLabel);
  redeemTarget.innerHTML = '<option value="">Choose an outstanding balance…</option>' +
    redeemTargets.map(row => '<option value="' + esc(row.target_type + "|" + row.source_id) + '">' + esc(row.label) + '</option>').join("");
  redeemTarget.disabled = !redeemTargets.length || !checkedVoucher || checkedVoucher.status !== "active";
}

function updateRedeemAmount() {
  const [type,id] = (redeemTarget.value || "").split("|");
  const target = redeemTargets.find(row => row.target_type === type && row.source_id === id);
  if (!target || !checkedVoucher) {
    redeemAmount.value = "";
    redeemApply.disabled = true;
    return;
  }
  const amount = Math.min(Number(target.balance_due) || 0, Number(checkedVoucher.available_amount) || 0);
  redeemAmount.value = amount > 0 ? amount.toFixed(2) : "";
  redeemAmount.max = String(amount);
  redeemAmount.disabled = amount <= 0;
  redeemApply.disabled = amount <= 0;
}

async function previewVoucher() {
  const code = redeemCode.value.trim().toUpperCase();
  if (!code) { setRedeemMessage("Enter a voucher code first.", "error"); return; }
  redeemCheck.disabled = true;
  redeemApply.disabled = true;
  checkedVoucher = null;
  redeemPreview.textContent = "Checking voucher…";
  try {
    const { data, error } = await supabase.rpc("lookup_credit_voucher", { p_code: code });
    if (error) throw error;
    checkedVoucher = data;
    const masked = (data.customer_first_name || "Customer") + (data.phone_last4 ? " · phone ending " + data.phone_last4 : "");
    redeemPreview.innerHTML = '<strong>' + esc(masked) + '</strong><span>' + money(data.available_amount) +
      ' available · expires ' + dateLabel(data.expires_at) + '</span><small>Status: ' + esc(data.status) + '</small>';
    if (data.status !== "active" || Number(data.available_amount) <= 0.005) {
      redeemTarget.innerHTML = '<option value="">This voucher cannot be redeemed</option>';
      redeemTarget.disabled = true;
      redeemAmount.value = "";
      redeemAmount.disabled = true;
      setRedeemMessage("This voucher is " + data.status + " and cannot be applied.", "error");
      return;
    }
    await loadRedeemTargets();
    if (!redeemTargets.length) throw new Error("There are no outstanding job cards, invoices or confirmed sales orders.");
    setRedeemMessage("Voucher verified. Choose the balance to apply it to.");
    updateRedeemAmount();
  } catch (error) {
    checkedVoucher = null;
    redeemPreview.textContent = "";
    redeemTarget.innerHTML = '<option value="">Check a voucher first</option>';
    redeemTarget.disabled = true;
    redeemAmount.value = "";
    redeemAmount.disabled = true;
    setRedeemMessage(error.message || String(error), "error");
  } finally { redeemCheck.disabled = false; }
}

async function applyVoucher() {
  if (!checkedVoucher) return;
  const [targetType,targetId] = (redeemTarget.value || "").split("|");
  const amount = Number(redeemAmount.value);
  const target = redeemTargets.find(row => row.target_type === targetType && row.source_id === targetId);
  if (!targetType || !target || !Number.isFinite(amount) || amount <= 0) {
    setRedeemMessage("Choose a valid target and amount.", "error");
    return;
  }
  redeemApply.disabled = true;
  setRedeemMessage("Applying voucher and posting the accounting entry…");
  try {
    const { data, error } = await supabase.rpc("redeem_credit_voucher", {
      p_code: redeemCode.value.trim().toUpperCase(),
      p_amount: amount,
      p_target_type: targetType,
      p_target_id: targetId,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error) throw error;
    const { data: refreshed, error: refreshError } = await supabase.from("customer_account_statement")
      .select("balance_due").eq("source_id", targetId).eq("source_type", target.source_type).maybeSingle();
    if (refreshError) throw refreshError;
    const remainingDue = Math.max(0, Number(refreshed?.balance_due) || 0);
    await load();
    await previewVoucher();
    setRedeemMessage("Voucher applied: " + money(data.amount) + ". Voucher remaining: " +
      money(data.remaining_balance) + ". Target balance remaining: " + money(remainingDue) + ".", "success");
  } catch (error) {
    setRedeemMessage(error.message || String(error), "error");
    redeemApply.disabled = false;
  }
}

function stopScanner() {
  scannerActive = false;
  if (scannerStream) scannerStream.getTracks().forEach(track => track.stop());
  scannerStream = null;
  if (redeemVideo) { redeemVideo.pause(); redeemVideo.srcObject = null; redeemVideo.hidden = true; }
}

async function startScanner() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    setRedeemMessage("QR scanning is not supported by this browser. Enter the voucher code manually.");
    return;
  }
  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
    redeemVideo.srcObject = scannerStream;
    redeemVideo.hidden = false;
    await redeemVideo.play();
    scannerActive = true;
    setRedeemMessage("Point the camera at the voucher QR code.");
    const scanFrame = async () => {
      if (!scannerActive) return;
      try {
        const codes = await detector.detect(redeemVideo);
        if (codes.length && codes[0].rawValue) {
          redeemCode.value = codes[0].rawValue;
          stopScanner();
          await previewVoucher();
          return;
        }
      } catch (error) { console.warn("Voucher QR scan frame failed:", error); }
      if (scannerActive) requestAnimationFrame(scanFrame);
    };
    scanFrame();
  } catch (error) {
    stopScanner();
    setRedeemMessage("Camera access failed. Enter the voucher code manually.", "error");
  }
}

async function loadQrLibrary() {
  if (window.QRCode) return;
  if (!qrPromise) qrPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("QR generator could not load."));
    document.head.append(script);
  });
  await qrPromise;
}

async function load() {
  list.innerHTML = '<div class="customer-credit-empty">Loading vouchers…</div>';
  const [voucherResult, redemptionResult, settingsResult] = await Promise.all([
    supabase.rpc("list_customer_credit_vouchers"),
    supabase.from("credit_voucher_redemptions").select("id,voucher_id,amount,target_type,target_id,redeemed_at,reversed_at").order("redeemed_at", { ascending: false }),
    supabase.from("credit_voucher_settings").select("terms,default_expiry_days").eq("id", true).maybeSingle(),
  ]);
  if (voucherResult.error) throw voucherResult.error;
  if (redemptionResult.error) throw redemptionResult.error;
  vouchers = voucherResult.data || [];
  redemptions = redemptionResult.data || [];
  terms = settingsResult.data?.terms || terms;
  render();
}

function render() {
  const query = search?.value.trim().toLowerCase() || "";
  const status = statusFilter?.value || "";
  const rows = vouchers.filter(v => {
    const text = [v.voucher_code, v.customer_name, v.credit_note_number, v.holder_note].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (!status || v.status === status);
  });
  if (!rows.length) {
    list.innerHTML = '<div class="customer-credit-empty">No vouchers match these filters.</div>';
    return;
  }
  const active = vouchers.filter(v => v.status === "active").length;
  const expired = vouchers.filter(v => v.status === "expired").length;
  list.innerHTML = '<div class="customer-credit-summary"><div><small>Total vouchers</small><strong>' + vouchers.length +
    '</strong></div><div><small>Active</small><strong>' + active +
    '</strong></div><div><small>Expired · decision needed</small><strong>' + expired +
    '</strong></div></div><div class="customer-credit-records credit-voucher-records">' +
    rows.map(v => {
      const history = redemptions.filter(r => r.voucher_id === v.voucher_id);
      const last = history.find(r => !r.reversed_at);
      const canCancel = ["active","expired"].includes(v.status);
      return '<article class="credit-voucher-card" data-voucher-id="' + esc(v.voucher_id) + '">' +
        '<div class="credit-voucher-card__top"><div><small>' + esc(v.credit_note_number || "Customer credit") +
        '</small><strong>' + esc(v.customer_name || "Customer") + '</strong></div><span class="credit-voucher-status status-' +
        esc(v.status) + '">' + esc(v.status) + '</span></div>' +
        '<div class="credit-voucher-code">' + esc(v.voucher_code) + '</div>' +
        '<div class="credit-voucher-facts"><span><small>Available</small><strong>' + money(v.available_amount) +
        '</strong></span><span><small>Original</small><strong>' + money(v.original_amount) +
        '</strong></span><span><small>Expires</small><strong>' + dateLabel(v.expires_at) + '</strong></span></div>' +
        (v.holder_note ? '<p class="credit-voucher-note">' + esc(v.holder_note) + '</p>' : '') +
        (v.status === "expired" && Number(v.available_amount) > 0.005 ? '<p class="credit-voucher-expired-note">Unused credit remains a liability. A manager decision is required.</p>' : '') +
        '<div class="credit-voucher-actions"><button class="btn" type="button" data-voucher-print="' + esc(v.voucher_id) + '">Print voucher</button>' +
        '<button class="btn" type="button" data-voucher-whatsapp="' + esc(v.voucher_id) + '">WhatsApp</button>' +
        '<button class="btn" type="button" data-voucher-expiry="' + esc(v.voucher_id) + '">Change expiry</button>' +
        (canCancel ? '<button class="btn" type="button" data-voucher-cancel="' + esc(v.voucher_id) + '">Cancel</button>' : '') +
        (last ? '<button class="btn" type="button" data-voucher-reverse="' + esc(last.id) + '" data-voucher-id="' + esc(v.voucher_id) + '">Reverse last redemption</button>' : '') +
        '</div>' +
        (history.length ? '<details class="credit-voucher-history"><summary>Redemption history · ' + history.length + '</summary>' +
          history.map(r => '<div><span>' + dateLabel(r.redeemed_at) + ' · ' + esc(r.target_type.replace("_"," ")) +
            '</span><strong>' + money(r.amount) + '</strong><small>' + (r.reversed_at ? 'Reversed · ' + dateLabel(r.reversed_at) : 'Posted') +
            '</small></div>').join("") + '</details>' : '') + '</article>';
    }).join("") + '</div>';
}

async function qrDataUrl(code) {
  await loadQrLibrary();
  const node = document.createElement("div");
  new window.QRCode(node, { text: code, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M });
  await new Promise(resolve => setTimeout(resolve, 80));
  const canvas = node.querySelector("canvas");
  const image = node.querySelector("img");
  if (canvas) return canvas.toDataURL("image/png");
  if (image?.src) return image.src;
  throw new Error("QR code could not be created.");
}

function phoneForWhatsApp(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "263" + digits.slice(1);
  return digits;
}

async function printVoucher(v) {
  const qr = await qrDataUrl(v.voucher_code);
  const popup = window.open("", "_blank", "width=900,height=720");
  if (!popup) throw new Error("Allow pop-ups to print the voucher.");
  const logo = window.location.origin + "/assets/logo.png";
  popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Credit Voucher ' + esc(v.voucher_code) + '</title>' +
    '<style>*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#18212b;font:13px/1.5 Arial,sans-serif}.sheet{width:210mm;min-height:297mm;margin:auto;padding:18mm;background:#fff}' +
    '.brand{display:flex;align-items:center;gap:14px;border-bottom:2px solid #152b48;padding-bottom:15px}.brand img{width:56px;height:56px;object-fit:contain}.brand strong{display:block;font-size:17px;letter-spacing:.07em}.brand small{color:#64748b}' +
    'h1{font-size:25px;margin:26px 0 4px}.sub{color:#64748b;margin:0 0 24px}.amount{padding:18px;border:1px solid #dbe2ea;background:#f7f9fb;border-radius:10px}.amount small{display:block;color:#64748b}.amount strong{font-size:32px}' +
    '.code{margin:25px 0 18px;text-align:center;padding:22px;border:1px dashed #8b98a8;border-radius:12px}.code small{display:block;color:#64748b}.code strong{font:800 30px/1.4 ui-monospace,monospace;letter-spacing:.12em}.qr{display:flex;justify-content:center;margin:18px}.qr img{width:160px;height:160px}' +
    '.facts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}.facts div{padding:12px;background:#f5f7f9}.facts small{display:block;color:#64748b}.terms{margin-top:24px;padding-top:16px;border-top:1px solid #dbe2ea;color:#526174}footer{margin-top:32px;text-align:center;color:#64748b;font-size:10px}' +
    '@page{size:A4;margin:0}@media print{.sheet{margin:0;width:210mm;min-height:297mm}}</style></head><body><main class="sheet">' +
    '<header class="brand"><img src="' + logo + '" alt="Centric Auto Mobile"><div><strong>CENTRIC AUTO MOBILE</strong><small>Auto Parts &amp; Repairs · Norton, Zimbabwe</small></div></header>' +
    '<h1>Customer Credit Voucher</h1><p class="sub">Portable customer credit · Keep this code safe</p><section class="amount"><small>Available voucher value</small><strong>' + money(v.available_amount) + '</strong></section>' +
    '<section class="code"><small>VOUCHER CODE</small><strong>' + esc(v.voucher_code) + '</strong><div class="qr"><img src="' + qr + '" alt="Voucher QR code"></div></section>' +
    '<section class="facts"><div><small>Issued to</small><strong>' + esc(v.customer_name || "Customer") + '</strong></div><div><small>Credit note</small><strong>' + esc(v.credit_note_number || "—") +
    '</strong></div><div><small>Expiry date</small><strong>' + dateLabel(v.expires_at) + '</strong></div><div><small>Status</small><strong>' + esc(v.status) + '</strong></div></section>' +
    '<section class="terms"><strong>Terms &amp; conditions</strong><p>' + esc(terms) + '</p><p>Present this voucher code or QR at Centric Auto Mobile when paying for an eligible job card, invoice or sales order. Partial redemption is permitted while value remains.</p></section>' +
    '<footer>CENTRIC AUTO MOBILE · Auto Parts &amp; Repairs · Norton, Zimbabwe</footer></main><script>window.addEventListener("load",()=>{window.focus();window.print()},{once:true});<\/script></body></html>');
  popup.document.close();
}

async function manage(voucherId, action, extra = {}) {
  const promptText = action === "set_expiry" ? "Reason for changing the voucher expiry date:" :
    action === "cancel" ? "Reason for cancelling this voucher:" : "Reason for reversing this voucher redemption:";
  const reason = prompt(promptText)?.trim();
  if (!reason) return;
  const { error } = await supabase.rpc("manage_credit_voucher", {
    p_voucher_id: voucherId, p_action: action, p_reason: reason,
    p_new_expiry: extra.expiry || null, p_redemption_id: extra.redemptionId || null,
  });
  if (error) throw error;
  await load();
}

tabButton?.addEventListener("click", async () => {
  const showVouchers = host.hidden;
  host.hidden = !showVouchers;
  if (notesPanel) notesPanel.hidden = showVouchers;
  tabButton.setAttribute("aria-pressed", String(showVouchers));
  notesTabButton?.setAttribute("aria-pressed", String(!showVouchers));
  if (showVouchers) {
    try { await load(); } catch (error) { list.innerHTML = '<div class="customer-credit-empty">Could not load vouchers: ' + esc(error.message || error) + '</div>'; }
  }
});
notesTabButton?.addEventListener("click", () => {
  host.hidden = true;
  if (notesPanel) notesPanel.hidden = false;
  tabButton.setAttribute("aria-pressed", "false");
  notesTabButton.setAttribute("aria-pressed", "true");
});
refresh?.addEventListener("click", async () => {
  refresh.disabled = true;
  try { await load(); } catch (error) { list.innerHTML = '<div class="customer-credit-empty">' + esc(error.message || error) + '</div>'; }
  finally { refresh.disabled = false; }
});
redeemCheck?.addEventListener("click", previewVoucher);
redeemScan?.addEventListener("click", startScanner);
redeemApply?.addEventListener("click", applyVoucher);
redeemTarget?.addEventListener("change", updateRedeemAmount);
redeemCode?.addEventListener("input", () => { checkedVoucher = null; redeemApply.disabled = true; });
document.addEventListener("visibilitychange", () => { if (document.hidden) stopScanner(); });
search?.addEventListener("input", render);
statusFilter?.addEventListener("change", render);

list.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const voucherId = button.dataset.voucherPrint || button.dataset.voucherWhatsapp || button.dataset.voucherExpiry || button.dataset.voucherCancel || button.dataset.voucherId;
  const v = vouchers.find(row => row.voucher_id === voucherId);
  if (!v) return;
  button.disabled = true;
  try {
    if (button.dataset.voucherPrint) await printVoucher(v);
    else if (button.dataset.voucherWhatsapp) {
      const phone = phoneForWhatsApp(v.customer_phone);
      if (!phone) throw new Error("No WhatsApp number is saved for this customer.");
      const message = "Hello " + (v.customer_name || "Customer") + ", your Centric Auto Mobile credit voucher is ready.\n\nValue: " + money(v.available_amount) +
        "\nVoucher code: " + v.voucher_code + "\nExpiry: " + dateLabel(v.expires_at) + "\n\n" + terms;
      window.open("https://wa.me/" + phone + "?text=" + encodeURIComponent(message), "_blank");
    } else if (button.dataset.voucherExpiry) {
      const value = prompt("Enter the new expiry date (YYYY-MM-DD):", v.expires_at);
      if (!value) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new Error("Enter a valid date in YYYY-MM-DD format.");
      await manage(v.voucher_id, "set_expiry", { expiry: value });
    } else if (button.dataset.voucherCancel) await manage(v.voucher_id, "cancel");
    else if (button.dataset.voucherReverse) await manage(v.voucher_id, "reverse", { redemptionId: button.dataset.voucherReverse });
  } catch (error) { alert(error.message || String(error)); }
  finally { button.disabled = false; }
});
document.addEventListener("apr:access-ready", () => { if (!host.hidden) load().catch(error => console.error("Voucher refresh failed:", error)); });
