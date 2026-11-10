import supabase from "./supabaseClient.js";

const host = document.getElementById("credit-voucher-panel");
const list = document.getElementById("credit-voucher-list");
const search = document.getElementById("credit-voucher-search");
const statusFilter = document.getElementById("credit-voucher-status");
const refresh = document.getElementById("credit-voucher-refresh");
const tabButton = document.getElementById("credit-voucher-tab");
const notesTabButton = document.getElementById("credit-notes-tab");
const notesPanel = document.getElementById("customer-credit-panel");
if (!host || !list || !tabButton) throw new Error("Credit voucher panel is missing.");

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

tabButton.addEventListener("click", async () => {
  const showVouchers = host.hidden;
  host.hidden = !showVouchers;
  notesPanel.hidden = showVouchers;
  tabButton.setAttribute("aria-pressed", String(showVouchers));
  notesTabButton?.setAttribute("aria-pressed", String(!showVouchers));
  if (showVouchers) {
    try { await load(); } catch (error) { list.innerHTML = '<div class="customer-credit-empty">Could not load vouchers: ' + esc(error.message || error) + '</div>'; }
  }
});
notesTabButton?.addEventListener("click", () => {
  host.hidden = true;
  notesPanel.hidden = false;
  tabButton.setAttribute("aria-pressed", "false");
  notesTabButton.setAttribute("aria-pressed", "true");
});
refresh?.addEventListener("click", async () => {
  refresh.disabled = true;
  try { await load(); } catch (error) { list.innerHTML = '<div class="customer-credit-empty">' + esc(error.message || error) + '</div>'; }
  finally { refresh.disabled = false; }
});
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
