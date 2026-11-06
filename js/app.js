import supabase from "./supabaseClient.js";
import { hydrate } from "./data-cache.js";
import "./ui-state.js";

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

async function fetchDashboardBundle() {
  const [jobs, customers, parts, receipts, payrollRuns, settingsRows] = await Promise.all([
    getData("repair jobs", supabase.from("repair_jobs").select(`
      id, job_number, status, total_cost, created_at, completed_at, ready_at, collected_at,
      customers ( full_name ),
      vehicles ( make, model, year, license_plate )
    `).order("created_at", { ascending: false })),
    getData("customers", supabase.from("customers").select("id, created_at").is("deleted_at", null)),
    getData("parts", supabase.from("parts").select("id, name, category, quantity_in_stock, minimum_stock")),
    getData("receipts", supabase.from("receipts").select("id, amount, issued_at, repair_job_id, voided_at")),
    getData("payroll runs", supabase.from("payroll_runs").select("year, month").order("year", { ascending: false }).order("month", { ascending: false }).limit(1)),
    getData("settings", supabase.from("settings").select("daily_jobs_target, daily_revenue_target").limit(1)),
  ]);
  return { jobs, customers, parts, receipts, payrollRuns, settings: settingsRows[0] };
}

async function loadDashboard() {
  const todayStr = new Date().toISOString().slice(0, 10);

  renderGreeting();

  // Renders instantly from whatever's cached (from sign-in's prefetch, or a
  // previous visit this session), then refreshes from the network in the
  // background — so arriving here never shows a blank screen if the data
  // was already loaded moments ago.
  await hydrate("dash:bundle", fetchDashboardBundle, (bundle) => {
    const snapshot = renderTodaySnapshot(bundle.jobs, bundle.customers, bundle.receipts, todayStr);
    renderObjectives(snapshot, bundle.settings);
    renderNeedsAttention(bundle.jobs, bundle.parts, bundle.receipts, bundle.payrollRuns);
    renderRecentJobs(bundle.jobs.slice(0, 10), bundle.receipts);
    if (window.lucide) lucide.createIcons();
  });
}

function refreshAfterDocumentChange() {
  loadDashboard().catch(error => console.error("Couldn't refresh dashboard totals:", error));
}

addEventListener("storage", event => {
  if (event.key === "apr:data-changed") refreshAfterDocumentChange();
});

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
  const revenueToday = receipts.filter(r => !r.voided_at && isToday(r.issued_at)).reduce((sum, r) => sum + Number(r.amount || 0), 0);
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
    if (!job.ready_at || job.collected_at || !["Processed", "Ready for Pickup", "Unclaimed"].includes(job.status)) return;
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

  const lowStock = parts.filter(p => Number(p.minimum_stock || 0) > 0 && Number(p.quantity_in_stock || 0) <= Number(p.minimum_stock) * 0.1);
  if (lowStock.length > 0) {
    const categories = [...new Set(lowStock.map(part => part.category || "Uncategorised"))];
    items.push({
      level: "warning", icon: "package-x", href: "pages/shop.html",
      text: `Low-stock alert (10% of minimum) — ${categories.join(", ")}: ${lowStock.length} part${lowStock.length === 1 ? "" : "s"}`,
    });
  }

  const receiptedJobIds = new Set(receipts.filter(receipt => !receipt.voided_at).map(r => r.repair_job_id).filter(Boolean));
  const pendingReceipts = jobs.filter(job => ["Processed", "Ready for Pickup", "Unclaimed"].includes(job.status) && !receiptedJobIds.has(job.id));
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

function renderRecentJobs(jobs, receipts = []) {
  if (!recentJobsBody) return;
  if (!jobs.length) {
    recentJobsBody.innerHTML = `<tr><td colspan="6"><div class="apr-state apr-state--empty"><div class="apr-state__icon"><i data-lucide="clipboard-plus"></i></div><div class="apr-state__copy"><strong>No job cards yet</strong><p>Create the first job card to start tracking work.</p></div><a class="btn apr-state__action" href="pages/repairs.html">Open job cards</a></div></td></tr>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const statusMeta = {
    Draft: ["file-pen-line", "draft", "Draft"],
    Processing: ["loader-circle", "processing", "Processing"],
    Received: ["inbox", "received", "Received"],
    Diagnosing: ["stethoscope", "diagnosing", "Diagnosing"],
    Processed: ["package-check", "processed", "Processed"],
    "Ready for Pickup": ["package-check", "waiting", "Waiting for Pickup"],
    Unclaimed: ["triangle-alert", "unclaimed", "Unclaimed"],
    Collected: ["circle-check", "collected", "Collected"],
  };
  const paidByJob = new Map();
  receipts.filter(receipt => !receipt.voided_at).forEach(receipt => {
    if (!receipt.repair_job_id) return;
    paidByJob.set(receipt.repair_job_id, (paidByJob.get(receipt.repair_job_id) || 0) + Number(receipt.amount || 0));
  });
  recentJobsBody.innerHTML = jobs.map(job => {
    const vehicle = [job.vehicles?.year, job.vehicles?.make, job.vehicles?.model].filter(Boolean).join(" ");
    const [icon, statusClass, statusLabel] = statusMeta[job.status] || ["circle-help", "other", job.status || "Unknown"];
    const canPay = job.status !== "Collected" && Number(job.total_cost || 0) - (paidByJob.get(job.id) || 0) > 0.01;
    const openHref = `pages/repairs.html?highlight=${encodeURIComponent(job.id)}${canPay ? "&payment=1" : ""}`;
    return `
      <tr>
        <td>#${String(job.job_number).padStart(4, "0")}</td>
        <td>${escapeHtml(job.customers?.full_name ?? "—")}</td>
        <td>${escapeHtml(vehicle || "—")}</td>
        <td><span class="job-status-badge status-${statusClass}"><i data-lucide="${icon}"></i>${escapeHtml(statusLabel)}</span></td>
        <td>$${Number(job.total_cost ?? 0).toFixed(2)}</td>
        <td class="recent-job-action"><a href="${openHref}"><i data-lucide="${canPay ? "credit-card" : "eye"}"></i>${canPay ? "View / Pay" : "View"}</a></td>
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
    getData("customers", supabase.from("customers").select("id, full_name, phone").is("deleted_at", null).order("full_name")),
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
  const pagePrefix = window.location.pathname.includes("/pages/") ? "../" : "";
  if (customerHits.length) groups.push({
    label: "Customers",
    items: customerHits.map(c => searchResultItem({
      href: `${pagePrefix}pages/customers.html?highlight=${c.id}`, icon: "user",
      main: c.full_name, sub: c.phone,
    })),
  });
  if (jobHits.length) groups.push({
    label: "Job Cards",
    items: jobHits.map(j => {
      const vehicle = [j.vehicles?.make, j.vehicles?.model, j.vehicles?.license_plate].filter(Boolean).join(" ");
      return searchResultItem({
        href: `${pagePrefix}pages/repairs.html?highlight=${j.id}`, icon: "clipboard-list",
        main: `#${String(j.job_number).padStart(4, "0")} — ${j.customers?.full_name ?? "Unknown customer"}`,
        sub: [vehicle, j.status].filter(Boolean).join(" · "),
      });
    }),
  });
  if (quoteHits.length) groups.push({
    label: "Quotations",
    items: quoteHits.map(q => searchResultItem({
      href: `${pagePrefix}pages/quotations.html?highlight=${q.id}`, icon: "file-text",
      main: `Quote #${q.quotation_number}`,
      sub: q.customers?.full_name ?? q.walk_in_name ?? "Walk-in",
    })),
  });
  if (supplierHits.length) groups.push({
    label: "Suppliers",
    items: supplierHits.map(s => searchResultItem({
      href: `${pagePrefix}pages/suppliers.html?highlight=${s.id}`, icon: "truck",
      main: s.name, sub: s.phone,
    })),
  });

  resultsEl.innerHTML = groups.length
    ? groups.map(g => `<div class="global-search__group-label">${g.label}</div>${g.items.join("")}`).join("")
    : `<div class="apr-state apr-state--search"><div class="apr-state__icon"><i data-lucide="search-x"></i></div><div class="apr-state__copy"><strong>No results for "${escapeHtml(term)}"</strong><p>Check the spelling, try a vehicle registration or phone number, or use fewer words.</p></div></div>`;
  resultsEl.hidden = false;
  if (window.lucide) lucide.createIcons();
}

function initGlobalSearch() {
  if (!document.getElementById("global-search-input") && document.getElementById("hs-results")) return;
  let input = document.getElementById("global-search-input") || document.getElementById("hs-input");
  let wrapper;
  if (!input) {
    const header = document.querySelector("body.dashboard-page .site-masthead, body.dashboard-page .app-header, body.dashboard-page .main__header");
    if (!header) return;
    wrapper = document.createElement("div");
    wrapper.className = "global-search apr-global-search";
    wrapper.innerHTML = `<label class="sr-only" for="global-search-input">Search the whole system</label><input id="global-search-input" type="search" placeholder="Search customers, job cards, quotations and suppliers…" autocomplete="off"><div class="global-search__results apr-global-search-results" id="global-search-results" hidden></div>`;
    header.append(wrapper);
    input = wrapper.querySelector("input");
  }
  wrapper = wrapper || input.closest(".global-search") || input.closest(".hs") || input.parentElement;
  let resultsEl = document.getElementById("global-search-results");
  if (!resultsEl) {
    resultsEl = document.createElement("div");
    resultsEl.id = "global-search-results";
    resultsEl.className = "global-search__results apr-global-search-results";
    resultsEl.hidden = true;
    wrapper.append(resultsEl);
  }
  wrapper.classList.add("apr-global-search");

  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const term = input.value.trim();
    if (term.length < 2) { resultsEl.hidden = true; resultsEl.innerHTML = ""; return; }
    resultsEl.innerHTML = `<div class="apr-state apr-state--loading"><div class="apr-state__icon"><i data-lucide="loader-circle"></i></div><div class="apr-state__copy"><strong>Searching</strong><p>Checking customers, job cards, quotations, and suppliers…</p></div></div>`;
    resultsEl.hidden = false;
    debounceTimer = setTimeout(() => {
      runGlobalSearch(term, resultsEl).catch(error => {
        console.error("Global search failed:", error);
        resultsEl.innerHTML = `<div class="apr-state apr-state--error" role="alert"><div class="apr-state__icon"><i data-lucide="triangle-alert"></i></div><div class="apr-state__copy"><strong>Search could not finish</strong><p>${escapeHtml(error.message || String(error))} Check your internet connection, then retry the search.</p></div></div>`;
        resultsEl.hidden = false;
      });
    }, 250);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 2) resultsEl.hidden = false;
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".apr-global-search")) resultsEl.hidden = true;
  });
}

// ---- Sidebar categories (collapsible, remembered per browser) ----
const NAV_STATE_KEY = "apr-nav-open";
function readNavState() {
  try { return JSON.parse(localStorage.getItem(NAV_STATE_KEY) || "{}") || {}; } catch (e) { return {}; }
}
function initNavGroups() {
  if (document.querySelector(".sidebar")?.dataset.dashboardCanonical === "true") return;
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
  initGlobalSearch();
  if (recentJobsBody) loadDashboard();
});