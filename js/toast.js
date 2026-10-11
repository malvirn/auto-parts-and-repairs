// ========= Confirmation messages (toasts) =========
// Shows a clear, glassy message at the top of the screen. If the page
// changes straight after an action (e.g. "Save order" → receipt page), the
// message is carried over and shown on the next page.
const CARRY_KEY = "apr-toast-carry";
let host = null;
let lastMsg = "", lastAt = 0;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement("div");
  host.className = "apr-toasts";
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.appendChild(host);
  return host;
}

const ICONS = {
  success: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12.5 2.6 2.6L16.5 9"/></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.5"/></svg>',
};

export function showToast(message, tone = "success", detail = "") {
  if (!message) return;
  const now = Date.now();
  if (message === lastMsg && now - lastAt < 1200) return; // no duplicates
  lastMsg = message; lastAt = now;
  if (!document.body) { document.addEventListener("DOMContentLoaded", () => showToast(message, tone, detail), { once: true }); return; }
  const el = document.createElement("div");
  el.className = `apr-toast ${tone}`;
  el.innerHTML = `<span class="apr-toast-ic">${ICONS[tone] || ICONS.info}</span><span class="apr-toast-tx"><b></b><small></small></span><button type="button" class="apr-toast-x" aria-label="Dismiss">×</button>`;
  el.querySelector("b").textContent = message;
  el.querySelector("small").textContent = detail || "";
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 250); };
  el.querySelector(".apr-toast-x").addEventListener("click", close);
  ensureHost().appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(close, tone === "error" ? 6500 : 3800);
  lastShown = { message, tone, detail, at: now };
}
let lastShown = null;

// Show a message that was raised just before the page changed.
function showCarried() {
  try {
    const raw = sessionStorage.getItem(CARRY_KEY);
    sessionStorage.removeItem(CARRY_KEY);
    if (!raw) return;
    const t = JSON.parse(raw);
    if (Date.now() - t.at < 4000) { lastMsg = ""; showToast(t.message, t.tone, t.detail); }
  } catch (e) {}
}
window.addEventListener("pageshow", () => setTimeout(showCarried, 50));

window.aprToast = showToast;

// ---- Which saves get a message, and what it says ----
// priority: when one action saves several things at once (a job card plus its
// parts and vehicle), only the most important message is shown.
const SILENT = 0;
const isOnly = (payload, keys) => payload && !Array.isArray(payload) && Object.keys(payload).length > 0 && Object.keys(payload).every(k => keys.includes(k));

function describe(table, op, payload) {
  const p = Array.isArray(payload) ? payload[0] : payload;
  const n = Array.isArray(payload) ? payload.length : 1;
  const M = (text, pr) => ({ text, pr });
  switch (table) {
    case "repair_jobs":
      if (op === "insert") return M("Job card created", 10);
      if (op === "update") {
        if (p?.status === "Collected") return M("Vehicle marked as collected", 10);
        if (isOnly(p, ["incidentals_cost", "parts_cost", "ai_suggested_causes"])) return M("", SILENT);
        return M("Job card saved", 8);
      }
      return M("Job card deleted", 8);
    case "customers": return M(op === "insert" ? (p?.customer_type === "company" ? "Company added" : "Customer added") : op === "delete" ? "Customer removed" : "Customer updated", 9);
    case "vehicles": return M(op === "insert" ? "Vehicle registered" : op === "delete" ? "Vehicle removed" : "Vehicle details saved", 4);
    case "job_parts": return M(op === "insert" ? "Part added to the job card" : op === "delete" ? "Part removed from the job card" : "Part updated", 6);
    case "job_incidentals": return M(op === "insert" ? "Incidental added" : op === "delete" ? "Incidental removed" : "Incidental updated", 6);
    case "quotations": return M(op === "insert" ? "Quotation saved" : op === "delete" ? "Quotation deleted" : "Quotation updated", 9);
    case "sales_orders": return M(op === "insert" ? "Sales order created" : op === "delete" ? "Sales order deleted" : "Sales order saved", 9);
    case "receipts": return M(op === "insert" ? "Receipt recorded" : "Receipt updated", 7);
    case "parts":
      if (op === "update" && isOnly(p, ["quantity_in_stock"])) return M("", SILENT);
      return M(op === "insert" ? "Part added to the shop" : op === "delete" ? "Part deleted" : "Part updated", 8);
    case "restocks": return M(op === "insert" ? "Stock received" : "Restock removed", 8);
    case "suppliers": return M(op === "insert" ? "Supplier added" : op === "delete" ? "Supplier removed" : "Supplier updated", 8);
    case "part_suppliers": return M("Supplier links updated", 3);
    case "technicians": return M(op === "insert" ? "Employee added" : op === "delete" ? "Employee removed" : "Employee updated", 8);
    case "employee_off_days": return M(op === "insert" ? "Off day added" : "Off day removed", 7);
    case "payables": return M(op === "insert" ? "Bill recorded" : "Bill updated", 8);
    case "payable_payments": return M("Payment recorded", 9);
    case "accounts": return M("Account added", 8);
    case "journal_entries": return M(op === "insert" ? "Journal entry posted" : "", op === "insert" ? 5 : SILENT);
    case "fixed_assets": return M(op === "insert" ? "Asset added" : "Asset updated", 8);
    case "depreciation_entries": return M("Depreciation posted", 7);
    case "purchase_shipments": return M(op === "insert" ? "Shipment saved" : op === "delete" ? "Shipment deleted" : "Shipment updated", 8);
    case "commissions": return M(op === "insert" ? (n > 1 ? `${n} commissions recorded` : "Commission recorded") : "Commission updated", 8);
    case "commission_rates": return M("Commission rates saved", 8);
    case "profiles": return M("User access updated", 8);
    // pages that already show their own message, or background bookkeeping
    case "settings": case "business_settings": case "vehicle_rate_tiers":
    case "webauthn_credentials": case "webauthn_challenges":
    case "journal_lines": case "quotation_items": case "sales_order_items":
    case "purchase_shipment_items": case "status_history": case "notifications":
      return M("", SILENT);
    default:
      return M(op === "delete" ? "Deleted" : "Saved", 2);
  }
}

let pending = null, timer = null;
export function noteWrite(table, op, payload) {
  const d = describe(table, op, payload);
  if (!d.text || d.pr === SILENT) return;
  if (!pending || d.pr > pending.pr) pending = d;
  clearTimeout(timer);
  timer = setTimeout(() => { showToast(pending.text); pending = null; }, 450);
}
// If the page changes before a message shows (or straight after it shows),
// carry it to the next page so it isn't missed.
window.addEventListener("pagehide", () => {
  let carry = null;
  if (pending) carry = { message: pending.text, tone: "success", detail: "" };
  else if (lastShown && Date.now() - lastShown.at < 1500) carry = lastShown;
  if (!carry) return;
  try { sessionStorage.setItem(CARRY_KEY, JSON.stringify({ ...carry, at: Date.now() })); } catch (e) {}
});
