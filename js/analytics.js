import supabase from "./supabaseClient.js";

// "Ready for Pickup" absorbed the old "Completed" status months ago, and
// "Unclaimed" is also a finished job (just uncollected) — this file was
// still checking for "Completed", which no new job can ever have, so
// revenue/profit/leaderboards here were silently showing wrong numbers.
const FINISHED = ["Ready for Pickup", "Collected", "Unclaimed"];

const summaryCards = document.getElementById("summary-cards");
const operationsCards = document.getElementById("operations-cards");
const managerCards = document.getElementById("manager-cards");
const financialCards = document.getElementById("financial-cards");
const mechanicBoard = document.getElementById("mechanic-leaderboard");
const partsBoard = document.getElementById("parts-leaderboard");
const turnaroundStat = document.getElementById("turnaround-stat");
let revenueChart = null;
let payrollChart = null;

async function loadAnalytics() {
  const [jobsRes, jobPartsRes, customersRes, techniciansRes, partsRes, receiptsRes, payrollRunsRes] = await Promise.all([
    supabase.from("repair_jobs").select(`id, status, total_cost, parts_cost, labour_cost, created_at, completed_at, technician_id, technicians ( full_name )`),
    supabase.from("job_parts").select("part_name, quantity, price_at_time"),
    supabase.from("customers").select("id"),
    supabase.from("technicians").select("id, full_name, department, is_active, salary, deductions"),
    supabase.from("parts").select("id, quantity_in_stock, cost_price, selling_price"),
    supabase.from("receipts").select("id, amount, issued_at, repair_job_id"),
    supabase.from("payroll_runs").select("id, year, month, pay_date, total_amount, processed_at").order("year", { ascending: false }).order("month", { ascending: false }).limit(6),
  ]);

  if (jobsRes.error || jobPartsRes.error) {
    console.error("Analytics load error:", jobsRes.error || jobPartsRes.error);
    return;
  }

  const jobs = jobsRes.data || [];
  const jobParts = jobPartsRes.data || [];
  const customers = customersRes.data || [];
  const technicians = techniciansRes.data || [];
  const parts = partsRes.data || [];
  const receipts = receiptsRes.data || [];
  const payrollRuns = (payrollRunsRes.data || []).slice().reverse(); // oldest→newest for charting

  const mechanics = technicians.filter(t => t.department === "Mechanics");

  renderSummary(jobs);
  renderOperationsCards(jobs, customers);
  renderManagerCards(jobs, mechanics, parts, receipts);
  renderFinancialCards(jobs, parts, receipts, payrollRuns);
  renderRevenueChart(jobs);
  renderMechanicLeaderboard(jobs);
  renderPartsLeaderboard(jobParts);
  renderTurnaround(jobs);
  renderPayrollChart(payrollRuns);
  renderPayrollHistory(payrollRuns);
  await loadPayrollSection(technicians);
  if (window.lucide) lucide.createIcons();
}

function renderSummary(jobs) {
  const finished = jobs.filter(j => FINISHED.includes(j.status));
  const revenue = finished.reduce((s, j) => s + Number(j.total_cost || 0), 0);
  const cost = finished.reduce((s, j) => s + Number(j.parts_cost || 0), 0);
  const profit = revenue - cost;
  const jobCount = jobs.length;

  summaryCards.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Total Revenue</div><div class="stat-card__value">$${revenue.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Total Parts Cost</div><div class="stat-card__value">$${cost.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Profit</div><div class="stat-card__value">$${profit.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Total Jobs</div><div class="stat-card__value">${jobCount}</div></div>
  `;
}

function renderOperationsCards(jobs, customers) {
  const active = jobs.filter(j => !FINISHED.includes(j.status));
  const awaitingParts = jobs.filter(j => j.status === "Awaiting Parts").length;
  const readyForPickup = jobs.filter(j => j.status === "Ready for Pickup").length;

  operationsCards.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Active Jobs</div><div class="stat-card__value">${active.length}</div></div>
    <div class="stat-card"><div class="stat-card__label">Awaiting Parts</div><div class="stat-card__value">${awaitingParts}</div></div>
    <div class="stat-card"><div class="stat-card__label">Ready for Pickup</div><div class="stat-card__value">${readyForPickup}</div></div>
    <div class="stat-card"><div class="stat-card__label">Total Customers</div><div class="stat-card__value">${customers.length}</div></div>
  `;
}

function renderManagerCards(jobs, mechanics, parts, receipts) {
  const finished = jobs.filter(j => FINISHED.includes(j.status));
  const receiptedJobIds = new Set(receipts.map(r => r.repair_job_id).filter(Boolean));
  const outstandingJobs = finished.filter(j => !receiptedJobIds.has(j.id)).length;
  const revenue = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  const labour = jobs.reduce((s, j) => s + Number(j.labour_cost || 0), 0);
  const lowStock = parts.filter(p => Number(p.quantity_in_stock) < 3).length;
  const activeMechanics = mechanics.filter(m => m.is_active !== false).length;

  managerCards.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Active Mechanics</div><div class="stat-card__value">${activeMechanics}</div></div>
    <div class="stat-card"><div class="stat-card__label">Low Stock Parts</div><div class="stat-card__value">${lowStock}</div></div>
    <div class="stat-card"><div class="stat-card__label">Outstanding Payments</div><div class="stat-card__value">${outstandingJobs}</div></div>
    <div class="stat-card"><div class="stat-card__label">Revenue</div><div class="stat-card__value">$${revenue.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Labour Billed</div><div class="stat-card__value">$${labour.toFixed(2)}</div></div>
  `;
}

function renderFinancialCards(jobs, parts, receipts, payrollRuns) {
  const finished = jobs.filter(j => FINISHED.includes(j.status));
  const billed = finished.reduce((s, j) => s + Number(j.total_cost || 0), 0);
  const collected = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  const outstandingAmount = Math.max(0, billed - collected);
  const partsCost = finished.reduce((s, j) => s + Number(j.parts_cost || 0), 0);
  const inventoryValue = parts.reduce((s, p) => s + Number(p.quantity_in_stock || 0) * Number(p.cost_price || 0), 0);
  const grossProfit = billed - partsCost;

  const now = new Date();
  const thisMonthRun = payrollRuns.find(r => r.year === now.getFullYear() && r.month === now.getMonth() + 1);
  const payrollThisMonth = thisMonthRun ? Number(thisMonthRun.total_amount) : 0;
  const netProfit = grossProfit - payrollThisMonth;

  financialCards.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Receipts Issued</div><div class="stat-card__value">${receipts.length}</div></div>
    <div class="stat-card"><div class="stat-card__label">Billed</div><div class="stat-card__value">$${billed.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Collected</div><div class="stat-card__value">$${collected.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Outstanding</div><div class="stat-card__value">$${outstandingAmount.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Inventory Value (cost)</div><div class="stat-card__value">$${inventoryValue.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Gross Profit</div><div class="stat-card__value">$${grossProfit.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Payroll (this month)</div><div class="stat-card__value">$${payrollThisMonth.toFixed(2)}</div>${!thisMonthRun ? '<div style="font-size:.72rem;color:var(--text-muted);">Not yet processed</div>' : ""}</div>
    <div class="stat-card"><div class="stat-card__label">Net Profit (after payroll)</div><div class="stat-card__value">$${netProfit.toFixed(2)}</div></div>
  `;
}

function renderRevenueChart(jobs) {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleString("default", { month: "short", year: "2-digit" }), month: d.getMonth(), year: d.getFullYear() });
  }

  const revenueByMonth = months.map(m => {
    return jobs
      .filter(j => {
        if (!FINISHED.includes(j.status) || !j.completed_at) return false;
        const d = new Date(j.completed_at);
        return d.getMonth() === m.month && d.getFullYear() === m.year;
      })
      .reduce((sum, j) => sum + Number(j.total_cost || 0), 0);
  });

  const ctx = document.getElementById("revenue-chart");
  if (revenueChart) revenueChart.destroy();
  revenueChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: months.map(m => m.label),
      datasets: [{
        label: "Revenue ($)",
        data: revenueByMonth,
        borderColor: "#c0522d",
        backgroundColor: "rgba(192,82,45,0.1)",
        fill: true,
        tension: 0.3,
      }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}

function renderMechanicLeaderboard(jobs) {
  const stats = {};
  jobs.forEach(j => {
    if (!FINISHED.includes(j.status) || !j.technician_id) return;
    const name = j.technicians?.full_name || "Unassigned";
    if (!stats[name]) stats[name] = { count: 0, revenue: 0 };
    stats[name].count += 1;
    stats[name].revenue += Number(j.total_cost || 0);
  });

  const sorted = Object.entries(stats).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);

  if (sorted.length === 0) {
    mechanicBoard.innerHTML = `<div style="color:var(--text-muted)">No completed jobs yet</div>`;
    return;
  }

  mechanicBoard.innerHTML = sorted.map(([name, s], i) => `
    <div class="leaderboard-row">
      <span><span class="rank-badge">${i + 1}</span>${escapeHtml(name)}</span>
      <span>${s.count} jobs — $${s.revenue.toFixed(2)}</span>
    </div>
  `).join("");
}

function renderPartsLeaderboard(jobParts) {
  const stats = {};
  (jobParts || []).forEach(jp => {
    if (!stats[jp.part_name]) stats[jp.part_name] = { qty: 0, revenue: 0 };
    stats[jp.part_name].qty += jp.quantity;
    stats[jp.part_name].revenue += jp.quantity * Number(jp.price_at_time || 0);
  });

  const sorted = Object.entries(stats).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

  if (sorted.length === 0) {
    partsBoard.innerHTML = `<div style="color:var(--text-muted)">No parts sold yet</div>`;
    return;
  }

  partsBoard.innerHTML = sorted.map(([name, s], i) => `
    <div class="leaderboard-row">
      <span><span class="rank-badge">${i + 1}</span>${escapeHtml(name)}</span>
      <span>${s.qty} sold — $${s.revenue.toFixed(2)}</span>
    </div>
  `).join("");
}

function renderTurnaround(jobs) {
  const finished = jobs.filter(j => FINISHED.includes(j.status) && j.created_at && j.completed_at);
  if (finished.length === 0) {
    turnaroundStat.textContent = "—";
    return;
  }
  const totalDays = finished.reduce((sum, j) => {
    const days = (new Date(j.completed_at) - new Date(j.created_at)) / (1000 * 60 * 60 * 24);
    return sum + days;
  }, 0);
  turnaroundStat.textContent = `${(totalDays / finished.length).toFixed(1)} days`;
}

// ---------- Payroll ----------
// Salaries paid out are a real, separate expense from "labour billed" (what
// customers pay for labour on a job) — this section tracks the former.

function lastFridayOfMonth(year, month) {
  // month is 0-indexed (JS Date convention)
  const lastDay = new Date(year, month + 1, 0);
  const offset = (lastDay.getDay() - 5 + 7) % 7; // 5 = Friday
  lastDay.setDate(lastDay.getDate() - offset);
  return lastDay;
}

async function loadPayrollSection(technicians) {
  const now = new Date();
  const dueDate = lastFridayOfMonth(now.getFullYear(), now.getMonth());
  document.getElementById("payroll-due-date").textContent =
    dueDate.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const { data: existingRun } = await supabase
    .from("payroll_runs")
    .select("id, total_amount, processed_at")
    .eq("year", now.getFullYear())
    .eq("month", now.getMonth() + 1)
    .maybeSingle();

  const banner = document.getElementById("payroll-banner");
  const note = document.getElementById("payroll-due-note");
  const btn = document.getElementById("process-payroll-btn");

  if (existingRun) {
    banner.classList.add("processed");
    note.textContent = `Processed ${new Date(existingRun.processed_at).toLocaleDateString()} — $${Number(existingRun.total_amount).toFixed(2)} paid out.`;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="check"></i> Already Processed`;
  } else {
    banner.classList.remove("processed");
    note.textContent = `Payroll for ${now.toLocaleString("default", { month: "long" })} hasn't been processed yet.`;
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="banknote"></i> Process This Month's Payroll`;
    btn.onclick = () => processPayroll(technicians, now.getFullYear(), now.getMonth() + 1, dueDate);
  }
  if (window.lucide) lucide.createIcons();
}

async function processPayroll(technicians, year, month, payDate) {
  const active = technicians.filter(t => t.is_active !== false);
  if (!active.length) { alert("No active employees to pay."); return; }
  if (!confirm(`Process payroll for ${active.length} active employee(s), payable ${payDate.toLocaleDateString()}? This can't be undone from here.`)) return;

  const payments = active.map(t => {
    const gross = Number(t.salary || 0);
    const deductions = Number(t.deductions || 0);
    return {
      employee_id: t.id, employee_name: t.full_name, department: t.department,
      gross_salary: gross, deductions, net_pay: Math.max(0, gross - deductions),
    };
  });
  const total = payments.reduce((sum, p) => sum + p.net_pay, 0);

  const { data: run, error } = await supabase
    .from("payroll_runs")
    .insert([{ year, month, pay_date: payDate.toISOString().slice(0, 10), total_amount: total }])
    .select().single();
  if (error) { alert("Failed to process payroll: " + error.message); return; }

  const { error: paymentsError } = await supabase
    .from("payroll_payments")
    .insert(payments.map(p => ({ ...p, payroll_run_id: run.id })));
  if (paymentsError) { alert("Payroll run was created, but individual payment records failed to save: " + paymentsError.message); return; }

  alert(`Payroll processed — $${total.toFixed(2)} across ${payments.length} employee(s).`);
  loadAnalytics();
}

function renderPayrollChart(payrollRuns) {
  const labels = payrollRuns.map(r => new Date(r.year, r.month - 1, 1).toLocaleString("default", { month: "short", year: "2-digit" }));
  const data = payrollRuns.map(r => Number(r.total_amount));
  const ctx = document.getElementById("payroll-chart");
  if (payrollChart) payrollChart.destroy();
  payrollChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Payroll ($)", data, backgroundColor: "#c0522d" }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}

function renderPayrollHistory(payrollRuns) {
  const el = document.getElementById("payroll-history");
  if (!payrollRuns.length) { el.innerHTML = `<div style="color:var(--text-muted)">No payroll runs yet</div>`; return; }
  el.innerHTML = [...payrollRuns].reverse().map(r => `
    <div class="leaderboard-row">
      <span>${new Date(r.year, r.month - 1, 1).toLocaleString("default", { month: "long", year: "numeric" })}</span>
      <span>$${Number(r.total_amount).toFixed(2)} · paid ${new Date(r.pay_date).toLocaleDateString()}</span>
    </div>
  `).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", loadAnalytics);