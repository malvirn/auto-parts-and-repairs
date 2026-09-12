import supabase from "./supabaseClient.js";

const summaryCards = document.getElementById("summary-cards");
const mechanicBoard = document.getElementById("mechanic-leaderboard");
const partsBoard = document.getElementById("parts-leaderboard");
const turnaroundStat = document.getElementById("turnaround-stat");
let revenueChart = null;

async function loadAnalytics() {
  const { data: jobs, error: jobsError } = await supabase
    .from("repair_jobs")
    .select(`
      id, status, total_cost, parts_cost, labour_cost, created_at, completed_at, technician_id,
      technicians ( full_name )
    `);

  const { data: jobParts, error: partsError } = await supabase
    .from("job_parts")
    .select("part_name, quantity, price_at_time");

  if (jobsError || partsError) {
    console.error("Analytics load error:", jobsError || partsError);
    return;
  }

  renderSummary(jobs);
  renderRevenueChart(jobs);
  renderMechanicLeaderboard(jobs);
  renderPartsLeaderboard(jobParts);
  renderTurnaround(jobs);
}

function renderSummary(jobs) {
  const finished = jobs.filter(j => ["Completed", "Collected"].includes(j.status));
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
        if (!["Completed", "Collected"].includes(j.status) || !j.completed_at) return false;
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
    if (!["Completed", "Collected"].includes(j.status) || !j.technician_id) return;
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
  const finished = jobs.filter(j => ["Completed", "Collected"].includes(j.status) && j.created_at && j.completed_at);
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", loadAnalytics);