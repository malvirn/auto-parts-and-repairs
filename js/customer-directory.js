import supabase from "./supabaseClient.js";

const directoryBody = document.getElementById("customer-directory-body");
const directorySearch = document.getElementById("customer-directory-search");
const directoryMessage = document.getElementById("customer-directory-message");
const directoryDetail = document.getElementById("customer-directory-detail");
const refreshButton = document.getElementById("refresh-customer-directory");

let customers = [];
let selectedCustomerId = null;
let visibleCustomers = [];
let historyRequestNumber = 0;
let currentEvents = [];
let activeHistoryFilter = "all";
let expandedEventIndex = null;

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function dateLabel(value) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Harare" }).format(date);
}

function dateTimeLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Harare",
    }).format(date);
}

async function fetchAllPages(buildQuery, label) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await buildQuery().range(offset, offset + 999);
    if (error) throw new Error(`Couldn't load ${label}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function loadOptionalRows(label, buildQuery, warnings) {
  try {
    return await fetchAllPages(buildQuery, label);
  } catch (error) {
    warnings.push(error.message || String(error));
    return [];
  }
}

function renderDirectory() {
  const search = directorySearch.value.trim().toLowerCase();
  visibleCustomers = customers.filter(customer => {
    const vehiclePlates = (customer.vehicles || []).map(vehicle => vehicle.license_plate || "").join(" ");
    const haystack = [
      customer.full_name,
      customer.phone,
      customer.email,
      customer.customer_type,
      customer.customer_code,
      vehiclePlates,
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });

  if (!visibleCustomers.length) {
    directoryBody.innerHTML = `<tr><td colspan="4" class="empty-state">${customers.length ? "No customers match your search." : "No customer records found."}</td></tr>`;
    return;
  }

  directoryBody.innerHTML = visibleCustomers.map(customer => {
    const isSelected = selectedCustomerId === customer.id;
    return `<tr data-customer-id="${escapeHtml(customer.id)}" class="${isSelected ? "is-selected" : ""}">
      <td><button type="button" data-select-customer="${escapeHtml(customer.id)}">${escapeHtml(customer.full_name || "Unnamed customer")}</button><small>${escapeHtml(customer.customer_code || "No customer ID")} · ${escapeHtml(customer.phone || "No phone recorded")}${(customer.vehicles || []).length ? ` · ${(customer.vehicles || []).length} vehicle(s)` : ""}</small></td>
      <td>${escapeHtml(customer.customer_type === "company" ? "Company" : "Individual")}</td>
      <td>${escapeHtml(dateLabel(customer.created_at))}</td>
      <td>${customer.deleted_at ? "Archived" : "Active"}</td>
    </tr>`;
  }).join("");
}

function activityRow(item, index) {
  const voidClass = item.voided ? " is-voided" : "";
  const voidText = item.voided ? " · VOID" : "";
  const amount = item.amount === null || item.amount === undefined ? "" : money(item.amount);
  const expanded = expandedEventIndex === index;
  return `<article class="customer-activity-item${voidClass}${expanded ? " is-expanded" : ""}">
    <button type="button" class="customer-activity-trigger" data-event-index="${index}" aria-expanded="${expanded}">
      <time datetime="${escapeHtml(item.date || "")}">${escapeHtml(dateTimeLabel(item.date))}</time>
      <span><strong>${escapeHtml(item.title)}${escapeHtml(voidText)}</strong><small>${escapeHtml(item.detail || "")}</small></span>
      <span class="customer-activity-item__amount">${escapeHtml(amount)}</span>
    </button>
    ${expanded ? `<div class="customer-activity-expanded">${(item.details || []).map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value || "Not recorded")}</span></p>`).join("") || "<p>No additional transaction details were recorded.</p>"}</div>` : ""}
  </article>`;
}

function renderActivityEvents() {
  const activityList = directoryDetail.querySelector(".customer-activity-list");
  if (!activityList) return;
  const matchingEvents = currentEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => activeHistoryFilter === "all"
      || (activeHistoryFilter === "charges" && ["charge", "sale", "invoice"].includes(event.type))
      || (activeHistoryFilter === "payments" && ["payment", "receipt"].includes(event.type))
      || (activeHistoryFilter === "balances" && event.type === "balance"));
  activityList.innerHTML = matchingEvents.length
    ? matchingEvents.map(({ event, index }) => activityRow(event, index)).join("")
    : '<p class="section-note">No matching transactions were found.</p>';
  directoryDetail.querySelectorAll("[data-history-filter]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.historyFilter === activeHistoryFilter));
  });
}

function vehicleSummary(vehicle) {
  const label = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const identifiers = [
    vehicle.license_plate ? `Plate ${vehicle.license_plate}` : "",
    vehicle.chassis_number ? `Chassis ${vehicle.chassis_number}` : "",
    vehicle.engine_number ? `Engine ${vehicle.engine_number}` : "",
    vehicle.body_type || "",
  ].filter(Boolean);
  return `<div class="customer-vehicle-item"><strong>${escapeHtml(label || "Vehicle")}</strong><small>${escapeHtml(identifiers.join(" · ") || "No vehicle identifiers recorded")}</small></div>`;
}

async function loadCustomerHistory(customer) {
  const requestNumber = ++historyRequestNumber;
  selectedCustomerId = customer.id;
  currentEvents = [];
  activeHistoryFilter = "all";
  expandedEventIndex = null;
  renderDirectory();
  directoryDetail.innerHTML = '<p class="empty-state">Loading customer activity…</p>';
  directoryMessage.textContent = "";
  directoryMessage.dataset.tone = "info";

  const warnings = [];
  const [vehicles, jobs, quotations, orders, invoices] = await Promise.all([
    loadOptionalRows("Customer vehicles", () => supabase.from("vehicles")
      .select("id,license_plate,make,model,year,chassis_number,engine_number,body_type")
      .eq("customer_id", customer.id).order("license_plate"), warnings),
    loadOptionalRows("Job cards", () => supabase.from("repair_jobs")
      .select("id,job_number,cro_number,status,fault_reported,diagnosis,total_cost,created_at,vehicle_id,work_ready,ready_at,collected_at,odometer_in,fuel_level_in,driver_name,driver_phone,picked_up_by")
      .eq("customer_id", customer.id).order("created_at", { ascending: false }), warnings),
    loadOptionalRows("Quotations", () => supabase.from("quotations")
      .select("id,quotation_number,status,total_usd,created_at,repair_job_id")
      .eq("customer_id", customer.id).order("created_at", { ascending: false }), warnings),
    loadOptionalRows("Sales orders", () => supabase.from("sales_orders")
      .select("id,order_number,status,total_usd,discount_usd,payment_method,created_at,quotation_id,sales_order_items(part_name,quantity,total_usd)")
      .eq("customer_id", customer.id).order("created_at", { ascending: false }), warnings),
    loadOptionalRows("Invoices", () => supabase.from("invoices")
      .select("id,invoice_number,total,amount_paid,status,issued_at,due_date,reference,items")
      .eq("customer_id", customer.id).order("issued_at", { ascending: false }), warnings),
  ]);

  const jobIds = jobs.map(job => job.id);
  const quotationIds = quotations.map(quotation => quotation.id);
  const orderIds = orders.map(order => order.id);
  const invoiceIds = invoices.map(invoice => invoice.id);
  const [quotationItems, jobParts, jobPayments, jobReceipts, orderReceipts, quickSalePayments, invoicePayments, creditNotes] = await Promise.all([
    quotationIds.length ? loadOptionalRows("Quotation items", () => supabase.from("quotation_items")
      .select("quotation_id,part_name,quantity,total_usd").in("quotation_id", quotationIds), warnings) : [],
    jobIds.length ? loadOptionalRows("Parts used on job cards", () => supabase.from("job_parts")
      .select("job_id,part_name,quantity,price_at_time").in("job_id", jobIds), warnings) : [],
    jobIds.length ? loadOptionalRows("Job-card payments", () => supabase.from("repair_job_payments")
      .select("id,repair_job_id,amount,payment_method,paid_at,voided_at,void_reason")
      .in("repair_job_id", jobIds).order("paid_at", { ascending: false }), warnings) : [],
    jobIds.length ? loadOptionalRows("Job-card receipts", () => supabase.from("receipts")
      .select("id,receipt_number,repair_job_id,amount,issued_at,voided_at,void_reason")
      .in("repair_job_id", jobIds).order("issued_at", { ascending: false }), warnings) : [],
    orderIds.length ? loadOptionalRows("Sales receipts", () => supabase.from("receipts")
      .select("id,receipt_number,sales_order_id,amount,issued_at,voided_at,void_reason")
      .in("sales_order_id", orderIds).order("issued_at", { ascending: false }), warnings) : [],
    orderIds.length ? loadOptionalRows("Quick Sale payment history", () => supabase.from("quick_sale_payments")
      .select("id,sales_order_id,amount,payment_method,payment_date,created_at")
      .in("sales_order_id", orderIds).order("payment_date", { ascending: false }), warnings) : [],
    invoiceIds.length ? loadOptionalRows("Invoice payments", () => supabase.from("invoice_payments")
      .select("id,invoice_id,amount,payment_method,payment_date,created_at")
      .in("invoice_id", invoiceIds).order("payment_date", { ascending: false }), warnings) : [],
    loadOptionalRows("Credit notes", () => supabase.from("credit_notes")
      .select("id,credit_note_number,receipt_id,reason,refunded,amount")
      .eq("customer_id", customer.id), warnings),
  ]);
  const creditNoteIds = creditNotes.map(note => note.id);
  const creditReceiptIds = creditNotes.map(note => note.receipt_id).filter(Boolean);
  const [creditNoteItems, creditNoteReceipts] = await Promise.all([
    creditNoteIds.length ? loadOptionalRows("Credit-note items", () => supabase.from("credit_note_items")
      .select("credit_note_id,part_name,quantity,unit_price,restock")
      .in("credit_note_id", creditNoteIds), warnings) : [],
    creditReceiptIds.length ? loadOptionalRows("Credit-note receipts", () => supabase.from("receipts")
      .select("id,receipt_number,issued_at")
      .in("id", creditReceiptIds), warnings) : [],
  ]);
  if (requestNumber !== historyRequestNumber) return;

  const vehicleById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const jobById = new Map(jobs.map(job => [job.id, job]));
  const quoteItemsById = new Map();
  for (const item of quotationItems) {
    const list = quoteItemsById.get(item.quotation_id) || [];
    list.push(item);
    quoteItemsById.set(item.quotation_id, list);
  }
  const jobPartsById = new Map();
  for (const part of jobParts) {
    const list = jobPartsById.get(part.job_id) || [];
    list.push(part);
    jobPartsById.set(part.job_id, list);
  }

  const jobPaid = new Map();
  for (const payment of jobPayments) {
    if (!payment.voided_at) jobPaid.set(payment.repair_job_id, (jobPaid.get(payment.repair_job_id) || 0) + Number(payment.amount || 0));
  }
  const orderReceiptsById = new Map();
  const receiptById = new Map();
  for (const receipt of orderReceipts) {
    receiptById.set(receipt.id, receipt);
    if (!receipt.voided_at) orderReceiptsById.set(receipt.sales_order_id,
      Math.max(orderReceiptsById.get(receipt.sales_order_id) || 0, Number(receipt.amount || 0)));
  }
  for (const receipt of jobReceipts) receiptById.set(receipt.id, receipt);
  for (const receipt of creditNoteReceipts) receiptById.set(receipt.id, receipt);
  const creditNoteItemsById = new Map();
  for (const item of creditNoteItems) {
    const list = creditNoteItemsById.get(item.credit_note_id) || [];
    list.push(item);
    creditNoteItemsById.set(item.credit_note_id, list);
  }
  const quickPaidById = new Map();
  for (const payment of quickSalePayments) {
    quickPaidById.set(payment.sales_order_id,
      (quickPaidById.get(payment.sales_order_id) || 0) + Number(payment.amount || 0));
  }
  const invoicePaidById = new Map();
  for (const payment of invoicePayments) {
    invoicePaidById.set(payment.invoice_id,
      (invoicePaidById.get(payment.invoice_id) || 0) + Number(payment.amount || 0));
  }

  const events = [];
  let totalCharges = 0;
  let totalPaid = 0;
  for (const job of jobs) {
    const total = Number(job.total_cost || 0);
    const paid = jobPaid.get(job.id) || 0;
    const contributesToBalance = paid > 0
      || ["Ready for Pickup", "Unclaimed", "Collected", "Processed"].includes(job.status);
    const vehicle = vehicleById.get(job.vehicle_id);
    const parts = jobPartsById.get(job.id) || [];
    if (contributesToBalance) {
      totalCharges += total;
      totalPaid += paid;
    }
    events.push({
      date: job.created_at, title: `Job card ${job.cro_number || `#${job.job_number}`}`,
      detail: [job.status, vehicle?.license_plate, job.fault_reported,
        parts.length ? `Parts: ${parts.map(part => `${part.part_name} × ${part.quantity}`).join(", ")}` : ""].filter(Boolean).join(" · "),
      amount: total, type: "charge",
      details: [
        ["Job card", job.cro_number || `#${job.job_number}`],
        ["Status", job.status],
        ["Vehicle", [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.license_plate].filter(Boolean).join(" ")],
        ["Collection", job.collected_at ? `Collected ${dateTimeLabel(job.collected_at)}${job.picked_up_by ? ` by ${job.picked_up_by}` : ""}` : "Not collected"],
        ["Work ready", job.ready_at ? dateTimeLabel(job.ready_at) : job.work_ready ? "Marked ready" : "Not marked ready"],
        ["Reported fault", job.fault_reported],
        ["Diagnosis / work notes", job.diagnosis],
        ["Odometer at drop-off", job.odometer_in === null ? "" : `${job.odometer_in}`],
        ["Fuel at drop-off", job.fuel_level_in],
        ["Driver", [job.driver_name, job.driver_phone].filter(Boolean).join(" · ")],
        ["Parts used", parts.map(part => `${part.part_name} × ${part.quantity} (${money(part.price_at_time)})`).join(", ")],
        ["Payments recorded", money(paid)],
      ],
    });
    if (contributesToBalance && Math.abs(total - paid) > 0.005) {
      events.push({
        date: job.created_at, title: "Job-card balance",
        detail: `${job.status} · ${money(paid)} paid · ${money(total - paid)} outstanding`,
        amount: total - paid, type: "balance",
      });
    }
  }

  for (const quote of quotations) {
    const items = quoteItemsById.get(quote.id) || [];
    events.push({
      date: quote.created_at, title: `Quotation #${quote.quotation_number}`,
      detail: [quote.status, quote.repair_job_id ? `Linked job ${jobById.get(quote.repair_job_id)?.cro_number || ""}` : "",
        items.length ? `Items: ${items.map(item => `${item.part_name} × ${item.quantity}`).join(", ")}` : ""].filter(Boolean).join(" · "),
      amount: quote.total_usd, type: "quotation",
      details: [["Status", quote.status], ["Items", items.map(item => `${item.part_name} × ${item.quantity} · Qty ${item.quantity} · ${money(item.total_usd)}`).join(", ")], ["Linked job card", quote.repair_job_id ? jobById.get(quote.repair_job_id)?.cro_number : "Not linked"]],
    });
  }

  for (const order of orders) {
    const receiptPaid = orderReceiptsById.get(order.id) || 0;
    const paid = Math.max(quickPaidById.get(order.id) || 0, receiptPaid);
    const total = Number(order.total_usd || 0);
    const contributesToBalance = order.status === "Confirmed";
    if (contributesToBalance) {
      totalCharges += total;
      totalPaid += paid;
    }
    const itemText = (order.sales_order_items || [])
      .map(item => `${item.part_name} × ${item.quantity}`).join(", ");
    events.push({
      date: order.created_at, title: `Sales order #${order.order_number}`,
      detail: [order.status, order.payment_method, order.discount_usd ? `Discount ${money(order.discount_usd)}` : "",
        itemText ? `Items: ${itemText}` : ""].filter(Boolean).join(" · "),
      amount: total, type: "sale",
      details: [["Order", `#${order.order_number}`], ["Status", order.status], ["Payment method", order.payment_method], ["Discount", money(order.discount_usd)], ["Items", (order.sales_order_items || []).map(item => `${item.part_name} × ${item.quantity} · ${money(item.total_usd)}`).join(", ")], ["Recorded payments", money(paid)]],
    });
    if (contributesToBalance && total - paid > 0.005) {
      events.push({
        date: order.created_at, title: "Sales order balance",
        detail: `${money(paid)} paid · ${money(total - paid)} outstanding`,
        amount: total - paid, type: "balance",
      });
    }
  }

  for (const invoice of invoices) {
    const total = Number(invoice.total || 0);
    const paid = invoicePaidById.has(invoice.id)
      ? invoicePaidById.get(invoice.id)
      : Number(invoice.amount_paid || 0);
    totalCharges += total;
    totalPaid += paid;
    const invoiceItems = Array.isArray(invoice.items)
      ? invoice.items.map(item => {
        const name = item.part_name || item.description || item.name || "Item";
        const quantity = item.quantity || 1;
        return `${name} × ${quantity}`;
      }).join(", ")
      : "";
    events.push({
      date: invoice.issued_at, title: `Invoice ${invoice.reference || `INV-${invoice.invoice_number}`}`,
      detail: [invoice.status, invoice.due_date ? `Due ${dateLabel(invoice.due_date)}` : "",
        invoiceItems ? `Items: ${invoiceItems}` : ""].filter(Boolean).join(" · "),
      amount: total, type: "invoice",
      details: [["Invoice", invoice.reference || `INV-${invoice.invoice_number}`], ["Status", invoice.status], ["Due date", dateLabel(invoice.due_date)], ["Items", invoiceItems], ["Payments recorded", money(paid)]],
    });
    if (total - paid > 0.005) {
      events.push({
        date: invoice.issued_at, title: "Invoice balance",
        detail: `${money(paid)} paid · ${money(total - paid)} outstanding`,
        amount: total - paid, type: "balance",
      });
    }
  }

  for (const payment of jobPayments) {
    events.push({
      date: payment.paid_at, title: payment.voided_at ? "Voided job-card payment" : "Job-card payment received",
      detail: `${jobById.get(payment.repair_job_id)?.cro_number || "Job card"} · ${payment.payment_method}${payment.void_reason ? ` · ${payment.void_reason}` : ""}`,
      amount: payment.amount, type: "payment", voided: Boolean(payment.voided_at),
      details: [["Job card", jobById.get(payment.repair_job_id)?.cro_number || "Job card"], ["Payment date", dateTimeLabel(payment.paid_at)], ["Method", payment.payment_method], ["Status", payment.voided_at ? "Voided" : "Recorded"], ["Void reason", payment.void_reason]],
    });
  }

  for (const receipt of [...jobReceipts, ...orderReceipts]) {
    const job = receipt.repair_job_id ? jobById.get(receipt.repair_job_id) : null;
    const order = orders.find(item => item.id === receipt.sales_order_id);
    events.push({
      date: receipt.issued_at, title: `Receipt R-${String(receipt.receipt_number || "").padStart(5, "0")}`,
      detail: `${job ? `Job card ${job.cro_number || job.job_number}` : `Sales order #${order?.order_number || ""}`}${receipt.void_reason ? ` · ${receipt.void_reason}` : ""}`,
      amount: receipt.amount, type: "receipt", voided: Boolean(receipt.voided_at),
      details: [["Receipt number", `R-${String(receipt.receipt_number || "").padStart(5, "0")}`], ["Issued", dateTimeLabel(receipt.issued_at)], ["Amount", money(receipt.amount)], ["Status", receipt.voided_at ? "VOID" : "Valid"], ["Void reason", receipt.void_reason]],
    });
  }

  for (const payment of quickSalePayments) {
    const order = orders.find(item => item.id === payment.sales_order_id);
    const voided = order?.status === "Cancelled";
    events.push({
      date: payment.payment_date || payment.created_at,
      title: voided ? "Reversed sales order payment" : "Sales order payment received",
      detail: `Order #${order?.order_number || ""} · ${payment.payment_method}`,
      amount: payment.amount, type: "payment", voided,
      details: [["Order", `#${order?.order_number || ""}`], ["Payment date", dateLabel(payment.payment_date || payment.created_at)], ["Method", payment.payment_method], ["Amount", money(payment.amount)], ["Status", voided ? "Reversed with cancelled order" : "Recorded"]],
    });
  }

  for (const payment of invoicePayments) {
    const invoice = invoices.find(item => item.id === payment.invoice_id);
    events.push({
      date: payment.payment_date || payment.created_at, title: "Invoice payment received",
      detail: `${invoice?.reference || `INV-${invoice?.invoice_number || ""}`} · ${payment.payment_method}`,
      amount: payment.amount, type: "payment",
      details: [["Invoice", invoice?.reference || `INV-${invoice?.invoice_number || ""}`], ["Payment date", dateLabel(payment.payment_date || payment.created_at)], ["Method", payment.payment_method], ["Amount", money(payment.amount)]],
    });
  }

  for (const note of creditNotes) {
    const items = creditNoteItemsById.get(note.id) || [];
    events.push({
      date: receiptById.get(note.receipt_id)?.issued_at, title: `Credit note #${note.credit_note_number}`,
      detail: `${note.refunded ? "Refunded" : "Credit issued"} · ${note.reason || "No reason recorded"}`,
      amount: note.amount, type: "credit",
      details: [["Credit note", `#${note.credit_note_number}`], ["Receipt", receiptById.get(note.receipt_id)?.receipt_number ? `R-${String(receiptById.get(note.receipt_id).receipt_number).padStart(5, "0")}` : "Receipt details unavailable"], ["Reason", note.reason], ["Type", note.refunded ? "Refunded" : "Credit issued"], ["Amount", money(note.amount)], ["Items", items.map(item => `${item.part_name} × ${item.quantity} · ${money(item.unit_price)}${item.restock ? " · Restocked" : ""}`).join(", ")]],
    });
  }

  events.sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());
  currentEvents = events;
  activeHistoryFilter = "all";
  expandedEventIndex = null;
  const paymentCount = events.filter(event => event.type === "payment").length;
  const balance = totalCharges - totalPaid;
  const balanceLabel = balance > 0.01 ? "Outstanding balance" : balance < -0.01 ? "Net customer credit" : "Account balance";
  const profile = [
    ["Customer type", customer.customer_type === "company" ? "Company" : "Individual"],
    ["Phone", customer.phone || "Not recorded"],
    ["Email", customer.email || "Not recorded"],
    ["Customer since", dateLabel(customer.created_at)],
    ["Record status", customer.deleted_at ? "Archived" : "Active"],
  ];

  directoryDetail.innerHTML = `
    <h3>${escapeHtml(customer.full_name || "Customer details")}</h3>
    <div class="customer-profile-grid">${profile.map(([label, value]) => `<div class="customer-profile-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
    <h4>Registered vehicles (${vehicles.length})</h4>
    <div class="customer-vehicle-list">${vehicles.length ? vehicles.map(vehicleSummary).join("") : '<p class="section-note">No vehicles are registered to this customer.</p>'}</div>
    <div class="customer-history-summary">
      <button type="button" class="customer-history-stat" data-history-filter="charges" aria-pressed="false"><span>Total charges</span><strong>${money(totalCharges)}</strong><small>Click to view transactions</small></button>
      <button type="button" class="customer-history-stat" data-history-filter="payments" aria-pressed="false"><span>Recorded payments</span><strong>${money(totalPaid)}</strong><small>${paymentCount} payment record(s) · click to view</small></button>
      <button type="button" class="customer-history-stat" data-history-filter="balances" aria-pressed="false"><span>${escapeHtml(balanceLabel)}</span><strong class="${balance > 0.01 ? "customer-balance--due" : balance < -0.01 ? "customer-balance--credit" : ""}">${money(Math.abs(balance))}</strong><small>Click to view balances</small></button>
      <button type="button" class="customer-history-stat" data-history-filter="all" aria-pressed="true"><span>Recorded interactions</span><strong>${events.length}</strong><small>Click to view all history</small></button>
    </div>
    ${warnings.length ? `<p class="customer-activity-warnings" role="status">${warnings.map(escapeHtml).join("<br>")}</p>` : ""}
    <h4>Full interaction history</h4>
    <div class="customer-activity-list">${events.length ? "" : '<p class="section-note">No quotations, jobs, sales, invoices, receipts, or payments were found for this customer.</p>'}</div>`;
  renderActivityEvents();
}

async function loadDirectory() {
  directoryMessage.textContent = "Loading customer records…";
  directoryMessage.dataset.tone = "info";
  try {
    customers = await fetchAllPages(() => supabase.from("customers")
      .select("id,customer_code,full_name,phone,email,customer_type,created_at,deleted_at,vehicles(license_plate)")
      .order("full_name"), "customer directory");
    renderDirectory();
    directoryMessage.textContent = `Loaded ${customers.length} customer record${customers.length === 1 ? "" : "s"}.`;
    directoryMessage.dataset.tone = "success";
    if (selectedCustomerId) {
      const selected = customers.find(customer => customer.id === selectedCustomerId);
      if (selected) await loadCustomerHistory(selected);
      else {
        selectedCustomerId = null;
        directoryDetail.innerHTML = '<p class="empty-state">Select a customer to review their details and history.</p>';
      }
    }
  } catch (error) {
    console.error("Couldn't load the customer directory:", error);
    directoryMessage.textContent = error.message || String(error);
    directoryMessage.dataset.tone = "error";
    directoryBody.innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHtml(error.message || String(error))}</td></tr>`;
  }
}

directoryBody.addEventListener("click", event => {
  const row = event.target.closest("tr[data-customer-id]");
  if (!row) return;
  const customer = customers.find(item => item.id === row.dataset.customerId);
  if (customer) loadCustomerHistory(customer);
});

directoryDetail.addEventListener("click", event => {
  const filterButton = event.target.closest("[data-history-filter]");
  if (filterButton) {
    activeHistoryFilter = filterButton.dataset.historyFilter;
    expandedEventIndex = null;
    renderActivityEvents();
    return;
  }
  const activityButton = event.target.closest("[data-event-index]");
  if (activityButton) {
    const index = Number(activityButton.dataset.eventIndex);
    expandedEventIndex = expandedEventIndex === index ? null : index;
    renderActivityEvents();
  }
});

directorySearch.addEventListener("input", renderDirectory);
refreshButton.addEventListener("click", loadDirectory);
loadDirectory();
