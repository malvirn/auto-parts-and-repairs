import supabase from "./supabaseClient.js";

const ratesForm = document.getElementById("rates-form");
const ratesFormMessage = document.getElementById("rates-form-message");
const generateBtn = document.getElementById("generate-btn");
const commissionsTableBody = document.querySelector("#commissions-table tbody");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }

// ---------- Rates ----------

async function loadRates() {
  const { data, error } = await supabase.from("commission_rates").select("role, rate_pct");
  if (error) { console.error("Error loading commission rates:", error); return; }
  const technician = (data || []).find(r => r.role === "technician");
  const salesperson = (data || []).find(r => r.role === "salesperson");
  document.getElementById("rate-technician").value = technician ? technician.rate_pct : 5;
  document.getElementById("rate-salesperson").value = salesperson ? salesperson.rate_pct : 3;
}

ratesForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const technicianRate = parseFloat(document.getElementById("rate-technician").value);
  const salespersonRate = parseFloat(document.getElementById("rate-salesperson").value);

  ratesFormMessage.textContent = "Saving…"; ratesFormMessage.dataset.tone = "info";
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from("commission_rates").update({ rate_pct: technicianRate, updated_at: new Date().toISOString() }).eq("role", "technician"),
    supabase.from("commission_rates").update({ rate_pct: salespersonRate, updated_at: new Date().toISOString() }).eq("role", "salesperson"),
  ]);
  if (e1 || e2) { ratesFormMessage.textContent = "Failed to save: " + (e1 || e2).message; ratesFormMessage.dataset.tone = "error"; return; }
  ratesFormMessage.textContent = "Rates saved. These apply to commissions generated from now on — already-generated ones keep their original rate."; ratesFormMessage.dataset.tone = "success";
});

// ---------- Generate ----------
// Idempotent by design: commissions has a unique constraint on
// (source_type, source_id), so re-running this after a job/sale has
// already been credited just hits a duplicate-key error, which is caught
// and skipped rather than double-counting.

async function generateCommissions() {
  generateBtn.disabled = true;
  const original = generateBtn.innerHTML;
  generateBtn.innerHTML = `<i data-lucide="loader-circle"></i> Scanning…`;
  if (window.lucide) lucide.createIcons();

  try {
    const { data: rates } = await supabase.from("commission_rates").select("role, rate_pct");
    const technicianRate = Number((rates || []).find(r => r.role === "technician")?.rate_pct || 0);
    const salespersonRate = Number((rates || []).find(r => r.role === "salesperson")?.rate_pct || 0);

    let created = 0, skipped = 0;

    // Technicians — labour on completed repair jobs
    const { data: jobs } = await supabase
      .from("repair_jobs")
      .select("id, labour_cost, technician_id")
      .in("status", ["Ready for Pickup", "Collected"])
      .not("technician_id", "is", null);

    for (const job of jobs || []) {
      const base = Number(job.labour_cost || 0);
      if (base <= 0) continue;
      const { error } = await supabase.from("commissions").insert([{
        employee_id: job.technician_id, source_type: "repair_job", source_id: job.id,
        base_amount: base, rate_pct: technicianRate, commission_amount: Number((base * technicianRate / 100).toFixed(2)),
      }]);
      if (error) { if (error.code === "23505") skipped++; else console.error("Commission insert failed:", error); }
      else created++;
    }

    // Salespersons — confirmed sales orders
    const { data: orders } = await supabase
      .from("sales_orders")
      .select("id, total_usd, salesperson_id")
      .eq("status", "Confirmed")
      .not("salesperson_id", "is", null);

    for (const order of orders || []) {
      const base = Number(order.total_usd || 0);
      if (base <= 0) continue;
      const { error } = await supabase.from("commissions").insert([{
        employee_id: order.salesperson_id, source_type: "sale", source_id: order.id,
        base_amount: base, rate_pct: salespersonRate, commission_amount: Number((base * salespersonRate / 100).toFixed(2)),
      }]);
      if (error) { if (error.code === "23505") skipped++; else console.error("Commission insert failed:", error); }
      else created++;
    }

    alert(`Done. ${created} new commission${created === 1 ? "" : "s"} generated, ${skipped} already existed and were skipped.`);
    loadCommissions();
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = original;
    if (window.lucide) lucide.createIcons();
  }
}
generateBtn.addEventListener("click", generateCommissions);

// ---------- List ----------

async function loadCommissions() {
  const [{ data: commissions, error }, { data: employees }] = await Promise.all([
    supabase.from("commissions").select("*").order("created_at", { ascending: false }),
    supabase.from("technician_directory").select("id, full_name"),
  ]);

  if (error) {
    commissionsTableBody.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">Failed to load: ${escapeHtml(error.message)}. If you're not logged in as an admin, this is expected.</td></tr>`;
    return;
  }

  const names = Object.fromEntries((employees || []).map(e => [e.id, e.full_name]));

  commissionsTableBody.innerHTML = (commissions || []).length ? commissions.map(c => `
    <tr>
      <td>${escapeHtml(names[c.employee_id] || "—")}</td>
      <td>${c.source_type === "repair_job" ? "Repair Job" : "Sale"}</td>
      <td>${c.rate_pct}%</td>
      <td>${money(c.base_amount)}</td>
      <td>${money(c.commission_amount)}</td>
      <td><span class="status-badge ${c.status}">${c.status}</span></td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="empty-state">No commissions generated yet</td></tr>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadRates();
  loadCommissions();
});