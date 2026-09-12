import supabase from "./supabaseClient.js";

const recentJobsBody = document.getElementById("recent-jobs");

const dashboard = {
  active: document.querySelector('[data-status="active"] .stat-card__value'),
  awaitingParts: document.querySelector('[data-status="Awaiting Parts"] .stat-card__value'),
  readyForPickup: document.querySelector('[data-status="Ready for Pickup"] .stat-card__value'),
  completedMonth: document.querySelector('[data-status="completed-month"] .stat-card__value'),
  customers: document.getElementById("customer-count"),
  mechanics: document.getElementById("mechanic-count"),
  lowStock: document.getElementById("low-stock-count"),
  outstanding: document.getElementById("outstanding-count"),
  revenue: document.getElementById("revenue-total"),
  partsCost: document.getElementById("parts-cost-total"),
  profit: document.getElementById("profit-total"),
  billed: document.getElementById("billed-total"),
  collected: document.getElementById("collected-total"),
  outstandingTotal: document.getElementById("outstanding-total"),
  inventoryValue: document.getElementById("inventory-value"),
  grossProfit: document.getElementById("gross-profit-total"),
  collectionRate: document.getElementById("collection-rate"),
  averageInvoice: document.getElementById("average-invoice"),
  monthlyReceipts: document.getElementById("monthly-receipts"),
  retailInventoryValue: document.getElementById("retail-inventory-value"),
};

async function getData(label, query) {
  const { data, error } = await query;
  if (error) {
    console.error(`Error loading ${label}:`, error);
    return [];
  }
  return data || [];
}

async function loadDashboard() {
  const [jobs, customers, mechanics, parts, receipts] = await Promise.all([
    getData("repair jobs", supabase.from("repair_jobs").select(`
      id, job_number, status, total_cost, labour_cost, parts_cost, created_at, completed_at,
      customers ( full_name ),
      vehicles ( make, model, year, license_plate )
    `).order("created_at", { ascending: false })),
    getData("customers", supabase.from("customers").select("id")),
    getData("mechanics", supabase.from("technicians").select("id, is_active")),
    getData("parts", supabase.from("parts").select("id, name, quantity_in_stock, cost_price")),
    getData("receipts", supabase.from("receipts").select("repair_job_id, amount, issued_at")),
  ]);

  renderOperationalMetrics(jobs, customers, mechanics, parts, receipts);
  renderFinancialMetrics(jobs, receipts);
  renderAccountingSummary(jobs, parts, receipts);
  renderOperationsSummary(jobs, customers, mechanics, parts);
  renderRecentJobs(jobs.slice(0, 10));

  if (window.lucide) lucide.createIcons();
}

function renderOperationalMetrics(jobs, customers, mechanics, parts, receipts) {
  const activeJobs = jobs.filter(job => !["Completed", "Collected", "Unclaimed"].includes(job.status));
  const now = new Date();
  const completedThisMonth = jobs.filter(job => {
    if (!["Completed", "Collected"].includes(job.status) || !job.completed_at) return false;
    const completedAt = new Date(job.completed_at);
    return completedAt.getMonth() === now.getMonth() && completedAt.getFullYear() === now.getFullYear();
  });
  const receiptedJobIds = new Set(receipts.map(receipt => receipt.repair_job_id));
  const outstanding = jobs.filter(job => ["Completed", "Collected"].includes(job.status) && !receiptedJobIds.has(job.id));

  setText(dashboard.active, activeJobs.length);
  setText(dashboard.awaitingParts, jobs.filter(job => job.status === "Awaiting Parts").length);
  setText(dashboard.readyForPickup, jobs.filter(job => job.status === "Ready for Pickup").length);
  setText(dashboard.completedMonth, completedThisMonth.length);
  setText(dashboard.customers, customers.length);
  setText(dashboard.mechanics, mechanics.filter(mechanic => mechanic.is_active !== false).length);
  setText(dashboard.lowStock, parts.filter(part => Number(part.quantity_in_stock) < 3).length);
  setText(dashboard.outstanding, outstanding.length);

  document.querySelectorAll(".stat-card[data-href]").forEach(card => {
    card.classList.add("is-actionable");
    card.setAttribute("role", "link");
    card.setAttribute("tabindex", "0");
    const navigate = () => { window.location.href = card.dataset.href; };
    card.addEventListener("click", navigate);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        navigate();
      }
    });
  });
}

function renderFinancialMetrics(jobs, receipts) {
  const finished = jobs.filter(job => ["Completed", "Collected"].includes(job.status));
  const revenue = receipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
  const partsCost = finished.reduce((sum, job) => sum + Number(job.parts_cost || 0), 0);
  const labour = jobs.reduce((sum, job) => sum + Number(job.labour_cost || 0), 0);
  const profit = revenue - partsCost;

  setText(dashboard.revenue, formatMoney(revenue));
  setText(dashboard.partsCost, formatMoney(partsCost));
  setText(dashboard.profit, formatMoney(profit));

  const labourCard = document.getElementById("labour-total");
  setText(labourCard, formatMoney(labour));
}

function renderAccountingSummary(jobs, parts, receipts) {
  const finished = jobs.filter(job => ["Completed", "Collected"].includes(job.status));
  const billed = finished.reduce((sum, job) => sum + Number(job.total_cost || 0), 0);
  const collected = receipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
  const outstanding = Math.max(0, billed - collected);
  const partsCost = finished.reduce((sum, job) => sum + Number(job.parts_cost || 0), 0);
  const inventoryValue = parts.reduce((sum, part) => sum + Number(part.quantity_in_stock || 0) * Number(part.cost_price || 0), 0);
  const retailInventoryValue = parts.reduce((sum, part) => sum + Number(part.quantity_in_stock || 0) * Number(part.selling_price || 0), 0);
  const grossProfit = billed - partsCost;
  const collectionRate = billed > 0 ? `${Math.min(100, (collected / billed) * 100).toFixed(1)}%` : "0.0%";
  const averageInvoice = finished.length ? billed / finished.length : 0;
  const now = new Date();
  const monthlyReceipts = receipts.filter(receipt => {
    const issuedAt = receipt.issued_at ? new Date(receipt.issued_at) : null;
    return issuedAt && issuedAt.getMonth() === now.getMonth() && issuedAt.getFullYear() === now.getFullYear();
  }).length;

  setText(dashboard.billed, formatMoney(billed));
  setText(dashboard.collected, formatMoney(collected));
  setText(dashboard.outstandingTotal, formatMoney(outstanding));
  setText(dashboard.inventoryValue, formatMoney(inventoryValue));
  setText(dashboard.grossProfit, formatMoney(grossProfit));
  setText(dashboard.collectionRate, collectionRate);
  setText(dashboard.averageInvoice, formatMoney(averageInvoice));
  setText(dashboard.monthlyReceipts, monthlyReceipts);
  setText(dashboard.retailInventoryValue, formatMoney(retailInventoryValue));

  const summary = document.getElementById("accounting-summary");
  if (!summary) return;
  summary.innerHTML = [
    ["Billed", formatMoney(billed), "Completed and collected jobs"],
    ["Collected", formatMoney(collected), `${receipts.length} receipt(s)`],
    ["Outstanding", formatMoney(outstanding), "Billed less recorded receipts"],
    ["Parts Cost", formatMoney(partsCost), "Parts used on completed work"],
    ["Inventory Value", formatMoney(inventoryValue), "Current stock at cost price"],
    ["Gross Profit", formatMoney(grossProfit), "Billed less parts cost"],
  ].map(([label, amount, note]) => `
    <tr><td>${label}</td><td>${amount}</td><td>${note}</td></tr>
  `).join("");
}

function renderOperationsSummary(jobs, customers, mechanics, parts) {
  const activeJobs = jobs.filter(job => !["Completed", "Collected", "Unclaimed"].includes(job.status));
  const lowStock = parts.filter(part => Number(part.quantity_in_stock) < 3);
  const activeMechanics = mechanics.filter(mechanic => mechanic.is_active !== false);
  const rows = [
    ["Customers", customers.length, "Registered customers"],
    ["Active Mechanics", activeMechanics.length, "Mechanics available for assignment"],
    ["Active Jobs", activeJobs.length, "Jobs currently in progress"],
    ["Awaiting Parts", jobs.filter(job => job.status === "Awaiting Parts").length, "Jobs blocked by parts"],
    ["Ready for Pickup", jobs.filter(job => job.status === "Ready for Pickup").length, "Customers to notify"],
    ["Low Stock Parts", lowStock.length, lowStock.map(part => part.name).filter(Boolean).join(", ") || "Stock levels are healthy"],
  ];
  const summary = document.getElementById("operations-summary");
  if (summary) {
    summary.innerHTML = rows.map(([area, total, detail]) => `
      <tr><td>${area}</td><td>${total}</td><td>${escapeHtml(detail)}</td></tr>
    `).join("");
  }
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

function formatMoney(value) {
  return `$${Number(value).toFixed(2)}`;
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
