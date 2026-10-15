import supabase from "./supabaseClient.js";

const recentJobsBody = document.getElementById("recent-jobs");

// Same thresholds as repairs.js (parking fee countdown) and analytics.js
// (payroll due date) — duplicated here rather than shared, since there's
// no shared utils module across pages yet.
const PARKING_GRACE_DAYS = 7;
const PARKING_FEE_PER_DAY = 3;

function lastFridayOfMonth(year, month) {
  const lastDay = new Date(year, month + 1, 0);
  const offset = (lastDay.getDay() - 5 + 7) % 7; // 5 = Friday
  lastDay.setDate(lastDay.getDate() - offset);
  return lastDay;
}

async function getData(label, query) {
  const { data, error } = await query;
  if (error) {
    console.error(`Error loading ${label}:`, error);
    return [];
  }
  return data || [];
}

async function loadDashboard() {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const [jobs, customers, parts, receipts, payrollRuns, settingsRows] = await Promise.all([
    getData("repair jobs", supabase.from("repair_jobs").select(`
      id, job_number, status, total_cost, created_at, completed_at, ready_at, collected_at,
      customers ( full_name ),
      vehicles ( make, model, year, license_plate )
    `).order("created_at", { ascending: false })),
    getData("customers", supabase.from("customers").select("id, created_at")),
    getData("parts", supabase.from("parts").select("id, name, quantity_in_stock")),
    getData("receipts", supabase.from("receipts").select("id, amount, issued_at, repair_job_id")),
    getData("payroll runs", supabase.from("payroll_runs").select("year, month").order("year", { ascending: false }).order("month", { ascending: false }).limit(1)),
    getData("settings", supabase.from("settings").select("daily_jobs_target, daily_revenue_target").limit(1)),
  ]);

  renderGreeting();
  const snapshot = renderTodaySnapshot(jobs, customers, receipts, todayStr);
  renderObjectives(snapshot, settingsRows[0]);
  renderNeedsAttention(jobs, parts, receipts, payrollRuns);
  renderRecentJobs(jobs.slice(0, 10));
  initGlobalSearch();

  if (window.lucide) lucide.createIcons();
}

function renderGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  setText(document.getElementById("dashboard-greeting"), greeting);
  const dateEl = document.getElementById("dashboard-date");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }
}

function renderTodaySnapshot(jobs, customers, receipts, todayStr) {
  const isToday = iso => iso && iso.slice(0, 10) === todayStr;
  const createdToday = jobs.filter(j => isToday(j.created_at)).length;
  const completedToday = jobs.filter(j => isToday(j.completed_at)).length;
  const revenueToday = receipts.filter(r => isToday(r.issued_at)).reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const newCustomersToday = customers.filter(c => isToday(c.created_at)).length;

  const el = document.getElementById("today-cards");
  if (el) {
    el.innerHTML = `
      <div class="stat-card"><div class="stat-card__label">Jobs Created Today</div><div class="stat-card__value">${createdToday}</div></div>
      <div class="stat-card"><div class="stat-card__label">Jobs Completed Today</div><div class="stat-card__value">${completedToday}</div></div>
      <div class="stat-card"><div class="stat-card__label">Revenue Today</div><div class="stat-card__value">$${revenueToday.toFixed(2)}</div></div>
      <div class="stat-card"><div class="stat-card__label">New Customers Today</div><div class="stat-card__value">${newCustomersToday}</div></div>
    `;
  }
  const dateNote = document.getElementById("snapshot-date");
  if (dateNote) dateNote.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  return { createdToday, revenueToday };
}

// ---- Today's Objectives (S.M.A.R.T.) ----
// Specific & Measurable come from the Daily Goals set in Settings; Achievable
// and Relevant are judged by comparing progress against how much of the
// working day (8am-5pm) has elapsed; Time-bound is always "by close of
// business today".
function businessDayElapsed() {
  const now = new Date();
  const startHour = 8, endHour = 17;
  const h = now.getHours() + now.getMinutes() / 60;
  if (h <= startHour) return 0;
  if (h >= endHour) return 1;
  return (h - startHour) / (endHour - startHour);
}

function objectiveCard({ icon, title, actual, target, fmt, specific }) {
  const format = fmt || (n => String(n));
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;
  const expectedPct = businessDayElapsed() * 100;
  const status = pct >= 100
    ? { label: "Goal met", cls: "met" }
    : pct >= expectedPct - 8
      ? { label: "On track", cls: "ontrack" }
      : { label: "Behind pace", cls: "behind" };
  return `
    <div class="objective-card">
      <div class="objective-card__top">
        <div class="objective-card__icon"><i data-lucide="${icon}"></i></div>
        <span class="objective-chip objective-chip--${status.cls}">${status.label}</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <div class="objective-card__progress"><div class="objective-card__bar" style="width:${pct}%"></div></div>
      <div class="objective-card__meta"><strong>${format(actual)}</strong> of ${format(target)} target</div>
      <p class="objective-card__smart">${escapeHtml(specific)}</p>
    </div>`;
}

function renderObjectives(snapshot, targets) {
  const el = document.getElementById("objectives-grid");
  if (!el) return;
  if (!targets) {
    el.innerHTML = `<div class="objective-card">No daily goals set yet — set them in Settings &rarr; Daily Goals.</div>`;
    return;
  }
  const jobsTarget = Number(targets.daily_jobs_target) || 0;
  const revenueTarget = Number(targets.daily_revenue_target) || 0;
  el.innerHTML = [
    objectiveCard({
      icon: "clipboard-plus",
      title: "Job cards opened today",
      actual: snapshot.createdToday,
      target: jobsTarget,
      fmt: n => `${n} job${n === 1 ? "" : "s"}`,
      specific: `Specific: open ${jobsTarget} job card${jobsTarget === 1 ? "" : "s"} today. Measurable against job cards actually created. Time-bound: by close of business.`,
    }),
    objectiveCard({
      icon: "banknote",
      title: "Revenue today",
      actual: snapshot.revenueToday,
      target: revenueTarget,
      fmt: n => `$${Number(n).toFixed(0)}`,
      specific: `Specific: bill $${revenueTarget.toFixed(0)} across today's receipts. Measurable against receipts issued. Time-bound: by close of business.`,
    }),
  ].join("");
  if (window.lucide) lucide.createIcons();
}

// Pulls together everything that actually needs a human decision today —
// overdue pickups racking up parking fees, stock running low, jobs that
// are done but not yet receipted, and payroll sitting unprocessed past
// its due date. Each links straight to where it gets fixed.
function renderNeedsAttention(jobs, parts, receipts, payrollRuns) {
  const el = document.getElementById("attention-panel");
  if (!el) return;
  const items = [];

  const now = Date.now();
  let overdueCount = 0;
  let overdueFeeTotal = 0;
  jobs.forEach(job => {
    if (!job.ready_at || job.collected_at || !["Ready for Pickup", "Unclaimed"].includes(job.status)) return;
    const graceEnd = new Date(job.ready_at).getTime() + PARKING_GRACE_DAYS * 86400000;
    if (now <= graceEnd) return;
    overdueCount += 1;
    overdueFeeTotal += (Math.floor((now - graceEnd) / 86400000) + 1) * PARKING_FEE_PER_DAY;
  });
  if (overdueCount > 0) {
    items.push({
      level: "urgent", icon: "alarm-clock", href: "pages/repairs.html?status=Unclaimed",
      text: `${overdueCount} vehicle${overdueCount === 1 ? "" : "s"} overdue for pickup — ~$${overdueFeeTotal.toFixed(2)} in accrued parking fees`,
    });
  }

  const lowStock = parts.filter(p => Number(p.quantity_in_stock) < 3);
  if (lowStock.length > 0) {
    items.push({
      level: "warning", icon: "package-x", href: "pages/shop.html",
      text: `${lowStock.length} part${lowStock.length === 1 ? "" : "s"} low on stock`,
    });
  }

  const receiptedJobIds = new Set(receipts.map(r => r.repair_job_id).filter(Boolean));
  const pendingReceipts = jobs.filter(job => ["Ready for Pickup", "Unclaimed"].includes(job.status) && !receiptedJobIds.has(job.id));
  if (pendingReceipts.length > 0) {
    items.push({
      level: "warning", icon: "file-clock", href: "pages/receipts.html",
      text: `${pendingReceipts.length} completed job${pendingReceipts.length === 1 ? "" : "s"} awaiting a receipt`,
    });
  }

  const now2 = new Date();
  const dueDate = lastFridayOfMonth(now2.getFullYear(), now2.getMonth());
  const processed = payrollRuns.some(r => r.year === now2.getFullYear() && r.month === now2.getMonth() + 1);
  if (!processed && now2 >= dueDate) {
    items.push({
      level: "urgent", icon: "banknote", href: "pages/analytics.html",
      text: `Payroll for ${now2.toLocaleString("default", { month: "long" })} is due and hasn't been processed`,
    });
  }

  el.innerHTML = items.length
    ? items.map(item => `
      <a class="attention-item ${item.level}" href="${item.href}">
        <span class="attention-item__label"><i class="attention-item__icon" data-lucide="${item.icon}"></i>${escapeHtml(item.text)}</span>
        <i data-lucide="chevron-right" style="width:16px;height:16px;color:var(--text-muted);"></i>
      </a>
    `).join("")
    : `<div class="attention-empty"><i data-lucide="check-circle-2" style="width:16px;height:16px;vertical-align:middle;margin-right:6px;"></i>All caught up — nothing urgent right now.</div>`;
}

function renderRecentJobs(jobs) {
  if (!recentJobsBody) return;
  if (!jobs.length) {
    recentJobsBody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted)">No jobs yet</td></tr>`;
    return;
  }

  recentJobsBody.innerHTML = jobs.map(job => {
    const vehicle = [job.vehicles?.year, job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" ");
    return `
      <tr>
        <td>#${String(job.job_number).padStart(4, "0")}</td>
        <td>${escapeHtml(job.customers?.full_name ?? "—")}</td>
        <td>${escapeHtml(vehicle || "—")}</td>
        <td>${escapeHtml(job.status)}</td>
        <td>$${Number(job.total_cost ?? 0).toFixed(2)}</td>
      </tr>
    `;
  }).join("");
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

// ---- Global search ----
// Shop-scale data volumes here are small (tens to low hundreds of rows),
// so the working set is fetched once on first use and filtered client-side
// rather than round-tripping a query per keystroke.
let globalSearchCache = null;
async function loadGlobalSearchCache() {
  if (globalSearchCache) return globalSearchCache;
  const [customers, jobs, quotations, suppliers] = await Promise.all([
    getData("customers", supabase.from("customers").select("id, full_name, phone").order("full_name")),
    getData("jobs", supabase.from("repair_jobs").select(`
      id, job_number, status, customers ( full_name ), vehicles ( make, model, license_plate )
    `).order("created_at", { ascending: false }).limit(300)),
    getData("quotations", supabase.from("quotations").select(`
      id, quotation_number, walk_in_name, customers ( full_name )
    `).order("created_at", { ascending: false }).limit(300)),
    getData("suppliers", supabase.from("suppliers").select("id, name, phone").order("name")),
  ]);
  globalSearchCache = { customers, jobs, quotations, suppliers };
  return globalSearchCache;
}

function matches(term, ...fields) {
  const t = term.toLowerCase();
  return fields.some(f => f && String(f).toLowerCase().includes(t));
}

function searchResultItem({ href, icon, main, sub }) {
  return `
    <a class="global-search__item" href="${href}">
      <i data-lucide="${icon}"></i>
      <span>
        <span class="global-search__item-main">${escapeHtml(main)}</span>
        ${sub ? `<span class="global-search__item-sub"> — ${escapeHtml(sub)}</span>` : ""}
      </span>
    </a>`;
}

async function runGlobalSearch(term, resultsEl) {
  const { customers, jobs, quotations, suppliers } = await loadGlobalSearchCache();

  const customerHits = customers.filter(c => matches(term, c.full_name, c.phone)).slice(0, 6);
  const jobHits = jobs.filter(j => matches(
    term,
    String(j.job_number).padStart(4, "0"),
    j.customers?.full_name,
    j.vehicles?.license_plate,
    j.vehicles?.make,
    j.vehicles?.model,
  )).slice(0, 6);
  const quoteHits = quotations.filter(q => matches(
    term,
    String(q.quotation_number),
    q.walk_in_name,
    q.customers?.full_name,
  )).slice(0, 6);
  const supplierHits = suppliers.filter(s => matches(term, s.name, s.phone)).slice(0, 6);

  const groups = [];
  if (customerHits.length) groups.push({
    label: "Customers",
    items: customerHits.map(c => searchResultItem({
      href: `pages/customers.html?highlight=${c.id}`, icon: "user",
      main: c.full_name, sub: c.phone,
    })),
  });
  if (jobHits.length) groups.push({
    label: "Job Cards",
    items: jobHits.map(j => {
      const vehicle = [j.vehicles?.make, j.vehicles?.model, j.vehicles?.license_plate].filter(Boolean).join(" ");
      return searchResultItem({
        href: `pages/repairs.html?highlight=${j.id}`, icon: "clipboard-list",
        main: `#${String(j.job_number).padStart(4, "0")} — ${j.customers?.full_name ?? "Unknown customer"}`,
        sub: [vehicle, j.status].filter(Boolean).join(" · "),
      });
    }),
  });
  if (quoteHits.length) groups.push({
    label: "Quotations",
    items: quoteHits.map(q => searchResultItem({
      href: `pages/quotations.html?highlight=${q.id}`, icon: "file-text",
      main: `Quote #${q.quotation_number}`,
      sub: q.customers?.full_name ?? q.walk_in_name ?? "Walk-in",
    })),
  });
  if (supplierHits.length) groups.push({
    label: "Suppliers",
    items: supplierHits.map(s => searchResultItem({
      href: `pages/suppliers.html?highlight=${s.id}`, icon: "truck",
      main: s.name, sub: s.phone,
    })),
  });

  resultsEl.innerHTML = groups.length
    ? groups.map(g => `<div class="global-search__group-label">${g.label}</div>${g.items.join("")}`).join("")
    : `<div class="global-search__empty">No matches for "${escapeHtml(term)}"</div>`;
  resultsEl.hidden = false;
  if (window.lucide) lucide.createIcons();
}

function initGlobalSearch() {
  const input = document.getElementById("global-search-input");
  const resultsEl = document.getElementById("global-search-results");
  if (!input || !resultsEl) return;

  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const term = input.value.trim();
    if (term.length < 2) { resultsEl.hidden = true; resultsEl.innerHTML = ""; return; }
    debounceTimer = setTimeout(() => runGlobalSearch(term, resultsEl), 250);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 2) resultsEl.hidden = false;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".global-search")) resultsEl.hidden = true;
  });
}

function initSidebarToggle() {
  const sidebar = document.querySelector(".sidebar");
  const main = document.querySelector(".main");
  if (!sidebar || !main || document.querySelector(".sidebar-toggle")) return;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sidebar-toggle";
  toggle.setAttribute("aria-label", "Open navigation");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<i data-lucide="menu"></i>';
  document.body.appendChild(toggle);

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "sidebar-backdrop";
  backdrop.setAttribute("aria-label", "Close navigation");
  document.body.appendChild(backdrop);

  const setOpen = (open) => {
    document.body.classList.toggle("sidebar-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };

  toggle.addEventListener("click", () => setOpen(!document.body.classList.contains("sidebar-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll("a").forEach(link => link.addEventListener("click", () => setOpen(false)));
  if (window.lucide) lucide.createIcons();
}

// ---- Sidebar categories (collapsible, remembered per browser) ----
const NAV_STATE_KEY = "apr-nav-open";
function readNavState() {
  try { return JSON.parse(localStorage.getItem(NAV_STATE_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function initNavGroups() {
  const state = readNavState();
  document.querySelectorAll(".sidebar .nav-group").forEach(group => {
    const key = group.dataset.group;
    const button = group.querySelector(".nav-grp");
    const hasActive = !!group.querySelector("a.nav-link.active");
    const setOpen = (open) => {
      group.classList.toggle("open", open);
      button?.setAttribute("aria-expanded", String(open));
    };
    setOpen(key in state ? !!state[key] : hasActive);
    button?.addEventListener("click", () => {
      const open = !group.classList.contains("open");
      setOpen(open);
      const next = readNavState();
      next[key] = open;
      try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(next)); } catch (e) {}
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initNavGroups();
  initSidebarToggle();
  if (recentJobsBody) loadDashboard();
});