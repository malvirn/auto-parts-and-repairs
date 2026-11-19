import supabase from "./supabaseClient.js";

const FINISHED = new Set(["processed", "ready for pickup", "collected", "unclaimed"]);
const $ = id => document.getElementById(id);
const money = (value, currency = "USD") => {
  const code = String(currency || "USD").toUpperCase();
  try { return new Intl.NumberFormat("en-US", { style:"currency", currency:code, maximumFractionDigits:2 }).format(Number(value) || 0); }
  catch { return code + " " + (Number(value) || 0).toFixed(2); }
};
const groupMoney = groups => Object.entries(groups || {}).map(([currency, amount]) => money(amount, currency)).join(" · ") || "—";
let intelligenceSnapshot = null;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
const dateInHarare = value => new Intl.DateTimeFormat("en-CA", { timeZone:"Africa/Harare",year:"numeric",month:"2-digit",day:"2-digit" }).format(value instanceof Date ? value : new Date(value));
const daysAgo = days => { const d = new Date(); d.setDate(d.getDate() - days); return dateInHarare(d); };

function status(message, kind = "info") {
  const node = $("ci-status");
  if (node) { node.textContent = message; node.dataset.kind = kind; }
}
function listRows(target, rows, empty) {
  const node = $(target);
  if (!node) return;
  node.innerHTML = rows.length ? rows.map(row => '<div class="ci-list-row"><span>' + escapeHtml(row.label) + '</span><span>' + escapeHtml(row.value) + '</span></div>').join("") : '<div class="ci-status">' + escapeHtml(empty) + '</div>';
}
function insight(title, detail, href, icon = "activity") {
  return '<article class="ci-insight"><i data-lucide="' + icon + '"></i><div><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(detail) + '</p><a href="' + href + '">Review records →</a></div></article>';
}

async function loadIntelligence() {
  const refresh = $("ci-refresh");
  if (refresh) refresh.disabled = true;
  status("Refreshing live records from Centric Auto…");
  const [jobsResult, receiptsResult, partsResult, payablesResult, invoicesResult, expensesResult, voidedPayablesResult] = await Promise.all([
    supabase.from("repair_jobs").select("id,job_number,cro_number,status,created_at,completed_at,total_cost").order("created_at", { ascending:false }).limit(1500),
    supabase.from("receipts").select("id,receipt_number,amount,issued_at,voided_at,void_reason,currency_code").order("issued_at", { ascending:false }).limit(3000),
    supabase.from("parts").select("id,name,quantity_in_stock,minimum_stock").order("quantity_in_stock", { ascending:true }).limit(1000),
    supabase.from("payables").select("id,bill_number,due_date,amount,amount_paid,status,voided_at,suppliers(name)").neq("status","paid").is("voided_at",null).limit(1500),
    supabase.from("invoices").select("id,invoice_number,total,amount_paid,discount,subtotal,status,issued_at,due_date").order("issued_at", { ascending:false }).limit(2000),
    supabase.from("expenses").select("id,category,description,amount,expense_date").order("expense_date", { ascending:false }).limit(2000),
    supabase.from("payables").select("id,bill_number,amount,voided_at,void_reason").not("voided_at","is",null).limit(500)
  ]);
  const errors = [jobsResult,receiptsResult,partsResult,payablesResult,invoicesResult,expensesResult,voidedPayablesResult].filter(result => result.error).map(result => result.error.message);
  const jobs = jobsResult.data || [];
  const receipts = receiptsResult.data || [];
  const parts = partsResult.data || [];
  const payables = payablesResult.data || [];
  const invoices = invoicesResult.data || [];
  const expenses = expensesResult.data || [];
  const voidedPayables = voidedPayablesResult.data || [];
  const openJobs = jobs.filter(job => !FINISHED.has(String(job.status || "").toLowerCase()));
  const delayedJobs = openJobs.filter(job => job.created_at && dateInHarare(job.created_at) < daysAgo(7));
  const recentCompleted = jobs.filter(job => job.completed_at && dateInHarare(job.completed_at) >= daysAgo(30));
  const recentReceipts = receipts.filter(receipt => !receipt.voided_at && receipt.issued_at && dateInHarare(receipt.issued_at) >= daysAgo(30));
  const voidedReceipts = receipts.filter(receipt => receipt.voided_at && dateInHarare(receipt.voided_at) >= daysAgo(30));
  const collectedByCurrency = recentReceipts.reduce((groups, receipt) => {
    const currency = String(receipt.currency_code || "USD").toUpperCase();
    groups[currency] = (groups[currency] || 0) + Number(receipt.amount || 0);
    return groups;
  }, {});
  const recentInvoices = invoices.filter(invoice => invoice.issued_at && dateInHarare(invoice.issued_at) >= daysAgo(30) && String(invoice.status || "").toLowerCase() !== "void");
  const outstandingInvoices = invoices.filter(invoice => String(invoice.status || "").toLowerCase() !== "void" && Number(invoice.total || 0) - Number(invoice.amount_paid || 0) > 0.01);
  const highDiscountInvoices = recentInvoices.filter(invoice => Number(invoice.subtotal || 0) > 0 && Number(invoice.discount || 0) / Number(invoice.subtotal || 0) >= 0.2);
  const recentExpenses = expenses.filter(expense => expense.expense_date && expense.expense_date >= daysAgo(30));
  const expenseTotal = recentExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const invoicedTotal = recentInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const voidedReceiptGroups = voidedReceipts.reduce((groups, receipt) => {
    const currency = String(receipt.currency_code || "USD").toUpperCase();
    groups[currency] = (groups[currency] || 0) + Number(receipt.amount || 0);
    return groups;
  }, {});
  const lowStock = parts.filter(part => Number(part.quantity_in_stock || 0) < Math.max(3, Number(part.minimum_stock || 0)));
  const today = dateInHarare(new Date());
  const overdue = payables.filter(bill => bill.due_date && bill.due_date < today && Number(bill.amount || 0) - Number(bill.amount_paid || 0) > 0.01);
  const overdueTotal = overdue.reduce((sum, bill) => sum + Number(bill.amount || 0) - Number(bill.amount_paid || 0), 0);
  const payableTotal = payables.reduce((sum, bill) => sum + Math.max(0, Number(bill.amount || 0) - Number(bill.amount_paid || 0)), 0);
  intelligenceSnapshot = { jobs, openJobs, delayedJobs, receipts, recentReceipts, collectedByCurrency, parts, lowStock, payables, overdue, overdueTotal, invoices, recentInvoices, outstandingInvoices, highDiscountInvoices, recentExpenses, expenseTotal, invoicedTotal, voidedReceipts, voidedReceiptGroups, voidedPayables };

  $("ci-open-jobs").textContent = jobsResult.error ? "—" : String(openJobs.length);
  $("ci-completed").textContent = jobsResult.error ? "—" : String(recentCompleted.length);
  $("ci-collected").textContent = receiptsResult.error ? "—" : groupMoney(collectedByCurrency);
  $("ci-low-stock").textContent = partsResult.error ? "—" : String(lowStock.length);

  const signals = [];
  if (!jobsResult.error && delayedJobs.length) signals.push(insight("Jobs may be delayed", delayedJobs.length + " open jobs have been in the workshop for more than 7 days. Review their blockers and next steps.", "repairs.html", "clock-alert"));
  if (!jobsResult.error && openJobs.length >= 10) signals.push(insight("Workshop backlog is building", openJobs.length + " jobs are still open. Review ageing work and technician allocation.", "repairs.html", "alert-triangle"));
  if (!jobsResult.error && openJobs.length > 0 && openJobs.length < 10) signals.push(insight("Open work is manageable", openJobs.length + " jobs remain open. Check their status and expected completion dates.", "repairs.html", "wrench"));
  if (!partsResult.error && lowStock.length) signals.push(insight("Parts need replenishment", lowStock.length + " parts have fewer than 3 units available. Prioritise critical items before the next repair.", "shop.html", "package-alert"));
  if (!payablesResult.error && overdue.length) signals.push(insight("Supplier bills are overdue", overdue.length + " unpaid bills are past their due date, representing " + money(overdueTotal) + " in overdue balances.", "payables.html", "calendar-clock"));
  if (!receiptsResult.error && recentReceipts.length) signals.push(insight("Collections are being recorded", groupMoney(collectedByCurrency) + " was collected across " + recentReceipts.length + " receipts in the last 30 days.", "receipts.html", "trending-up"));
  if (!receiptsResult.error && voidedReceipts.length) signals.push(insight("Voided receipts need review", voidedReceipts.length + " receipts were voided in the last 30 days. Check the reason and supporting record.", "receipts.html", "receipt"));
  if (!signals.length) signals.push('<article class="ci-insight"><i data-lucide="check-circle-2"></i><div><strong>No urgent signals detected</strong><p>There are no rule-based alerts from the records currently available. Keep monitoring the live indicators.</p></div></article>');
  $("ci-insights").innerHTML = signals.join("");

  listRows("ci-financial", [
    { label:"Outstanding supplier bills", value:payablesResult.error ? "Unavailable" : money(payableTotal) },
    { label:"Overdue supplier bills", value:payablesResult.error ? "Unavailable" : money(overdueTotal) },
    { label:"Overdue bill count", value:payablesResult.error ? "Unavailable" : String(overdue.length) },
    { label:"Receipts · last 30 days", value:receiptsResult.error ? "Unavailable" : String(recentReceipts.length) }
  ], "No financial records to summarise.");
  listRows("ci-inventory", lowStock.slice(0,10).map(part => ({
    label:part.name || "Unnamed part",
    value:String(Number(part.quantity_in_stock || 0)) + " in stock"
  })), partsResult.error ? "Inventory records could not be loaded." : "No parts are below the low-stock threshold.");

  const invoiceBalance = outstandingInvoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0)), 0);
  listRows("ci-profit", [
    { label:"Invoices issued · last 30 days", value:invoicesResult.error ? "Unavailable" : money(invoicedTotal) },
    { label:"Receipts collected · last 30 days", value:receiptsResult.error ? "Unavailable" : groupMoney(collectedByCurrency) },
    { label:"Expenses recorded · last 30 days", value:expensesResult.error ? "Unavailable" : money(expenseTotal) },
    { label:"Outstanding customer invoices", value:invoicesResult.error ? "Unavailable" : money(invoiceBalance) }
  ], "No financial records to summarise.");

  const reviewRows = [];
  if (!receiptsResult.error) reviewRows.push({ label:"Voided receipts · last 30 days", value:String(voidedReceipts.length) + " · " + groupMoney(voidedReceiptGroups) });
  if (!invoicesResult.error) reviewRows.push({ label:"Invoices with discounts ≥20%", value:String(highDiscountInvoices.length) });
  if (!voidedPayablesResult.error) reviewRows.push({ label:"Voided supplier bills", value:String(voidedPayables.length) });
  listRows("ci-review", reviewRows, "No transaction review signals were found in the available records.");

  if (errors.length) status("Some data sources could not be read. Available figures are shown; check your role permissions and database connectivity. " + errors.join(" · "), "error");
  else status("Updated " + new Date().toLocaleTimeString() + ". Insights are calculated from live records using transparent business rules.", "success");
  window.lucide?.createIcons();
  if (refresh) refresh.disabled = false;
}


function answerQuestion(question) {
  const data = intelligenceSnapshot;
  if (!data) return "I'm still loading the workshop records. Refresh in a moment and ask again.";
  const q = String(question || "").toLowerCase();
  if (!q.trim()) return "Ask about open jobs, delayed work, collections, expenses, stock, supplier bills, invoices or transaction reviews.";
  if (/profit|margin|profitable|net income/.test(q)) return "I can show invoiced revenue, collections and recorded expenses separately. I won't label the difference as profit because the current records do not yet establish a complete, consistently linked cost basis for every job.";
  if (/delay|late|ageing|backlog|open job|workshop jobs/.test(q)) {
    const rows = data.delayedJobs.slice(0,5).map(job => "Job #" + (job.job_number || job.cro_number || "—") + " · " + (job.status || "Open"));
    return data.openJobs.length + " jobs are open. " + data.delayedJobs.length + " have been open for more than 7 days." + (rows.length ? " Review: " + rows.join("; ") + "." : "");
  }
  if (/collection|received|cash|revenue|sales|invoice/.test(q)) {
    const balance = data.outstandingInvoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0)), 0);
    return "Invoiced in the last 30 days: " + money(data.invoicedTotal) + ". Collections in the last 30 days: " + groupMoney(data.collectedByCurrency) + ". Outstanding customer invoice balances: " + money(balance) + ". These are separate measures, not net profit.";
  }
  if (/expense|spend|spent/.test(q)) return "Recorded expenses in the last 30 days total " + money(data.expenseTotal) + " across " + data.recentExpenses.length + " entries. This reflects the expenses recorded in Centric, not necessarily every workshop cost.";
  if (/stock|part|inventory|reorder/.test(q)) {
    const rows = data.lowStock.slice(0,6).map(part => (part.name || "Unnamed part") + " (" + Number(part.quantity_in_stock || 0) + " left)");
    return data.lowStock.length + " parts are at or below their low-stock threshold." + (rows.length ? " Watchlist: " + rows.join(", ") + "." : "");
  }
  if (/supplier|payable|overdue bill/.test(q)) return "There are " + data.overdue.length + " overdue supplier bills with an outstanding balance of " + money(data.overdueTotal) + ".";
  if (/void|cancel|discount|suspicious|fraud|review/.test(q)) return data.voidedReceipts.length + " receipts were voided in the last 30 days, " + data.highDiscountInvoices.length + " recent invoices have discounts of 20% or more, and " + data.voidedPayables.length + " supplier bills are marked void. These are review signals, not proof of fraud.";
  return "I can currently answer questions about open or delayed jobs, collections, invoices, recorded expenses, low stock, overdue supplier bills and transaction review signals. Try one of the suggested questions.";
}
function submitQuestion(question) {
  const input = $("ci-question");
  const answer = $("ci-answer");
  const value = String(question ?? input?.value ?? "").trim();
  if (!answer) return;
  answer.textContent = answerQuestion(value);
  if (input && question !== undefined) input.value = value;
}
$("ci-ask-submit")?.addEventListener("click", () => submitQuestion());
$("ci-question")?.addEventListener("keydown", event => { if (event.key === "Enter") submitQuestion(); });
document.querySelectorAll("[data-ci-question]").forEach(button => button.addEventListener("click", () => submitQuestion(button.dataset.ciQuestion)));

$("ci-refresh")?.addEventListener("click", () => loadIntelligence().catch(error => {
  console.error("Centric Intelligence refresh failed:", error);
  status("Could not refresh intelligence data. Check your connection and try again.", "error");
  $("ci-refresh").disabled = false;
}));
document.addEventListener("apr:access-ready", () => {
  if (["super_admin","accounting"].includes(document.body.dataset.role)) loadIntelligence().catch(error => {
    console.error("Centric Intelligence failed to load:", error);
    status("Could not load intelligence data. Check your connection and try again.", "error");
    $("ci-refresh").disabled = false;
  });
}, { once:true });
if (document.body.dataset.role) {
  if (["super_admin","accounting"].includes(document.body.dataset.role)) loadIntelligence().catch(error => {
    console.error(error); status("Could not load intelligence data.", "error"); $("ci-refresh").disabled = false;
  });
}
