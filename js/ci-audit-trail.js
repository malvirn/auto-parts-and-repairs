import supabase from "./supabaseClient.js";

const $ = id => document.getElementById(id);
const PAGE = 100;
const AREAS = {
  repair_jobs: "Job cards", job_parts: "Job parts", job_condition_reports: "Vehicle checklists", invoices: "Invoices",
  invoice_payments: "Payments", receipts: "Receipts", expenses: "Expenses", parts: "Parts & stock", restocks: "Stock purchases",
  customers: "Customers", vehicles: "Vehicles", payables: "Supplier bills"
};
const ACTIONS = { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" };
const state = { rows: [], total: 0, offset: 0, loading: false, done: false, ready: false, actors: new Map(), seq: 0 };

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = iso => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Harare", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(iso));
const dayInHarare = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Harare", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const ago = iso => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 86400 * 45) return Math.floor(s / 86400) + " d ago";
  return Math.floor(s / 86400 / 30) + " months ago";
};
const humanField = k => String(k).replace(/_/g, " ");
const showValue = v => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};
const actorLabel = r => r.actor_name || (r.actor_id ? "Unnamed user · " + String(r.actor_id).slice(0, 8) : "Not recorded");
const status = (msg, kind = "info") => { const n = $("ci-audit-status"); if (n) { n.textContent = msg; n.dataset.kind = kind; n.hidden = !msg; } };

function filters() {
  const from = $("ci-audit-from").value, to = $("ci-audit-to").value;
  return {
    from, to, actor: $("ci-audit-actor").value, area: $("ci-audit-area").value, action: $("ci-audit-action").value,
    text: $("ci-audit-text").value.trim().replace(/[,()%*]/g, " ").trim()
  };
}

function buildQuery(f, offset) {
  let q = supabase.from("audit_log").select("*", { count: "exact" })
    .order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + PAGE - 1);
  if (f.from) q = q.gte("occurred_at", f.from + "T00:00:00+02:00");
  if (f.to) { const next = new Date(f.to + "T00:00:00+02:00"); next.setDate(next.getDate() + 1); q = q.lt("occurred_at", next.toISOString()); }
  if (f.actor === "none") q = q.is("actor_id", null); else if (f.actor) q = q.eq("actor_id", f.actor);
  if (f.area) q = q.eq("table_name", f.area);
  if (f.action) q = q.eq("action", f.action);
  if (f.text) q = q.or(["summary", "record_label", "actor_name"].map(c => c + ".ilike.%" + f.text + "%").join(","));
  return q;
}

function rowHtml(r, i) {
  const badge = '<span class="ci-audit-badge" data-action="' + esc(r.action) + '">' + esc(ACTIONS[r.action] || r.action) + "</span>";
  const who = '<strong>' + esc(actorLabel(r)) + "</strong>" + (r.actor_role ? '<small>' + esc(String(r.actor_role).replace(/_/g, " ")) + "</small>" : "");
  return '<tr class="ci-audit-row" tabindex="0" data-audit-index="' + i + '">' +
    '<td title="' + esc(when(r.occurred_at)) + '">' + esc(when(r.occurred_at)) + "<small>" + esc(ago(r.occurred_at)) + "</small></td>" +
    "<td>" + who + "</td><td>" + badge + "</td><td>" + esc(AREAS[r.table_name] || r.table_name) + "</td>" +
    "<td>" + esc(r.record_label || "—") + "</td><td class=\"ci-audit-summary\">" + esc(r.summary || "") + "</td></tr>";
}

function render() {
  const body = $("ci-audit-body");
  if (!state.rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="ci-audit-empty">No activity matches these filters.</td></tr>';
  } else {
    body.innerHTML = state.rows.map(rowHtml).join("");
  }
  $("ci-audit-count").textContent = state.total
    ? "Showing " + state.rows.length.toLocaleString() + " of " + state.total.toLocaleString() + " events"
    : "";
  const more = $("ci-audit-more");
  more.hidden = state.done || !state.rows.length;
  more.disabled = state.loading;
  const deletes = state.rows.filter(r => r.action === "DELETE").length;
  $("ci-audit-deletes").textContent = deletes ? deletes + " deletion" + (deletes === 1 ? "" : "s") + " in view" : "";
}

function setupMissing(error) {
  const text = String(error?.message || "");
  return error?.code === "42P01" || error?.code === "PGRST205" || /audit_log/.test(text) && /(does not exist|schema cache)/i.test(text);
}

async function load(reset) {
  if (state.loading) return;
  state.loading = true;
  const seq = ++state.seq;
  if (reset) { state.rows = []; state.offset = 0; state.done = false; $("ci-audit-body").innerHTML = '<tr><td colspan="6" class="ci-audit-empty">Loading activity…</td></tr>'; }
  $("ci-audit-more").disabled = true;
  status("");
  const { data, error, count } = await buildQuery(filters(), state.offset);
  state.loading = false;
  if (seq !== state.seq) return;
  if (error) {
    state.rows = []; state.total = 0; render();
    $("ci-audit-body").innerHTML = '<tr><td colspan="6" class="ci-audit-empty">Activity could not be loaded.</td></tr>';
    if (setupMissing(error)) status("The audit trail has not been enabled in this database yet. Run the migration 20261123120000_activity_audit_trail.sql, then refresh.", "error");
    else if (/permission|denied|policy|row-level/i.test(error.message || "")) status("Your account does not have access to the audit trail. It is limited to accounting and super admin users.", "error");
    else status("Activity could not be loaded: " + error.message, "error");
    return;
  }
  state.ready = true;
  state.total = count ?? state.rows.length + (data?.length || 0);
  state.rows = state.rows.concat(data || []);
  state.offset = state.rows.length;
  state.done = (data || []).length < PAGE || state.rows.length >= state.total;
  render();
}

async function loadActors() {
  const select = $("ci-audit-actor");
  const { data } = await supabase.from("profiles").select("id,full_name,email,role").order("full_name", { ascending: true });
  (data || []).forEach(p => state.actors.set(p.id, p.full_name || p.email || p.id.slice(0, 8)));
  select.innerHTML = '<option value="">Everyone</option><option value="none">System / not recorded</option>' +
    [...state.actors.entries()].map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + "</option>").join("");
}

function openDetail(r) {
  const modal = $("ci-audit-modal");
  const meta = [
    ["When", when(r.occurred_at) + " (Harare) · " + ago(r.occurred_at)],
    ["Who", actorLabel(r) + (r.actor_role ? " · " + String(r.actor_role).replace(/_/g, " ") : "")],
    ["User ID", r.actor_id || "Not recorded"],
    ["Action", ACTIONS[r.action] || r.action],
    ["Area", AREAS[r.table_name] || r.table_name],
    ["Record", (r.record_label || "—") + (r.record_id ? "  ·  " + r.record_id : "")],
    ["Source", r.source === "backfill" ? "Rebuilt from earlier records (the original user may not have been stored)" : "Recorded live"]
  ];
  let table = "";
  if (r.action === "UPDATE") {
    const fields = r.changed_fields || Object.keys(r.new_data || {});
    table = '<h3>What changed</h3><div class="ci-detail-table-wrap"><table class="ci-detail-table"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>' +
      fields.map(f => "<tr><td>" + esc(humanField(f)) + '</td><td class="ci-audit-old">' + esc(showValue((r.old_data || {})[f])) + '</td><td class="ci-audit-new">' + esc(showValue((r.new_data || {})[f])) + "</td></tr>").join("") + "</tbody></table></div>";
  } else {
    const data = (r.action === "DELETE" ? r.old_data : r.new_data) || {};
    const keys = Object.keys(data).filter(k => data[k] !== null && data[k] !== "");
    table = '<h3>' + (r.action === "DELETE" ? "Record that was removed" : "Details recorded") + '</h3><div class="ci-detail-table-wrap"><table class="ci-detail-table"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>' +
      (keys.length ? keys.map(k => "<tr><td>" + esc(humanField(k)) + "</td><td>" + esc(showValue(data[k])) + "</td></tr>").join("") : '<tr><td colspan="2">No further details were stored.</td></tr>') + "</tbody></table></div>";
  }
  $("ci-audit-detail").innerHTML = '<p class="ci-audit-lead">' + esc(r.summary || "") + '</p><dl class="ci-audit-meta">' +
    meta.map(([k, v]) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd></div>").join("") + "</dl>" + table;
  modal.hidden = false;
  document.body.classList.add("ci-modal-open");
  modal.querySelector("[data-audit-close]")?.focus();
}
function closeDetail() { const m = $("ci-audit-modal"); if (m && !m.hidden) { m.hidden = true; document.body.classList.remove("ci-modal-open"); } }

function exportCsv() {
  if (!state.rows.length) return;
  const cols = ["occurred_at", "actor_name", "actor_role", "actor_id", "action", "table_name", "record_label", "record_id", "summary", "changed_fields", "old_data", "new_data", "source"];
  const cell = v => { const t = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return '"' + t.replace(/"/g, '""') + '"'; };
  const csv = [cols.join(",")].concat(state.rows.map(r => cols.map(c => cell(r[c])).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "centric-audit-trail-" + dayInHarare(new Date()) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function init() {
  if (!$("ci-audit")) return;
  const today = new Date(), weekAgo = new Date(Date.now() - 7 * 86400000);
  $("ci-audit-from").value = dayInHarare(weekAgo);
  $("ci-audit-to").value = dayInHarare(today);
  $("ci-audit-area").innerHTML = '<option value="">All areas</option>' + Object.entries(AREAS).map(([k, v]) => '<option value="' + k + '">' + esc(v) + "</option>").join("");
  let timer;
  $("ci-audit-filters").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => load(true), e.target.id === "ci-audit-text" ? 350 : 50); });
  $("ci-audit-filters").addEventListener("submit", e => { e.preventDefault(); load(true); });
  $("ci-audit-reset").addEventListener("click", () => {
    $("ci-audit-from").value = ""; $("ci-audit-to").value = ""; $("ci-audit-actor").value = ""; $("ci-audit-area").value = ""; $("ci-audit-action").value = ""; $("ci-audit-text").value = ""; load(true);
  });
  $("ci-audit-more").addEventListener("click", () => load(false));
  $("ci-audit-export").addEventListener("click", exportCsv);
  $("ci-audit-refresh").addEventListener("click", () => load(true));
  $("ci-audit-body").addEventListener("click", e => { const tr = e.target.closest("[data-audit-index]"); if (tr) openDetail(state.rows[Number(tr.dataset.auditIndex)]); });
  $("ci-audit-body").addEventListener("keydown", e => { if (e.key !== "Enter" && e.key !== " ") return; const tr = e.target.closest("[data-audit-index]"); if (tr) { e.preventDefault(); openDetail(state.rows[Number(tr.dataset.auditIndex)]); } });
  document.addEventListener("click", e => { if (e.target.closest("[data-audit-close]") || e.target === $("ci-audit-modal")) closeDetail(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDetail(); });
  loadActors().finally(() => load(true));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
