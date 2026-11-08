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
import { cacheSet, cacheClear } from "./data-cache.js";

const SYNC_TIMEOUT_MS = 15000;

// Runs one query. Never throws: returns { data, ok } so a single blocked
// table (e.g. RLS hiding payroll from a staff account) doesn't sink the sync.
async function getData(label, query) {
  try {
    const { data, error } = await query;
    if (error) throw error;
    return { data: data || [], ok: true };
  } catch (error) {
    console.error(`Sync: error loading ${label}:`, error);
    return { data: [], ok: false, error };
  }
}

async function prefetchDashboard() {
  const [jobs, customers, parts, receipts, payrollRuns, settingsRows] = await Promise.all([
    getData("repair jobs", supabase.from("repair_jobs").select(`
      id, job_number, status, total_cost, created_at, completed_at, ready_at, collected_at,
      customers ( full_name ),
      vehicles ( make, model, year, license_plate )
    `).order("created_at", { ascending: false })),
    getData("customers", supabase.from("customers").select("id, created_at").is("deleted_at", null)),
    getData("parts", supabase.from("parts").select("id, name, quantity_in_stock")),
    getData("receipts", supabase.from("receipts").select("id, amount, issued_at, repair_job_id, voided_at")),
    getData("payroll runs", supabase.from("payroll_runs").select("year, month").order("year", { ascending: false }).order("month", { ascending: false }).limit(1)),
    getData("settings", supabase.from("settings").select("daily_jobs_target, daily_revenue_target").limit(1)),
  ]);
  // The two core reads decide whether the dashboard bundle is trustworthy;
  // the rest are tolerated (a role may legitimately not see them).
  const ok = jobs.ok && customers.ok;
  if (ok) {
    cacheSet("dash:bundle", {
      jobs: jobs.data, customers: customers.data, parts: parts.data, receipts: receipts.data,
      payrollRuns: payrollRuns.data, settings: settingsRows.data[0],
    });
  }
  return ok;
}

async function prefetchCustomers() {
  const r = await getData("customers list", supabase.from("customers")
    .select("id, full_name, phone, customer_type, is_repeat_customer, deleted_at, vehicles(license_plate)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false }));
  if (r.ok) cacheSet("customers:active-list", r.data);
  return r.ok;
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
  if (jobs.ok) cacheSet("repairs:jobs", { jobs: jobs.data, techs: techs.data });
  return jobs.ok;
}

// The real sign-in sync: clears the previous session's cache, then pulls
// the dashboard, customers and job-card data into it. Resolves with
// { synced, failed } (names of the datasets). Rejects only if NOTHING could
// be read (backend unreachable, session rejected, or every table blocked),
// or if it takes longer than SYNC_TIMEOUT_MS.
export async function syncUserData() {
  cacheClear();
  const groups = { Dashboard: prefetchDashboard, Customers: prefetchCustomers, "Job cards": prefetchJobs };
  const work = Promise.all(Object.entries(groups).map(async ([name, run]) => {
    try { return [name, await run()]; } catch (e) { console.error(`Sync: ${name} failed:`, e); return [name, false]; }
  }));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Syncing your data timed out. Check your connection and try again.")), SYNC_TIMEOUT_MS);
  });
  const results = await Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  const synced = results.filter(([, ok]) => ok).map(([n]) => n);
  const failed = results.filter(([, ok]) => !ok).map(([n]) => n);
  if (!synced.length) throw new Error("Couldn't sync your data from the server. Check your connection and try again.");
  return { synced, failed };
}

// Kept for any caller that just wants to warm the cache without waiting.
export function prefetchCoreData() {
  syncUserData().catch(error => console.error("Prefetch failed (pages will fetch normally):", error));
}
