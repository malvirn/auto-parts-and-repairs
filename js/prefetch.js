// Warms the shared cache (see data-cache.js) with the data the dashboard,
// Customers and Job Cards pages need, run once during the sign-in loading
// screen so those pages render instantly on first visit instead of sitting
// blank while their own queries run.
//
// Deliberately self-contained (imports only supabase + cacheSet, not the
// page scripts themselves): app.js/customers.js/repairs.js assume their own
// page's elements exist, and importing them here — on the sign-in page —
// would run that DOM-dependent code against a page that doesn't have those
// elements. Each query below is kept in sync with the matching page's own
// fetcher by cache key.
import supabase from "./supabaseClient.js";
import { cacheSet } from "./data-cache.js";

async function getData(label, query) {
  const { data, error } = await query;
  if (error) { console.error(`Prefetch: error loading ${label}:`, error); return []; }
  return data || [];
}

async function prefetchDashboard() {
  const [jobs, customers, parts, receipts, payrollRuns, settingsRows] = await Promise.all([
    getData("repair jobs", supabase.from("repair_jobs").select(`
      id, job_number, status, total_cost, created_at, completed_at, ready_at, collected_at,
      customers ( full_name ),
      vehicles ( make, model, year, license_plate )
    `).order("created_at", { ascending: false })),
    getData("customers", supabase.from("customers").select("id, created_at")),
    getData("parts", supabase.from("parts").select("id, name, quantity_in_stock")),
    getData("receipts", supabase.from("receipts").select("id, amount, issued_at, repair_job_id")),
    getData("payroll runs", supabase.from("payroll_runs").select("year, month").order("year", { ascending: false }).order("month", { ascending: false }).limit(1)),
    getData("settings", supabase.from("settings").select("daily_jobs_target, daily_revenue_target").limit(1)),
  ]);
  cacheSet("dash:bundle", { jobs, customers, parts, receipts, payrollRuns, settings: settingsRows[0] });
}

async function prefetchCustomers() {
  const data = await getData("customers list", supabase.from("customers")
    .select("id, full_name, phone, customer_type, is_repeat_customer, vehicles(license_plate)")
    .order("created_at", { ascending: false }));
  cacheSet("customers:list", data);
}

async function prefetchJobs() {
  const [jobs, techs] = await Promise.all([
    getData("repair jobs", supabase.from("repair_jobs").select(`
      id, job_number, cro_number, portal_token, vehicle_id, fault_reported, diagnosis, diagnosis_eta, status, labour_cost, labour_hours, rate_tier_id, parts_cost, incidentals_cost, total_cost, technician_id, ready_at, collected_at, created_at, ai_suggested_causes, fuel_level_in, odometer_in, driver_name, driver_phone, picked_up_by,
      customers ( full_name, phone, email, customer_type ),
      vehicles ( make, model, year, license_plate, engine_number, chassis_number, body_type )
    `).order("created_at", { ascending: false })),
    getData("technicians", supabase.from("technician_directory").select("id, full_name")),
  ]);
  cacheSet("repairs:jobs", { jobs, techs });
}

// Fire-and-forget by design: called alongside the sign-in loading screen's
// own animation/delay, so it overlaps with time the person is looking at
// the screen anyway rather than adding any extra wait of its own. A failure
// here just means the first page visit falls back to its normal fetch.
export function prefetchCoreData() {
  Promise.all([prefetchDashboard(), prefetchCustomers(), prefetchJobs()])
    .catch(error => console.error("Prefetch failed (pages will fetch normally):", error));
}
