import supabase from "./supabaseClient.js";

// ============================================================
// Global notification bell — injects itself into every page that loads
// this script, so "important things happening elsewhere" are visible no
// matter where you currently are in the app. No HTML changes needed per
// page: this builds its own markup and appends it to <body>.
// ============================================================

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // re-check every 5 minutes

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }
function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000); }

// ---------- Inject the bell + dropdown markup ----------

function injectBellUI() {
  if (document.getElementById("global-notif-bell")) return; // already injected (e.g. hot reload)

  const style = document.createElement("style");
  style.textContent = `
    #global-notif-bell {
      position: fixed; top: 16px; right: 20px; z-index: 2000;
      width: 42px; height: 42px; border-radius: 50%;
      background: var(--surface, #161412); border: 1px solid var(--border, rgba(255,255,255,.1));
      color: var(--text, #e8e6e3); display: flex; align-items: center; justify-content: center;
      cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25);
    }
    #global-notif-bell:hover { border-color: var(--accent, #ff9d3d); }
    #global-notif-badge {
      position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 999px; background: var(--danger, #b23b3b); color: #fff;
      font-size: .68rem; font-weight: 700; display: none; align-items: center; justify-content: center;
    }
    #global-notif-panel {
      position: fixed; top: 64px; right: 20px; z-index: 2000; width: 340px; max-height: 70vh; overflow-y: auto;
      background: var(--surface, #161412); border: 1px solid var(--border, rgba(255,255,255,.1)); border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0,0,0,.35); display: none; padding: 10px;
    }
    #global-notif-panel.open { display: block; }
    #global-notif-panel h4 { margin: 4px 8px 8px; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-muted, #9a9690); }
    .global-notif-item {
      display: flex; gap: 10px; padding: 10px 8px; border-radius: 8px; text-decoration: none; color: inherit;
      align-items: flex-start; font-size: .84rem; line-height: 1.35;
    }
    .global-notif-item:hover { background: rgba(255,255,255,.04); }
    .global-notif-item .dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
    .global-notif-item.critical .dot { background: var(--danger, #b23b3b); }
    .global-notif-item.warning .dot { background: var(--warning, #c99a2e); }
    .global-notif-empty { padding: 20px 8px; text-align: center; color: var(--text-muted, #9a9690); font-size: .84rem; }
  `;
  document.head.appendChild(style);

  const bell = document.createElement("button");
  bell.id = "global-notif-bell";
  bell.setAttribute("aria-label", "Notifications");
  bell.innerHTML = `<i data-lucide="bell"></i><span id="global-notif-badge"></span>`;
  document.body.appendChild(bell);

  const panel = document.createElement("div");
  panel.id = "global-notif-panel";
  panel.innerHTML = `<h4>Notifications</h4><div id="global-notif-list"></div>`;
  document.body.appendChild(panel);

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== bell) panel.classList.remove("open");
  });

  if (window.lucide) lucide.createIcons();
}

function renderNotifications(items) {
  const badge = document.getElementById("global-notif-badge");
  const list = document.getElementById("global-notif-list");
  if (!badge || !list) return;

  if (items.length > 0) {
    badge.textContent = items.length > 9 ? "9+" : String(items.length);
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }

  list.innerHTML = items.length
    ? items.map(n => `
        <a class="global-notif-item ${n.severity}" href="${n.link}">
          <span class="dot"></span>
          <span>${n.message}</span>
        </a>
      `).join("")
    : `<div class="global-notif-empty">All caught up — nothing needs attention right now.</div>`;

  if (window.lucide) lucide.createIcons();
}

// ---------- Checks ----------
// Each is independent and wrapped so one failing (e.g. RLS blocking a
// non-admin from payables/ledger data) never breaks the others — it just
// contributes nothing, which is the correct behaviour for a locked-down
// section rather than an error state.

async function checkOverduePayables() {
  try {
    const { data } = await supabase.from("payables").select("id, bill_number, due_date, amount, amount_paid, suppliers(name)").neq("status", "paid");
    const today = new Date().toISOString().slice(0, 10);
    return (data || [])
      .filter(p => p.due_date < today && Number(p.amount) - Number(p.amount_paid) > 0.01)
      .map(p => ({
        severity: "warning",
        message: `Bill ${escapeHtml(p.bill_number || "—")} from ${escapeHtml(p.suppliers?.name || "a supplier")} is overdue — ${money(Number(p.amount) - Number(p.amount_paid))} owed`,
        link: "payables.html",
      }));
  } catch { return []; }
}

async function checkLowStock() {
  try {
    const { data } = await supabase.from("parts").select("id, name, quantity_in_stock").lt("quantity_in_stock", 3);
    return (data || []).map(p => ({
      severity: "warning",
      message: `${escapeHtml(p.name)} is low on stock — only ${p.quantity_in_stock} left`,
      link: "shop.html",
    }));
  } catch { return []; }
}

async function checkExpiringContracts() {
  try {
    const { data } = await supabase.from("technicians").select("id, full_name, contract_end").eq("is_active", true).not("contract_end", "is", null);
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(); in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);
    return (data || [])
      .filter(t => t.contract_end <= in30Str)
      .map(t => {
        const expired = t.contract_end < today;
        return {
          severity: expired ? "critical" : "warning",
          message: expired
            ? `${escapeHtml(t.full_name)}'s contract expired on ${t.contract_end}`
            : `${escapeHtml(t.full_name)}'s contract ends ${t.contract_end}`,
          link: "technicians.html",
        };
      });
  } catch { return []; }
}

async function checkUnclaimedVehicles() {
  try {
    const GRACE_DAYS = 7;
    const { data } = await supabase.from("repair_jobs").select("id, job_number, ready_at, status, collected_at").in("status", ["Ready for Pickup", "Unclaimed"]).is("collected_at", null).not("ready_at", "is", null);
    const now = Date.now();
    return (data || [])
      .filter(j => now - new Date(j.ready_at).getTime() > GRACE_DAYS * 86400000)
      .map(j => {
        const overdueDays = Math.floor((now - new Date(j.ready_at).getTime()) / 86400000) - GRACE_DAYS;
        return {
          severity: "warning",
          message: `Job #${String(j.job_number).padStart(4, "0")} uncollected ${overdueDays} day${overdueDays === 1 ? "" : "s"} past free pickup window`,
          link: "repairs.html",
        };
      });
  } catch { return []; }
}

async function checkPettyCash() {
  try {
    const { data: accounts } = await supabase.from("accounts").select("id, code").eq("code", "1050");
    const pettyAccount = (accounts || [])[0];
    if (!pettyAccount) return [];
    const [{ data: lines }, { data: settings }] = await Promise.all([
      supabase.from("journal_lines").select("debit, credit").eq("account_id", pettyAccount.id),
      supabase.from("petty_cash_settings").select("target_float").limit(1).maybeSingle(),
    ]);
    const balance = (lines || []).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0);
    const target = settings ? Number(settings.target_float) : 100;
    if (balance < target * 0.3) {
      return [{ severity: "warning", message: `Petty cash float is low — ${money(balance)} left (target ${money(target)})`, link: "cashbook.html" }];
    }
    return [];
  } catch { return []; }
}

async function checkLedgerIntegrity() {
  // This should structurally never fire, given the balance-enforcing
  // trigger from Phase 1 — but if it ever does, it means the ledger was
  // edited outside the app, and that's worth surfacing loudly everywhere.
  try {
    const { data } = await supabase.from("journal_lines").select("debit, credit");
    const totalDebit = (data || []).reduce((s, l) => s + Number(l.debit || 0), 0);
    const totalCredit = (data || []).reduce((s, l) => s + Number(l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return [{ severity: "critical", message: `Ledger is out of balance by ${money(Math.abs(totalDebit - totalCredit))} — check for a manually edited entry`, link: "ledger.html" }];
    }
    return [];
  } catch { return []; }
}

async function runAllChecks() {
  const results = await Promise.all([
    checkLedgerIntegrity(),
    checkOverduePayables(),
    checkExpiringContracts(),
    checkUnclaimedVehicles(),
    checkPettyCash(),
    checkLowStock(),
  ]);
  const items = results.flat();
  // Critical first, then everything else in whatever order it came back.
  items.sort((a, b) => (a.severity === "critical" ? -1 : 0) - (b.severity === "critical" ? -1 : 0));
  renderNotifications(items);
}

// ---------- Boot ----------

function init() {
  injectBellUI();
  runAllChecks();
  setInterval(runAllChecks, REFRESH_INTERVAL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}