import supabase from "./supabaseClient.js";

// ============================================================
// Global notification bell — injects itself into every page that loads
// this script, so "important things happening elsewhere" are visible no
// matter where you currently are in the app. It appends its own markup to
// <body>, except on dashboard pages with a header action cluster.
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
    body.dashboard-page:not(.dashboard-workshop) #global-notif-bell {
      position: static; top: auto; right: auto; z-index: auto;
      width: 44px; height: 44px; flex: none;
    }
    body.dashboard-workshop .dashboard-topbar #global-notif-bell,
    body.dashboard-page:not(.dashboard-workshop) .hdr-header-actions #global-notif-bell {
      position: relative; top: auto; right: auto; z-index: auto;
      width: 38px; height: 38px; flex: none;
    }
    @media (max-width: 480px) {
      body.dashboard-page:not(.dashboard-workshop) .hdr-header-actions #global-notif-bell {
        width: 32px; height: 32px;
      }
    }
    @media (max-width: 360px) {
      body.dashboard-page:not(.dashboard-workshop) .hdr-header-actions #global-notif-bell {
        width: 28px; height: 28px;
      }
    }
    #global-notif-bell:hover { border-color: var(--accent, #ff9d3d); }
    #global-notif-badge {
      position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 999px; background: var(--danger, #b23b3b); color: #fff;
      font-size: .68rem; font-weight: 700; display: none; align-items: center; justify-content: center;
    }
    #global-notif-panel {
      position: fixed; top: 64px; right: 20px; z-index: 2000; width: min(340px, calc(100vw - 24px)); max-height: 70vh; overflow-y: auto;
      background: var(--surface, #161412); border: 1px solid var(--border, rgba(255,255,255,.1)); border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0,0,0,.35); display: none; padding: 10px;
    }
    body.dashboard-page:not(.dashboard-workshop) #global-notif-panel {
      top: auto; right: auto; width: min(340px, calc(100vw - 24px));
      max-height: min(70vh, 560px);
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
  const dashboardTopbar = document.querySelector("body.dashboard-workshop .dashboard-topbar");
  const topbarActions = dashboardTopbar?.querySelector(".dashboard-topbar-actions");
  const headerActions = document.querySelector("body.dashboard-page:not(.dashboard-workshop) .hdr-header-actions")
    || document.querySelector("body.dashboard-page:not(.dashboard-workshop) .hdr-menu-wrap");
  const dashboardActions = topbarActions || headerActions;
  if (topbarActions) topbarActions.append(bell);
  else if (headerActions?.classList.contains("hdr-header-actions")) {
    headerActions.insertBefore(bell, headerActions.querySelector(".hdr-menu-wrap"));
  } else if (headerActions) headerActions.insertBefore(bell, headerActions.querySelector("#hdr-menu-btn"));
  else if (dashboardTopbar) dashboardTopbar.append(bell);
  else document.body.appendChild(bell);

  const panel = document.createElement("div");
  panel.id = "global-notif-panel";
  panel.innerHTML = `<h4>Notifications</h4><div id="global-notif-list"></div>`;
  document.body.appendChild(panel);

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
    if (panel.classList.contains("open") && (dashboardActions || dashboardTopbar)) {
      const rect = bell.getBoundingClientRect();
      panel.style.top = `${rect.bottom + 8}px`;
      panel.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    }
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
    const { data } = await supabase.from("payables")
      .select("id, bill_number, due_date, amount, amount_paid, voided_at, suppliers(name)")
      .neq("status", "paid")
      .is("voided_at", null);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    return (data || [])
      .filter(p => !p.voided_at && p.due_date < today && Number(p.amount) - Number(p.amount_paid) > 0.01)
      .map(p => ({
        severity: "warning",
        message: `Bill ${escapeHtml(p.bill_number || "—")} from ${escapeHtml(p.suppliers?.name || "a supplier")} is overdue — ${money(Number(p.amount) - Number(p.amount_paid))} owed`,
        link: `payables.html?highlight=${encodeURIComponent(p.id)}`,
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
    const { data } = await supabase.from("repair_jobs").select("id, job_number, cro_number, ready_at, status, collected_at").in("status", ["Ready for Pickup", "Unclaimed"]).is("collected_at", null).not("ready_at", "is", null);
    const now = Date.now();
    return (data || [])
      .filter(j => now - new Date(j.ready_at).getTime() > GRACE_DAYS * 86400000)
      .map(j => {
        const overdueDays = Math.floor((now - new Date(j.ready_at).getTime()) / 86400000) - GRACE_DAYS;
        return {
          severity: "warning",
          message: `${j.cro_number || "Job #" + String(j.job_number).padStart(4, "0")} uncollected ${overdueDays} day${overdueDays === 1 ? "" : "s"} past free pickup window`,
          link: "repairs.html",
        };
      });
  } catch { return []; }
}

async function checkJobsAwaitingBilling() {
  if (!["accounting", "super_admin"].includes(document.body.dataset.role)) return [];

  try {
    const { data: jobs, error: jobsError } = await supabase.from("repair_jobs")
      .select("id, job_number, cro_number, customers(full_name)")
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(500);
    if (jobsError) throw jobsError;
    if (!jobs?.length) return [];

    const jobIds = jobs.map(job => job.id);
    const { data: invoices, error: invoicesError } = await supabase.from("invoices")
      .select("repair_job_id")
      .in("repair_job_id", jobIds);
    if (invoicesError) throw invoicesError;

    const invoicedJobIds = new Set((invoices || []).map(invoice => invoice.repair_job_id));
    return jobs
      .filter(job => !invoicedJobIds.has(job.id))
      .map(job => {
        const reference = job.cro_number || `JC-${String(job.job_number || "").padStart(5, "0")}`;
        const path = window.location.pathname.includes("/pages/") ? "receipts.html" : "pages/receipts.html";
        const query = new URLSearchParams({ new: "1", job: job.id, from: "accounting" });
        return {
          severity: "warning",
          message: `${escapeHtml(reference)} for ${escapeHtml(job.customers?.full_name || "a customer")} is closed and awaiting an invoice`,
          link: `${path}?${query}`,
        };
      });
  } catch (error) {
    console.error("Couldn't check closed jobs awaiting billing:", error);
    return [];
  }
}

async function checkCompletedJobCards() {
  try {
    const { data, error } = await supabase.from("repair_jobs")
      .select("id,job_number,cro_number,completed_at,status")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const path = window.location.pathname.includes("/pages/") ? "repairs.html" : "pages/repairs.html";
    return (data || []).map(job => {
      const reference = job.cro_number || `JC-${String(job.job_number || "").padStart(5, "0")}`;
      return {
        severity: "warning",
        message: `${escapeHtml(reference)} is complete and ready for review`,
        link: `${path}?edit=${encodeURIComponent(job.id)}`,
      };
    });
  } catch (error) {
    console.error("Couldn't check completed job cards:", error);
    return [];
  }
}

async function checkUnpricedJobParts() {
  if (!["accounting", "super_admin"].includes(document.body.dataset.role)) return [];
  try {
    const { data, error } = await supabase.rpc("get_unpriced_job_parts");
    if (error) throw error;
    const path = window.location.pathname.includes("/pages/") ? "ledger.html" : "pages/ledger.html";
    const items = data || [];
    return items.map(item => {
      const reference = item.job_number || "Job card";
      return {
        severity: "warning",
        message: `${escapeHtml(reference)} — ${escapeHtml(item.part_name || "Typed-in part")} needs accounting pricing`,
        link: `${path}#unpriced-job-parts`,
      };
    });
  } catch (error) {
    console.error("Couldn't check unpriced job-card parts:", error);
    return [];
  }
}

async function checkJobPartPurchases() {
  const role = document.body.dataset.role;
  if (!role) return [];

  const isAccounting = ["accounting", "super_admin"].includes(role);
  const isShop = ["staff", "super_admin"].includes(role);
  if (!isAccounting && !isShop) return [];

  try {
    const results = await Promise.all([
      ...(isAccounting ? [supabase.rpc("get_accounting_job_part_purchase_requests")] : []),
      ...(isShop ? [supabase.rpc("get_shop_job_part_purchase_requests")] : []),
    ]);
    for (const result of results) {
      if (result.error) throw result.error;
    }

    const pathPrefix = window.location.pathname.includes("/pages/") ? "" : "pages/";
    const requests = [
      ...(isAccounting ? (results[0].data || []).map(request => ({ ...request, queue: "accounting" })) : []),
      ...(isShop ? (results[isAccounting ? 1 : 0].data || [])
        .filter(request => ["requested", "paid"].includes(request.status))
        .map(request => ({ ...request, queue: "shop" })) : []),
    ];
    return requests.map(request => {
      const reference = request.cro_number || `JC-${String(request.job_number || "").padStart(5, "0")}`;
      const partName = escapeHtml(request.part_name || "a typed-in part");
      const action = request.queue === "accounting"
        ? "awaiting supplier payment"
        : request.status === "paid" ? "paid and ready to order/receive" : "needs a supplier quote";
      return {
        severity: "warning",
        message: `${escapeHtml(reference)} — ${partName} ${action}`,
        link: `${pathPrefix}${request.queue === "accounting" ? "accounting.html" : "shop.html"}#job-part-purchase-requests`,
      };
    });
  } catch (error) {
    console.error("Couldn't check job-part purchase requests:", error);
    return [];
  }
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

// Flags a genuine statistical outlier — an amount more than 2.5 standard
// deviations above the mean of its own group. Requires at least 5 data
// points before flagging anything at all, since "unusual" is meaningless
// with too little history to compare against. Pure arithmetic, no AI
// call — this runs on every notification refresh (every 5 minutes, on
// every page), so it needs to stay instant and free.
function findOutliers(values, labelForIndex) {
  if (values.length < 5) return [];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return [];
  const outliers = [];
  values.forEach((v, i) => {
    if (v > mean + 2.5 * stdDev) outliers.push({ index: i, value: v, mean });
  });
  return outliers;
}

async function checkCommissionAnomalies() {
  try {
    const { data } = await supabase.from("commissions").select("commission_amount, employee_id").order("created_at", { ascending: false }).limit(100);
    if (!data || data.length < 5) return [];
    const { data: employees } = await supabase.from("technician_directory").select("id, full_name");
    const names = Object.fromEntries((employees || []).map(e => [e.id, e.full_name]));
    const values = data.map(c => Number(c.commission_amount));
    const outliers = findOutliers(values, i => data[i].employee_id);
    return outliers.slice(0, 3).map(o => ({
      severity: "warning",
      message: `Unusually high commission — ${money(o.value)} for ${names[data[o.index].employee_id] || "an employee"} (typical is around ${money(o.mean)})`,
      link: "commissions.html",
    }));
  } catch { return []; }
}

async function checkPayableAnomalies() {
  try {
    const { data } = await supabase.from("payables").select("amount, bill_number, suppliers(name)").order("created_at", { ascending: false }).limit(100);
    if (!data || data.length < 5) return [];
    const values = data.map(p => Number(p.amount));
    const outliers = findOutliers(values);
    return outliers.slice(0, 3).map(o => ({
      severity: "warning",
      message: `Unusually large bill — ${money(o.value)} from ${data[o.index].suppliers?.name || "a supplier"} (typical is around ${money(o.mean)})`,
      link: "payables.html",
    }));
  } catch { return []; }
}

async function runAllChecks() {
  const results = await Promise.all([
    checkLedgerIntegrity(),
    checkOverduePayables(),
    checkExpiringContracts(),
    checkUnclaimedVehicles(),
    checkJobsAwaitingBilling(),
    checkCompletedJobCards(),
    checkJobPartPurchases(),
    checkUnpricedJobParts(),
    checkPettyCash(),
    checkLowStock(),
    checkCommissionAnomalies(),
    checkPayableAnomalies(),
  ]);
  const items = results.flat();
  // Critical first, then everything else in whatever order it came back.
  items.sort((a, b) => (a.severity === "critical" ? -1 : 0) - (b.severity === "critical" ? -1 : 0));
  renderNotifications(items);
}

// ---------- Boot ----------

function init() {
  injectBellUI();
  if (document.body.dataset.role) {
    runAllChecks();
  } else {
    document.addEventListener("apr:access-ready", runAllChecks, { once: true });
  }
  setInterval(runAllChecks, REFRESH_INTERVAL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
