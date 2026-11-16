import supabase from "./supabaseClient.js";

const FINISHED = new Set(["processed", "ready for pickup", "collected", "unclaimed"]);
const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value) || 0);
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
  const [jobsResult, receiptsResult, partsResult, payablesResult] = await Promise.all([
    supabase.from("repair_jobs").select("id,job_number,cro_number,status,created_at,completed_at,total_cost").order("created_at", { ascending:false }).limit(1500),
    supabase.from("receipts").select("id,amount,issued_at,voided_at").is("voided_at", null).order("issued_at", { ascending:false }).limit(3000),
    supabase.from("parts").select("id,name,quantity_in_stock").order("quantity_in_stock", { ascending:true }).limit(1000),
    supabase.from("payables").select("id,bill_number,due_date,amount,amount_paid,status,voided_at,suppliers(name)").neq("status","paid").is("voided_at",null).limit(1500)
  ]);
  const errors = [jobsResult,receiptsResult,partsResult,payablesResult].filter(result => result.error).map(result => result.error.message);
  const jobs = jobsResult.data || [];
  const receipts = receiptsResult.data || [];
  const parts = partsResult.data || [];
  const payables = payablesResult.data || [];
  const openJobs = jobs.filter(job => !FINISHED.has(String(job.status || "").toLowerCase()));
  const recentCompleted = jobs.filter(job => job.completed_at && dateInHarare(job.completed_at) >= daysAgo(30));
  const recentReceipts = receipts.filter(receipt => receipt.issued_at && dateInHarare(receipt.issued_at) >= daysAgo(30));
  const collected = recentReceipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0);
  const lowStock = parts.filter(part => Number(part.quantity_in_stock || 0) < 3);
  const today = dateInHarare(new Date());
  const overdue = payables.filter(bill => bill.due_date && bill.due_date < today && Number(bill.amount || 0) - Number(bill.amount_paid || 0) > 0.01);
  const overdueTotal = overdue.reduce((sum, bill) => sum + Number(bill.amount || 0) - Number(bill.amount_paid || 0), 0);
  const payableTotal = payables.reduce((sum, bill) => sum + Math.max(0, Number(bill.amount || 0) - Number(bill.amount_paid || 0)), 0);

  $("ci-open-jobs").textContent = jobsResult.error ? "—" : String(openJobs.length);
  $("ci-completed").textContent = jobsResult.error ? "—" : String(recentCompleted.length);
  $("ci-collected").textContent = receiptsResult.error ? "—" : money(collected);
  $("ci-low-stock").textContent = partsResult.error ? "—" : String(lowStock.length);

  const signals = [];
  if (!jobsResult.error && openJobs.length >= 10) signals.push(insight("Workshop backlog is building", openJobs.length + " jobs are still open. Review ageing work and technician allocation.", "repairs.html", "alert-triangle"));
  if (!jobsResult.error && openJobs.length > 0 && openJobs.length < 10) signals.push(insight("Open work is manageable", openJobs.length + " jobs remain open. Check their status and expected completion dates.", "repairs.html", "wrench"));
  if (!partsResult.error && lowStock.length) signals.push(insight("Parts need replenishment", lowStock.length + " parts have fewer than 3 units available. Prioritise critical items before the next repair.", "shop.html", "package-alert"));
  if (!payablesResult.error && overdue.length) signals.push(insight("Supplier bills are overdue", overdue.length + " unpaid bills are past their due date, representing " + money(overdueTotal) + " in overdue balances.", "payables.html", "calendar-clock"));
  if (!receiptsResult.error && recentReceipts.length) signals.push(insight("Collections are being recorded", money(collected) + " was collected across " + recentReceipts.length + " receipts in the last 30 days.", "receipts.html", "trending-up"));
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

  if (errors.length) status("Some data sources could not be read. Available figures are shown; check your role permissions and database connectivity. " + errors.join(" · "), "error");
  else status("Updated " + new Date().toLocaleTimeString() + ". Insights are calculated from live records using transparent business rules.", "success");
  window.lucide?.createIcons();
  if (refresh) refresh.disabled = false;
}

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
