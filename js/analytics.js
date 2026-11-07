import supabase from "./supabaseClient.js";

// "Ready for Pickup" absorbed the old "Completed" status months ago, and
// "Unclaimed" is also a finished job (just uncollected) — this file was
// still checking for "Completed", which no new job can ever have, so
// revenue/profit/leaderboards here were silently showing wrong numbers.
const FINISHED = ["Processed", "Ready for Pickup", "Collected", "Unclaimed"];

const summaryCards = document.getElementById("summary-cards");
const operationsCards = document.getElementById("operations-cards");
const managerCards = document.getElementById("manager-cards");
const financialCards = document.getElementById("financial-cards");
const mechanicBoard = document.getElementById("mechanic-leaderboard");
const partsBoard = document.getElementById("parts-leaderboard");
const turnaroundStat = document.getElementById("turnaround-stat");
let revenueChart = null;
let payrollChart = null;
let payrollProcessing = false;

function analyticsBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function renderDateOverview(jobs, receipts, jobParts) {
  const cards = document.getElementById("analytics-date-cards");
  const summary = document.getElementById("analytics-date-summary");
  const fromInput = document.getElementById("analytics-from");
  const toInput = document.getElementById("analytics-to");
  if (!cards || !fromInput || !toInput) return;
  const today = analyticsBusinessDate();
  fromInput.value ||= today;
  toInput.value ||= today;
  const from = fromInput.value;
  const to = toInput.value;
  const inRange = (value, start, end) => {
    const date = analyticsBusinessDate(value);
    return date >= start && date <= end;
  };
  const rangeJobs = jobs.filter(job => inRange(job.created_at, from, to));
  const completed = rangeJobs.filter(job => FINISHED.includes(job.status));
  const rangeReceipts = receipts.filter(receipt => inRange(receipt.issued_at, from, to));
  const billed = completed.reduce((sum, job) => sum + Number(job.total_cost || 0), 0);
  const collected = rangeReceipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
  const labour = rangeJobs.reduce((sum, job) => sum + Number(job.labour_cost || 0), 0);
  const partsCost = rangeJobs.reduce((sum, job) => sum + Number(job.parts_cost || 0), 0);
  const rangePartLines = jobParts.filter(() => true).length;
  cards.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Jobs Received</div><div class="stat-card__value">${rangeJobs.length}</div></div>
    <div class="stat-card"><div class="stat-card__label">Jobs Completed</div><div class="stat-card__value">${completed.length}</div></div>
    <div class="stat-card"><div class="stat-card__label">Money Billed</div><div class="stat-card__value">$${billed.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Money Collected</div><div class="stat-card__value">$${collected.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Labour Value</div><div class="stat-card__value">$${labour.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Parts Value</div><div class="stat-card__value">$${partsCost.toFixed(2)}</div></div>`;
  summary.textContent = `${from === to ? `Today (${from})` : `Custom range ${from} to ${to}`}: ${rangeJobs.length} jobs received, ${completed.length} completed, $${collected.toFixed(2)} collected, $${Math.max(0, billed - collected).toFixed(2)} outstanding from completed billings.`;
  void rangePartLines;
}

function renderAccountSection(title, records, fields) {
  const rows = records.map(record => `<tr>${fields.map(([label, key]) => `<td data-label="${escapeHtml(label)}">${escapeHtml(record[key] ?? "—")}</td>`).join("")}</tr>`).join("");
  return `<section class="chart-card"><h3>${escapeHtml(title)} <span class="section-note">(${records.length})</span></h3>${records.length
    ? `<div style="overflow-x:auto"><table><thead><tr>${fields.map(([label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="section-note">No records found.</p>'}</section>`;
}

async function searchChecklistAccount(value) {
  const results = document.getElementById("checklist-account-results");
  const query = String(value || "").trim().replace(/^#/, "");
  const checklistNumber = Number(query);
  if (!/^\d+$/.test(query) || !Number.isSafeInteger(checklistNumber) || checklistNumber < 1000) {
    results.innerHTML = '<p class="section-note" role="alert">Enter a valid checklist number (1000 or higher).</p>';
    return;
  }
  results.innerHTML = '<p class="section-note" role="status">Searching checklist and account records…</p>';
  try {
    const [reportResult, directJobResult] = await Promise.all([
      supabase.from("job_condition_reports").select("id,checklist_number,job_id,customer_id,customer_name,vehicle_registration,checked_by,fuel_level_in,odometer_in,confirmed_at").eq("checklist_number", checklistNumber).maybeSingle(),
      supabase.from("repair_jobs").select("id,job_number,cro_number,checklist_number,customer_id,vehicle_id,status,fault_reported,created_at,total_cost,fuel_level_in,odometer_in,customers(full_name,customer_code),vehicles(make,model,year,license_plate)").eq("checklist_number", checklistNumber).maybeSingle(),
    ]);
    if (reportResult.error) throw new Error(`Couldn't search checklists: ${reportResult.error.message}`);
    if (directJobResult.error) throw new Error(`Couldn't search job cards: ${directJobResult.error.message}`);
    const report = reportResult.data;
    let matchedJob = directJobResult.data;
    if (!matchedJob && report?.job_id) {
      const { data, error } = await supabase.from("repair_jobs")
        .select("id,job_number,cro_number,checklist_number,customer_id,vehicle_id,status,fault_reported,created_at,total_cost,fuel_level_in,odometer_in,customers(full_name,customer_code),vehicles(make,model,year,license_plate)")
        .eq("id", report.job_id).maybeSingle();
      if (error) throw new Error(`Couldn't load the checklist's job card: ${error.message}`);
      matchedJob = data;
    }
    if (!report && !matchedJob) {
      results.innerHTML = `<p class="section-note" role="status">No checklist or job card was found for number ${checklistNumber}.</p>`;
      return;
    }

    const customerId = matchedJob?.customer_id || report?.customer_id;
    const errors = [];
    let customer = null, customers = [], jobs = [], invoices = [], orders = [], statements = [], checklists = [], vehicles = [];
    if (customerId) {
      const queries = await Promise.all([
        supabase.from("customers").select("id,customer_code,full_name,phone,email,customer_type").eq("id", customerId).maybeSingle(),
        supabase.from("repair_jobs").select("id,job_number,cro_number,checklist_number,status,fault_reported,created_at,total_cost,fuel_level_in,odometer_in,vehicles(license_plate,make,model)").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(2000),
        supabase.from("invoices").select("id,invoice_number,repair_job_id,issued_at,due_date,total,amount_paid,customer_name,status").eq("customer_id", customerId).order("issued_at", { ascending: false }).limit(2000),
        supabase.from("sales_orders").select("id,order_number,status,created_at,total_usd").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(2000),
        supabase.from("customer_account_statement").select("source_type,reference,entry_date,total_amount,amount_paid,balance_due").eq("customer_id", customerId).order("entry_date", { ascending: false }).limit(2000),
        supabase.from("job_condition_reports").select("checklist_number,customer_name,vehicle_registration,checked_by,confirmed_at,fuel_level_in,odometer_in").eq("customer_id", customerId).order("checklist_number", { ascending: false }).limit(2000),
        supabase.from("vehicles").select("license_plate,make,model,year").eq("customer_id", customerId).order("license_plate").limit(1000),
      ]);
      const [customerResult, jobResult, invoiceResult, orderResult, statementResult, checklistResult, vehicleResult] = queries;
      for (const [label, result] of [
        ["Customer", customerResult], ["Job cards", jobResult], ["Invoices", invoiceResult],
        ["Sales orders", orderResult], ["Account statement", statementResult],
        ["Checklists", checklistResult], ["Vehicles", vehicleResult],
      ]) if (result.error) errors.push(`${label}: ${result.error.message}`);
      customer = customerResult.data;
      jobs = jobResult.data || [];
      invoices = invoiceResult.data || [];
      orders = orderResult.data || [];
      statements = statementResult.data || [];
      checklists = checklistResult.data || [];
      vehicles = vehicleResult.data || [];
    } else if (matchedJob) {
      jobs = [matchedJob];
    }

    if (report && !checklists.some(item => Number(item.checklist_number) === checklistNumber)) checklists.unshift(report);
    if (matchedJob && !jobs.some(item => String(item.id) === String(matchedJob.id))) jobs.unshift(matchedJob);
    const jobIds = [...new Set(jobs.map(job => job.id).filter(Boolean))];
    const orderIds = orders.map(order => order.id).filter(Boolean);
    const invoiceIds = invoices.map(invoice => invoice.id).filter(Boolean);
    const [jobReceipts, orderReceipts, jobParts, jobPayments, invoicePayments] = await Promise.all([
      jobIds.length ? supabase.from("receipts").select("id,receipt_number,repair_job_id,sales_order_id,amount,issued_at").in("repair_job_id", jobIds).order("issued_at", { ascending: false }).limit(2000) : Promise.resolve({ data: [], error: null }),
      orderIds.length ? supabase.from("receipts").select("id,receipt_number,repair_job_id,sales_order_id,amount,issued_at").in("sales_order_id", orderIds).order("issued_at", { ascending: false }).limit(2000) : Promise.resolve({ data: [], error: null }),
      jobIds.length ? supabase.from("job_parts").select("job_id,part_name,quantity,price_at_time").in("job_id", jobIds).limit(5000) : Promise.resolve({ data: [], error: null }),
      jobIds.length ? supabase.from("repair_job_payments").select("*").in("repair_job_id", jobIds).limit(5000) : Promise.resolve({ data: [], error: null }),
      invoiceIds.length ? supabase.from("invoice_payments").select("*").in("invoice_id", invoiceIds).limit(5000) : Promise.resolve({ data: [], error: null }),
    ]);
    const receipts = [...(jobReceipts.data || []), ...(orderReceipts.data || [])]
      .filter((receipt, index, list) => list.findIndex(item => String(item.id) === String(receipt.id)) === index);
    for (const [label, result] of [
      ["Repair receipts", jobReceipts], ["Sales receipts", orderReceipts], ["Job parts", jobParts],
      ["Job payments", jobPayments], ["Invoice payments", invoicePayments],
    ]) if (result.error) errors.push(`${label}: ${result.error.message}`);

    const accountLabel = customer?.full_name || report?.customer_name || matchedJob?.customers?.full_name || "Customer account";
    results.innerHTML = `
      <section class="chart-card" style="margin-bottom:16px">
        <h3>Checklist #${checklistNumber} · ${escapeHtml(accountLabel)}</h3>
        <p>${escapeHtml(report?.customer_name || accountLabel)} · Registration ${escapeHtml(report?.vehicle_registration || matchedJob?.vehicles?.license_plate || "—")}</p>
        <p>Completed by ${escapeHtml(report?.checked_by || "—")} · Fuel ${escapeHtml(report?.fuel_level_in || matchedJob?.fuel_level_in || "—")} · Odometer ${escapeHtml(report?.odometer_in ?? matchedJob?.odometer_in ?? "—")}</p>
        ${errors.length ? `<p role="alert" class="section-note">Some account records could not be loaded: ${errors.map(escapeHtml).join(" · ")}</p>` : ""}
      </section>
      ${customer ? renderAccountSection("Customer", [{
        Code: customer.customer_code, Name: customer.full_name, Phone: customer.phone,
        Email: customer.email, Type: customer.customer_type,
      }], [["Code", "Code"], ["Name", "Name"], ["Phone", "Phone"], ["Email", "Email"], ["Type", "Type"]]) : ""}
      ${renderAccountSection("Vehicles", vehicles.map(vehicle => ({
        Registration: vehicle.license_plate, Vehicle: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
      })), [["Registration", "Registration"], ["Vehicle", "Vehicle"]])}
      ${renderAccountSection("Checklists", checklists.map(item => ({
        Number: item.checklist_number, Registration: item.vehicle_registration, Inspector: item.checked_by,
        Fuel: item.fuel_level_in, Odometer: item.odometer_in, Confirmed: item.confirmed_at ? new Date(item.confirmed_at).toLocaleDateString() : "No",
      })), [["Number", "Number"], ["Registration", "Registration"], ["Inspector", "Inspector"], ["Fuel", "Fuel"], ["Odometer", "Odometer"], ["Confirmed", "Confirmed"]])}
      ${renderAccountSection("Job cards", jobs.map(job => ({
        Job: job.cro_number || `JC-${String(job.job_number ?? "").padStart(5, "0")}`, Checklist: job.checklist_number,
        Status: job.status, Registration: job.vehicles?.license_plate, Created: job.created_at ? new Date(job.created_at).toLocaleDateString() : "",
        Total: job.total_cost, Fault: job.fault_reported,
      })), [["Job", "Job"], ["Checklist", "Checklist"], ["Status", "Status"], ["Registration", "Registration"], ["Created", "Created"], ["Total", "Total"], ["Fault", "Fault"]])}
      ${renderAccountSection("Invoices", invoices.map(invoice => ({
        Invoice: `INV-${String(invoice.invoice_number ?? "").padStart(5, "0")}`, Date: invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString() : "",
        Due: invoice.due_date || "", Total: invoice.total, Paid: invoice.amount_paid, Status: invoice.status,
      })), [["Invoice", "Invoice"], ["Date", "Date"], ["Due", "Due"], ["Total", "Total"], ["Paid", "Paid"], ["Status", "Status"]])}
      ${renderAccountSection("Sales orders", orders.map(order => ({
        Order: `Order #${order.order_number}`, Date: order.created_at ? new Date(order.created_at).toLocaleDateString() : "",
        Status: order.status, Total: order.total_usd,
      })), [["Order", "Order"], ["Date", "Date"], ["Status", "Status"], ["Total", "Total"]])}
      ${renderAccountSection("Receipts", receipts.map(receipt => ({
        Receipt: `R-${String(receipt.receipt_number ?? "").padStart(5, "0")}`, Date: receipt.issued_at ? new Date(receipt.issued_at).toLocaleDateString() : "",
        Amount: receipt.amount, Related: receipt.repair_job_id ? "Repair job" : "Sales order",
      })), [["Receipt", "Receipt"], ["Date", "Date"], ["Amount", "Amount"], ["Related", "Related"]])}
      ${renderAccountSection("Job parts", jobParts.data || [], [["Part", "part_name"], ["Quantity", "quantity"], ["Unit price", "price_at_time"]])}
      ${renderAccountSection("Repair payments", jobPayments.data || [], [["Date", "paid_at"], ["Amount", "amount"], ["Method", "payment_method"]])}
      ${renderAccountSection("Invoice payments", invoicePayments.data || [], [["Date", "payment_date"], ["Amount", "amount"], ["Method", "payment_method"]])}
      ${renderAccountSection("Account statement", statements.map(entry => ({
        Date: entry.entry_date, Type: entry.source_type, Reference: entry.reference, Total: entry.total_amount,
        Paid: entry.amount_paid, Balance: entry.balance_due,
      })), [["Date", "Date"], ["Type", "Type"], ["Reference", "Reference"], ["Total", "Total"], ["Paid", "Paid"], ["Balance", "Balance"]])}`;
  } catch (error) {
    console.error("Checklist account search failed:", error);
    results.innerHTML = `<p role="alert" class="section-note">Couldn't search the account: ${escapeHtml(error.message || String(error))}</p>`;
  }
}

async function loadAnalytics() {
  // technician_directory (Phase 0 security) is the safe, no-salary view —
  // used for names and counts that every staff member should still see.
  // The full technicians table stays admin-only, fetched separately below,
  // used only for payroll processing which legitimately needs salary data.
  const [jobsRes, jobPartsRes, customersRes, techDirRes, techniciansRes, partsRes, receiptsRes, payrollRunsRes] = await Promise.all([
    supabase.from("repair_jobs").select(`id, status, total_cost, parts_cost, labour_cost, created_at, completed_at, technician_id`),
    supabase.from("job_parts").select("part_name, quantity, price_at_time"),
    supabase.from("customers").select("id").is("deleted_at", null),
    supabase.from("technician_directory").select("id, full_name, department, is_active"),
    supabase.from("technicians").select("id, full_name, department, is_active, salary, deductions"),
    supabase.from("parts").select("id, quantity_in_stock, cost_price, selling_price"),
    supabase.from("receipts").select("id, amount, issued_at, repair_job_id, voided_at"),
    supabase.from("payroll_runs").select("id, year, month, pay_date, total_amount, processed_at").order("year", { ascending: false }).order("month", { ascending: false }).limit(6),
  ]);

  if (jobsRes.error || jobPartsRes.error) {
    console.error("Analytics load error:", jobsRes.error || jobPartsRes.error);
    return;
  }

  const jobs = jobsRes.data || [];
  const jobParts = jobPartsRes.data || [];
  const customers = customersRes.data || [];
  const techDirectory = techDirRes.data || [];
  const technicians = techniciansRes.data || []; // empty array for non-admins, by design
  const parts = partsRes.data || [];
  const receipts = (receiptsRes.data || []).filter(receipt => !receipt.voided_at);
  const payrollRuns = (payrollRunsRes.data || []).slice().reverse(); // oldest→newest for charting

  const mechanics = techDirectory.filter(t => t.department === "Mechanics");
  const techNames = Object.fromEntries(techDirectory.map(t => [t.id, t.full_name]));

  renderSummary(jobs);
  renderOperationsCards(jobs, customers);
  renderManagerCards(jobs, mechanics, parts, receipts);
  renderFinancialCards(jobs, parts, receipts, payrollRuns);
  renderRevenueChart(jobs);
  renderMechanicLeaderboard(jobs, techNames);
  renderPartsLeaderboard(jobParts);
  renderTurnaround(jobs);
  renderPayrollChart(payrollRuns);
  renderPayrollHistory(payrollRuns);
  renderDateOverview(jobs, receipts, jobParts);
  const accountSearch = document.getElementById("checklist-account-search");
  if (accountSearch && !accountSearch.dataset.ready) {
    accountSearch.dataset.ready = "true";
    accountSearch.addEventListener("submit", event => {
      event.preventDefault();
      searchChecklistAccount(document.getElementById("checklist-number-query").value);
    });
  }
  document.getElementById("analytics-from")?.addEventListener("change", () => renderDateOverview(jobs, receipts, jobParts));
  document.getElementById("analytics-to")?.addEventListener("change", () => renderDateOverview(jobs, receipts, jobParts));
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
    <div class="stat-card"><div class="stat-card__label">Billed for Completed Repairs</div><div class="stat-card__value">$${revenue.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Parts Cost for Completed Repairs</div><div class="stat-card__value">$${cost.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Estimated Repair Margin</div><div class="stat-card__value">$${profit.toFixed(2)}</div><small>Completed repair billings less parts cost.</small></div>
    <div class="stat-card"><div class="stat-card__label">Repair Jobs in System</div><div class="stat-card__value">${jobCount}</div></div>
  `;
}

function renderOperationsCards(jobs, customers) {
  const active = jobs.filter(j => !FINISHED.includes(j.status));
  const awaitingParts = jobs.filter(j => j.status === "Awaiting Parts").length;
  const readyForPickup = jobs.filter(j => ["Processed", "Ready for Pickup"].includes(j.status)).length;

  operationsCards.innerHTML = `
    <div class="stat-card"><div class="stat-card__label">Active Jobs</div><div class="stat-card__value">${active.length}</div></div>
    <div class="stat-card"><div class="stat-card__label">Awaiting Parts</div><div class="stat-card__value">${awaitingParts}</div></div>
    <div class="stat-card"><div class="stat-card__label">Ready for Pickup</div><div class="stat-card__value">${readyForPickup}</div></div>
    <div class="stat-card"><div class="stat-card__label">Customers Registered</div><div class="stat-card__value">${customers.length}</div></div>
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
    <div class="stat-card"><div class="stat-card__label">Completed Jobs Without a Receipt</div><div class="stat-card__value">${outstandingJobs}</div></div>
    <div class="stat-card"><div class="stat-card__label">Customer Payments Recorded</div><div class="stat-card__value">$${revenue.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Repair Labour Billed</div><div class="stat-card__value">$${labour.toFixed(2)}</div></div>
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
    <div class="stat-card"><div class="stat-card__label">Completed Repair Billings</div><div class="stat-card__value">$${billed.toFixed(2)}</div><small>Job totals for finished repairs.</small></div>
    <div class="stat-card"><div class="stat-card__label">Customer Payments Received</div><div class="stat-card__value">$${collected.toFixed(2)}</div><small>Total recorded receipt payments.</small></div>
    <div class="stat-card"><div class="stat-card__label">Estimated Balance on Completed Repairs</div><div class="stat-card__value">$${outstandingAmount.toFixed(2)}</div><small>Completed repair billings less all recorded receipts.</small></div>
    <div class="stat-card"><div class="stat-card__label">Inventory Value (cost)</div><div class="stat-card__value">$${inventoryValue.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-card__label">Estimated Gross Profit</div><div class="stat-card__value">$${grossProfit.toFixed(2)}</div><small>Completed repair billings less parts cost.</small></div>
    <div class="stat-card"><div class="stat-card__label">Payroll (this month)</div><div class="stat-card__value">$${payrollThisMonth.toFixed(2)}</div>${!thisMonthRun ? '<div style="font-size:.72rem;color:var(--text-muted);">Not yet processed</div>' : ""}</div>
    <div class="stat-card"><div class="stat-card__label">Estimated Profit After This Month's Payroll</div><div class="stat-card__value">$${netProfit.toFixed(2)}</div><small>Does not include other workshop expenses.</small></div>
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
        label: "Completed Repair Billings ($)",
        data: revenueByMonth,
        borderColor: "#4f8cf7",
        backgroundColor: "rgba(79,140,247,0.12)",
        fill: true,
        tension: 0.3,
      }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}

function renderMechanicLeaderboard(jobs, techNames) {
  const stats = {};
  jobs.forEach(j => {
    if (!FINISHED.includes(j.status) || !j.technician_id) return;
    const name = techNames[j.technician_id] || "Unassigned";
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
    btn.innerHTML = `<i data-lucide="settings-2"></i> Configure Payroll &amp; Create Payslips`;
    btn.onclick = () => { window.location.href = "technicians.html#payroll-management"; };
  }
  if (window.lucide) lucide.createIcons();
}

async function processPayroll(technicians, year, month, payDate) {
  if (payrollProcessing) return;
  payrollProcessing = true;
  const button = document.getElementById("process-payroll-btn");
  if (button) button.disabled = true;
  try {
    await processPayrollOnce(technicians, year, month, payDate);
  } catch (error) {
    console.error("Payroll processing failed:", error);
    alert("Couldn't process payroll: " + (error.message || String(error)));
  } finally {
    payrollProcessing = false;
    if (button?.isConnected) button.disabled = false;
  }
}

async function processPayrollOnce(technicians, year, month, payDate) {
  const active = technicians.filter(t => t.is_active !== false);
  if (!active.length) { alert("No active employees to pay."); return; }
  if (!await window.aprConfirm(`Process payroll for ${active.length} active employee(s), payable ${payDate.toLocaleDateString()}? This can't be undone from here.`, { title: "Confirm payroll", confirmLabel: "Process payroll", danger: true })) return;

  const { data: existingRun, error: existingRunError } = await supabase.from("payroll_runs")
    .select("id")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  if (existingRunError) {
    alert("Couldn't verify whether this month's payroll was already processed: " + existingRunError.message);
    return;
  }
  if (existingRun) {
    alert("Payroll for this month has already been processed. Refresh the Analytics page to see the run.");
    await loadAnalytics();
    return;
  }

  // Pull in any unpaid commissions so they go out with the same payroll
  // run, the way most shops actually pay commission — not as a separate
  // cash-out every time a job or sale closes.
  const { data: unpaidCommissions } = await supabase.from("commissions").select("id, employee_id, commission_amount").eq("status", "unpaid");
  const commissionByEmployee = {};
  (unpaidCommissions || []).forEach(c => {
    commissionByEmployee[c.employee_id] = (commissionByEmployee[c.employee_id] || 0) + Number(c.commission_amount);
  });

  const payments = active.map(t => {
    const gross = Number(t.salary || 0);
    const deductions = Number(t.deductions || 0);
    const commission = commissionByEmployee[t.id] || 0;
    return {
      employee_id: t.id, employee_name: t.full_name, department: t.department,
      gross_salary: gross, deductions, commission_amount: commission,
      net_pay: Math.max(0, gross + commission - deductions),
    };
  });
  const totalNet = payments.reduce((sum, p) => sum + p.net_pay, 0);
  const totalGrossPlusCommission = payments.reduce((sum, p) => sum + p.gross_salary + p.commission_amount, 0);
  const totalDeductions = payments.reduce((sum, p) => sum + p.deductions, 0);

  // ---- Post to the ledger: Debit Wages Expense (5100) for the full cost,
  //      Credit Bank (1010) for what's actually paid out, Credit Tax
  //      Payable (2200) for anything withheld rather than paid — it's
  //      owed elsewhere (tax authority), not vanished. ----
  const { data: accounts } = await supabase.from("accounts").select("id, code");
  const wagesExpense = accounts?.find(a => a.code === "5100");
  const bankAccount = accounts?.find(a => a.code === "1010");
  const taxPayable = accounts?.find(a => a.code === "2200");

  if (!wagesExpense || !bankAccount || !taxPayable) {
    alert("Couldn't find the Wages Expense (5100), Bank (1010), or Tax Payable (2200) accounts — check your Chart of Accounts in the Ledger.");
    return;
  }

  const { data: entry, error: entryError } = await supabase.from("journal_entries").insert([{
    entry_date: payDate.toISOString().slice(0, 10),
    description: `Payroll for ${new Date(year, month - 1, 1).toLocaleString("default", { month: "long", year: "numeric" })}`,
    source_type: "payroll",
  }]).select().single();
  if (entryError) { alert("Failed to post payroll to the ledger: " + entryError.message); return; }

  const lines = [{ account_id: wagesExpense.id, debit: totalGrossPlusCommission, credit: 0 }];
  if (totalDeductions > 0) lines.push({ account_id: taxPayable.id, debit: 0, credit: totalDeductions });
  lines.push({ account_id: bankAccount.id, debit: 0, credit: totalNet });

  const { error: linesError } = await supabase.from("journal_lines").insert(lines.map(l => ({ ...l, journal_entry_id: entry.id })));
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", entry.id);
    alert("Failed to post payroll to the ledger: " + linesError.message);
    return;
  }

  const { data: run, error } = await supabase
    .from("payroll_runs")
    .insert([{ year, month, pay_date: payDate.toISOString().slice(0, 10), total_amount: totalNet, journal_entry_id: entry.id }])
    .select().single();
  if (error) {
    if (error.code === "23505") {
      const { error: cleanupError } = await supabase.from("journal_entries").delete().eq("id", entry.id);
      if (cleanupError) {
        console.error("Could not remove duplicate payroll journal entry:", cleanupError);
        alert(`Payroll was already processed in another session, but this duplicate ledger entry could not be removed: ${cleanupError.message}. Contact an administrator.`);
      } else {
        alert("Payroll was processed in another session. The duplicate ledger entry was removed; refresh Analytics before continuing.");
      }
      return;
    }
    alert("Ledger entry posted, but payroll run record failed to save: " + error.message);
    return;
  }

  const { error: paymentsError } = await supabase
    .from("payroll_payments")
    .insert(payments.map(p => ({ ...p, payroll_run_id: run.id })));
  if (paymentsError) { alert("Payroll run was created, but individual payment records failed to save: " + paymentsError.message); return; }

  // Mark the commissions that just got paid out as paid, tied to this run.
  const paidCommissionIds = (unpaidCommissions || []).map(c => c.id);
  if (paidCommissionIds.length) {
    await supabase.from("commissions").update({ status: "paid", payroll_run_id: run.id }).in("id", paidCommissionIds);
  }

  window.aprToast?.("Payroll processed", "success", `${totalNet.toFixed(2)} net across ${payments.length} employee(s), including ${(unpaidCommissions || []).length} commission payment(s). Posted to the Ledger.`);
  loadAnalytics();
}

function renderPayrollChart(payrollRuns) {
  const labels = payrollRuns.map(r => new Date(r.year, r.month - 1, 1).toLocaleString("default", { month: "short", year: "2-digit" }));
  const data = payrollRuns.map(r => Number(r.total_amount));
  const ctx = document.getElementById("payroll-chart");
  if (payrollChart) payrollChart.destroy();
  payrollChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Payroll ($)", data, backgroundColor: "#4f8cf7" }] },
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