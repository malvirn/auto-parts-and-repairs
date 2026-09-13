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

  const [jobs, customers, parts, receipts, payrollRuns] = await Promise.all([
    getData("repair jobs", supabase.from("repair_jobs").select(`
      id, job_number, status, total_cost, created_at, completed_at, ready_at, collected_at,
      customers ( full_name ),
      vehicles ( make, model, year, license_plate )
    `).order("created_at", { ascending: false })),
    getData("customers", supabase.from("customers").select("id, created_at")),
    getData("parts", supabase.from("parts").select("id, name, quantity_in_stock")),
    getData("receipts", supabase.from("receipts").select("id, amount, issued_at, repair_job_id")),
    getData("payroll runs", supabase.from("payroll_runs").select("year, month").order("year", { ascending: false }).order("month", { ascending: false }).limit(1)),
  ]);

  renderGreeting();
  renderTodaySnapshot(jobs, customers, receipts, todayStr);
  renderNeedsAttention(jobs, parts, receipts, payrollRuns);
  renderRecentJobs(jobs.slice(0, 10));

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

document.addEventListener("DOMContentLoaded", () => {
  initSidebarToggle();
  if (recentJobsBody) loadDashboard();
});