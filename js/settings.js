import supabase from "./supabaseClient.js";
import { fingerprintSupported, registerFingerprint, listFingerprints, removeFingerprint, MAX_FINGERPRINTS } from "./passkey.js";
import { confirmTypedDelete } from "./bulk-delete.js";
import { getRateDetails } from "./currency.js";

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function say(id, text, ok = true) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "smsg " + (text ? (ok ? "msg-ok" : "msg-er") : "");
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-circle"></i> ${label || "Saving…"}`; }
  else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
  if (window.lucide) lucide.createIcons();
}

// ---- Appearance (Light / Dark / System) ----
const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
function currentMode() {
  try { return localStorage.getItem("apr-theme") || "light"; } catch (e) { return "light"; }
}
function applyMode(mode) {
  const theme = mode === "system" ? (mq && mq.matches ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.backgroundColor = theme === "dark" ? "#171c24" : "#e9edf2";
  document.documentElement.style.colorScheme = theme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === "dark" ? "#171c24" : "#e9edf2";
  document.querySelectorAll("#modes button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.m === mode)));
  const now = $("mode-now");
  if (now) now.textContent = mode === "system" ? `Following your device. Currently ${theme}.` : "";
}
document.querySelectorAll("#modes button").forEach(b => b.addEventListener("click", () => {
  try { localStorage.setItem("apr-theme", b.dataset.m); } catch (e) {}
  applyMode(b.dataset.m);
}));
mq?.addEventListener?.("change", () => { if (currentMode() === "system") applyMode("system"); });
applyMode(currentMode());

// ---- Device passkey sign-in ----
async function loadFingerprints() {
  const list = $("fp-list");
  if (!list) return;
  const supported = await fingerprintSupported();
  let items = [];
  try { items = await listFingerprints(); }
  catch (e) {
    list.innerHTML = `<div class="sx" style="color:var(--danger)">Couldn't load device passkeys: ${escapeHtml(e.message)}</div>`;
    updateFingerprintDeleteControls();
    return;
  }

  list.innerHTML = items.length ? items.map(f => `
    <div class="sr fp-row" data-fp-id="${escapeHtml(f.id)}">
      <label class="fp-select"><input type="checkbox" class="fp-select-checkbox" value="${escapeHtml(f.id)}" aria-label="Select ${escapeHtml(f.label)}" /> Select</label>
      <div class="t"><b><i data-lucide="fingerprint" class="fp-row-ic"></i> ${escapeHtml(f.label)}</b>
        <span>Added ${new Date(f.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}${f.last_used_at ? ` · last used ${new Date(f.last_used_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : " · not used yet"}</span></div>
      <button type="button" class="btn btn--danger fp-del" data-id="${f.id}" data-label="${escapeHtml(f.label)}"><i data-lucide="trash-2"></i> Remove</button>
    </div>`).join("")
    : `<div class="sr"><div class="t"><b>No device passkeys yet</b><span>Add one below to sign in with fingerprint, Face ID, or another supported device method.</span></div></div>`;

  const full = items.length >= MAX_FINGERPRINTS;
  const addBtn = $("fp-add");
  const label = $("fp-label");
  if (addBtn) addBtn.disabled = full || !supported;
  if (label) label.disabled = full || !supported;
  if (!supported) say("m-fp", "This device or browser doesn't offer a platform passkey. Open the app over https on a phone or computer that supports device sign-in.", false);
  else if (full) say("m-fp", `This account has ${MAX_FINGERPRINTS} device passkeys, the most allowed. Remove one to add another.`, true);
  if (window.lucide) lucide.createIcons();

  list.querySelectorAll(".fp-del").forEach(b => b.addEventListener("click", async () => {
    if (!(await confirmTypedDelete(`device passkey "${b.dataset.label}"`))) return;
    try { await removeFingerprint(b.dataset.id); say("m-fp", "Device passkey removed."); }
    catch (e) { say("m-fp", "Couldn't remove: " + e.message, false); }
    loadFingerprints();
  }));
  list.querySelectorAll(".fp-select-checkbox").forEach(input => input.addEventListener("change", updateFingerprintDeleteControls));
  updateFingerprintDeleteControls();
}

function updateFingerprintDeleteControls() {
  const boxes = [...document.querySelectorAll(".fp-select-checkbox")];
  const selectedCount = boxes.filter(box => box.checked).length;
  const selectAll = $("fp-select-all");
  const deleteButton = $("fp-delete-selected");
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && selectedCount === boxes.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < boxes.length;
    selectAll.disabled = boxes.length === 0;
  }
  if (deleteButton) {
    deleteButton.disabled = selectedCount === 0;
    deleteButton.textContent = selectedCount ? `Remove selected (${selectedCount})` : "Remove selected";
  }
}

$("fp-select-all")?.addEventListener("change", event => {
  document.querySelectorAll(".fp-select-checkbox").forEach(box => { box.checked = event.currentTarget.checked; });
  updateFingerprintDeleteControls();
});

$("fp-delete-selected")?.addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".fp-select-checkbox:checked")].map(box => box.value);
  if (!ids.length || !(await confirmTypedDelete(`${ids.length} selected device passkey${ids.length === 1 ? "" : "s"}`))) return;
  let removed = 0;
  try {
    for (const id of ids) {
      await removeFingerprint(id);
      removed += 1;
    }
    say("m-fp", `${removed} device passkey${removed === 1 ? "" : "s"} removed.`);
  } catch (error) {
    say("m-fp", `${removed} removed before an error: ${error.message || String(error)}`, false);
  } finally {
    await loadFingerprints();
  }
});

$("fp-add")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const label = ($("fp-label")?.value || "").trim() || "My device";
  busy(btn, true, "Verify with your device…");
  say("m-fp", "");
  try {
    await registerFingerprint(label);
    $("fp-label").value = "";
    say("m-fp", `"${label}" added. Next time, choose fingerprint / Face ID on the sign-in page.`);
  } catch (err) {
    say("m-fp", err.message || String(err), false);
  } finally {
    busy(btn, false);
    loadFingerprints();
  }
});

// ---- Install app ----
function refreshInstall() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const btn = $("inst-btn");
  if (!btn) return;
  if (standalone) {
    $("inst-state").textContent = "Installed";
    $("inst-hint").textContent = "You're using the installed app.";
    btn.hidden = true;
  }
}
$("inst-btn")?.addEventListener("click", () => window.aprInstall ? window.aprInstall() : alert("To install: open the browser menu and tap Install app or Add to Home screen."));
window.addEventListener("appinstalled", refreshInstall);

// ---- Business details ----
async function loadBusinessSettings() {
  const { data, error } = await supabase.from("business_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return;
  const set = (id, value) => { const el = $(id); if (el) el.value = value || ""; };
  set("biz-name", data.business_name);
  set("biz-tagline", data.tagline);
  set("biz-address", data.address);
  set("biz-phone", data.phone);
  set("biz-email", data.email);
  set("biz-hours", data.hours);
}

$("save-business-btn")?.addEventListener("click", async (e) => {
  const get = (id) => $(id)?.value.trim() || "";
  if (!get("biz-name")) { say("m-biz", "Enter the business name.", false); return; }
  busy(e.currentTarget, true);
  const { error } = await supabase.from("business_settings").update({
    business_name: get("biz-name"),
    tagline: get("biz-tagline"),
    address: get("biz-address"),
    phone: get("biz-phone"),
    email: get("biz-email"),
    hours: get("biz-hours"),
  }).eq("id", 1);
  busy(e.currentTarget, false);
  say("m-biz", error ? "Couldn't save: " + error.message : "Business details saved.", !error);
});

// ---- Labour charges (vehicle_rate_tiers) ----
let tiers = [];

async function loadTiers() {
  const { data, error } = await supabase.from("vehicle_rate_tiers").select("*").order("sort_order");
  const list = $("tiers-list");
  if (error) {
    list.innerHTML = `<div class="sx" style="color:var(--danger)">Couldn't load labour charges: ${escapeHtml(error.message)}</div>`;
    updateTierDeleteControls();
    return;
  }
  tiers = data || [];
  if (!tiers.length) {
    list.innerHTML = `<div class="sx" style="color:var(--text-muted)">No labour charges yet. Add the first one below.</div>`;
    updateTierDeleteControls();
    return;
  }
  list.innerHTML = tiers.map(t => `
    <form class="tier-row" data-id="${t.id}" novalidate>
      <label class="tier-select"><input type="checkbox" class="tier-select-checkbox" value="${t.id}" aria-label="Select ${escapeHtml(t.tier_name)}" /> Select</label>
      <div class="field"><label for="tn-${t.id}">Name</label><input id="tn-${t.id}" name="name" type="text" maxlength="60" value="${escapeHtml(t.tier_name)}" /></div>
      <div class="field"><label for="tr-${t.id}">Per hour ($)</label><input id="tr-${t.id}" name="rate" type="number" step="0.01" min="0" value="${Number(t.hourly_rate).toFixed(2)}" /></div>
      <div class="field wide"><label for="tm-${t.id}">Makes</label><input id="tm-${t.id}" name="makes" type="text" value="${escapeHtml((t.makes || []).join(", "))}" placeholder="Picked by hand only" /></div>
      <label class="def"><input type="radio" name="tier-default" ${t.is_default ? "checked" : ""} aria-label="Default labour charge" /> Default</label>
      <div class="acts">
        <button type="submit" class="btn" aria-label="Save ${escapeHtml(t.tier_name)}"><i data-lucide="check"></i> Save</button>
        <button type="button" class="btn btn--danger tier-del" aria-label="Delete ${escapeHtml(t.tier_name)}"><i data-lucide="trash-2"></i> Delete</button>
      </div>
    </form>`).join("");
  if (window.lucide) lucide.createIcons();

  list.querySelectorAll("form.tier-row").forEach(f => {
    const id = f.dataset.id;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = f.elements.name.value.trim();
      const rate = parseFloat(f.elements.rate.value);
      const makes = f.elements.makes.value.split(",").map(m => m.trim()).filter(Boolean);
      if (!name) { say("tier-form-message", "Each labour charge needs a name.", false); return; }
      if (!(rate >= 0) || f.elements.rate.value === "") { say("tier-form-message", "Enter a valid charge per hour.", false); return; }
      const btn = f.querySelector("button[type=submit]");
      busy(btn, true, "");
      const { error } = await supabase.from("vehicle_rate_tiers").update({ tier_name: name, hourly_rate: rate, makes }).eq("id", id);
      busy(btn, false);
      say("tier-form-message", error ? "Couldn't save: " + error.message : `${name} saved.`, !error);
      if (!error) loadTiers();
    });
    f.querySelector("input[type=radio]").addEventListener("change", () => setDefaultTier(id));
    f.querySelector(".tier-del").addEventListener("click", async () => {
      const t = tiers.find(x => x.id === id);
      if (!(await confirmTypedDelete(`labour charge "${t?.tier_name}"? Jobs that already used it keep their recorded labour cost`))) return;
      const { data, error } = await supabase.from("vehicle_rate_tiers").delete().eq("id", id).select("id");
      say("tier-form-message", error
        ? (/foreign key|violates/i.test(error.message) ? "This charge is used by existing jobs, so it can't be deleted. Rename it or change its rate instead." : "Couldn't delete: " + error.message)
        : data?.length ? "Labour charge deleted." : "No charge was deleted. Check your role permissions and try again.", !error && Boolean(data?.length));
      if (!error) loadTiers();
    });
  });
  list.querySelectorAll(".tier-select-checkbox").forEach(input => input.addEventListener("change", updateTierDeleteControls));
  updateTierDeleteControls();
}

function updateTierDeleteControls() {
  const boxes = [...document.querySelectorAll(".tier-select-checkbox")];
  const selected = boxes.filter(box => box.checked);
  const selectAll = $("tiers-select-all");
  const deleteButton = $("tiers-delete-selected");
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && selected.length === boxes.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < boxes.length;
    selectAll.disabled = boxes.length === 0;
  }
  if (deleteButton) {
    deleteButton.disabled = selected.length === 0;
    deleteButton.textContent = selected.length ? `Delete selected (${selected.length})` : "Delete selected";
  }
}

$("tiers-select-all")?.addEventListener("change", event => {
  document.querySelectorAll(".tier-select-checkbox").forEach(box => { box.checked = event.currentTarget.checked; });
  updateTierDeleteControls();
});

$("tiers-delete-selected")?.addEventListener("click", async () => {
  const ids = [...document.querySelectorAll(".tier-select-checkbox:checked")].map(box => box.value);
  const message = $("tiers-delete-message");
  if (!ids.length || !(await confirmTypedDelete(`${ids.length} selected labour charge${ids.length === 1 ? "" : "s"}`))) return;
  const { data, error } = await supabase.from("vehicle_rate_tiers").delete().in("id", ids).select("id");
  if (error) {
    message.textContent = /foreign key|violates/i.test(error.message)
      ? "Some selected charges are used by existing jobs, so they cannot be deleted."
      : "Couldn't delete selected charges: " + error.message;
    message.dataset.tone = "error";
    return;
  }
  if (!data?.length) {
    message.textContent = "No charges were deleted. Check your role permissions and try again.";
    message.dataset.tone = "error";
    return;
  }
  message.textContent = `${data.length} labour charge${data.length === 1 ? "" : "s"} deleted.`;
  message.dataset.tone = "";
  loadTiers();
});

async function setDefaultTier(id) {
  const { error: clearErr } = await supabase.from("vehicle_rate_tiers").update({ is_default: false }).neq("id", id);
  const { error } = clearErr ? { error: clearErr } : await supabase.from("vehicle_rate_tiers").update({ is_default: true }).eq("id", id);
  say("tier-form-message", error ? "Couldn't change the default: " + error.message : "Default labour charge updated.", !error);
  loadTiers();
}

$("tier-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const tier_name = $("tier-name").value.trim();
  const rateRaw = $("tier-rate").value;
  const hourly_rate = parseFloat(rateRaw);
  const makes = $("tier-makes").value.split(",").map(m => m.trim()).filter(Boolean);
  const is_default = $("tier-default").checked;
  if (!tier_name) { say("tier-form-message", "Enter a name for the labour charge.", false); return; }
  if (rateRaw === "" || !(hourly_rate >= 0)) { say("tier-form-message", "Enter a valid charge per hour.", false); return; }
  if (tiers.some(t => t.tier_name.toLowerCase() === tier_name.toLowerCase())) { say("tier-form-message", "A labour charge with that name already exists.", false); return; }

  const btn = e.currentTarget.querySelector("button[type=submit]");
  busy(btn, true, "Adding…");
  if (is_default) await supabase.from("vehicle_rate_tiers").update({ is_default: false }).eq("is_default", true);
  const sort_order = tiers.reduce((m, t) => Math.max(m, t.sort_order || 0), 0) + 1;
  const { error } = await supabase.from("vehicle_rate_tiers").insert([{ tier_name, hourly_rate, makes, is_default, sort_order }]);
  busy(btn, false);
  if (error) { say("tier-form-message", "Couldn't add: " + error.message, false); return; }
  e.currentTarget.reset();
  say("tier-form-message", `${tier_name} added.`);
  loadTiers();
});

// ---- Notifications ----
async function loadNotifications() {
  const list = $("notifications-list");
  if (!list) return;
  const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20);
  if (error) { list.innerHTML = `<div class="sx" style="color:var(--danger)">Couldn't load: ${escapeHtml(error.message)}</div>`; return; }
  if (!data || data.length === 0) { list.innerHTML = `<div class="sx" style="color:var(--text-muted)">No notifications yet.</div>`; return; }
  list.innerHTML = data.map(n => `
    <div class="sr"><div class="t"><b style="font-weight:500">${escapeHtml(n.message)}</b></div>
    <span style="font-size:12.5px; color:var(--text-muted); white-space:nowrap">${new Date(n.created_at).toLocaleDateString()}</span></div>
  `).join("");
}

// ---- User guide ----
const GUIDE_TOPICS = [
  { title: "Opening a job card", body: "Go to Job Cards. Choose Private customer or Company car, pick the customer or company (or add a new one), pick or register the vehicle, describe the fault, then fill in anything else you already know: diagnosis, mechanic, hours, parts and incidentals. Click Create Job Card." },
  { title: "Company cars", body: "Choose Company car, then pick the company or add it right there. Record who brought the car in. Company jobs get an ICRO number; private jobs get an ECRO number." },
  { title: "Labour charges", body: "Charges per hour live in Settings → Labour charges. Each charge lists the makes it applies to, so the job card picks it automatically from the vehicle's make. One charge is the default for makes that don't match." },
  { title: "Adding parts to a job", body: "On the new job card or an open job card, pick a part from the Shop list, set the quantity and click +. Stock is taken from the Shop automatically." },
  { title: "Printing a job card", body: "Open the job card from the queue and click Print. It prints the customer, vehicle, fault, diagnosis, parts, labour and totals with signature lines." },
  { title: "Generating a receipt", body: "When a job's status is Ready for Pickup, open its job card and click Generate Receipt, or go to Receipts." },
  { title: "Understanding job statuses", body: "Received → Diagnosing → Ready for Pickup → Collected. Unclaimed means a finished job hasn't been picked up within the free pickup window." },
];
const guideAccordion = $("guide-accordion");
if (guideAccordion) {
  guideAccordion.innerHTML = GUIDE_TOPICS.map((t, i) => `
    <div class="accordion-item" data-i="${i}">
      <button type="button" class="accordion-header" aria-expanded="false">${escapeHtml(t.title)} <i data-lucide="chevron-down"></i></button>
      <div class="accordion-body">${escapeHtml(t.body)}</div>
    </div>
  `).join("");
  guideAccordion.querySelectorAll(".accordion-header").forEach(h => {
    h.addEventListener("click", () => {
      const item = h.closest(".accordion-item");
      item.classList.toggle("open");
      h.setAttribute("aria-expanded", String(item.classList.contains("open")));
    });
  });
}

// ---- Currency ----
// ---- Daily Goals ----
async function loadGoals() {
  const jobsInput = $("goal-jobs");
  if (!jobsInput) return;
  const { data } = await supabase.from("settings").select("daily_jobs_target, daily_revenue_target").maybeSingle();
  if (!data) return;
  jobsInput.value = data.daily_jobs_target;
  $("goal-revenue").value = data.daily_revenue_target;
}
$("save-goals-btn")?.addEventListener("click", async (e) => {
  const jobs = parseInt($("goal-jobs")?.value, 10);
  const revenue = parseFloat($("goal-revenue")?.value);
  if (!Number.isFinite(jobs) || jobs < 1) { say("m-goals", "Enter a job cards target of at least 1.", false); return; }
  if (!Number.isFinite(revenue) || revenue < 0) { say("m-goals", "Enter a revenue target of 0 or more.", false); return; }
  busy(e.currentTarget, true);
  const { error } = await supabase.from("settings").update({ daily_jobs_target: jobs, daily_revenue_target: revenue }).eq("id", true);
  busy(e.currentTarget, false);
  say("m-goals", error ? "Couldn't save: " + error.message : "Daily goals saved.", !error);
  if (!error) loadGoals();
});

const ZIMRATE_CACHE_KEY = "apr-zimrate-reference-v1";
const ZIMRATE_CACHE_MS = 30 * 60 * 1000;

function renderZimRate(records, fetchedAt, stale = false) {
  const target = $("zimrate-rates");
  const updated = $("zimrate-updated");
  if (!target) return;
  const rows = Array.isArray(records) ? records.filter(row => row?.currencyPair?.startsWith("USD/ZiG")) : [];
  const latest = predicate => rows.filter(predicate).sort((a,b) => new Date(b.scrapedAt || 0) - new Date(a.scrapedAt || 0))[0];
  const low = latest(row => /InformalLow/i.test(row.currencyPair));
  const high = latest(row => /InformalHigh/i.test(row.currencyPair));
  const cash = latest(row => /Cash/i.test(row.currencyPair));
  const official = latest(row => row.currencyPair === "USD/ZiG" && /official/i.test(row.source?.type || ""));
  const business = latest(row => /MaxBusiness/i.test(row.currencyPair));
  const value = row => {
    if (!row) return "Unavailable";
    const number = Number(row.buyRate ?? row.sellRate);
    return Number.isFinite(number) && number > 0 ? number.toLocaleString("en-US", {minimumFractionDigits:2,maximumFractionDigits:4}) + " ZiG" : "Unavailable";
  };
  const items = [
    ["Official reference", official],
    ["Parallel market low", low],
    ["Parallel market high", high],
    ["Cash reference", cash],
    ["Business reference", business],
  ].filter(([,row]) => row);
  target.innerHTML = items.length
    ? items.map(([label,row]) => `<div class="t"><b>${escapeHtml(label)}</b><span>${escapeHtml(value(row))} · ${escapeHtml(row.source?.name || "ZimRate")}</span></div>`).join("")
    : '<span>No USD/ZiG market reference rates were returned.</span>';
  const sourceDate = rows.map(row => row.scrapedAt).filter(Boolean).sort().at(-1);
  updated.textContent = `${stale ? "Cached reference" : "Updated"} ${sourceDate ? new Date(sourceDate).toLocaleString() : new Date(fetchedAt).toLocaleString()}.`;
}

async function loadZimRate(force = false) {
  const target = $("zimrate-rates");
  if (!target) return;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(ZIMRATE_CACHE_KEY) || "null"); } catch {}
  if (!force && cached?.records && Date.now() - cached.fetchedAt < ZIMRATE_CACHE_MS) {
    renderZimRate(cached.records, cached.fetchedAt);
    return;
  }
  if (!cached?.records) target.textContent = "Loading market reference…";
  const button = $("refresh-zimrate");
  if (button) button.disabled = true;
  try {
    const response = await fetch("https://zimrate.com/api/rates/latest", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`ZimRate returned HTTP ${response.status}`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error("ZimRate returned an unexpected response.");
    const entry = { records, fetchedAt: Date.now() };
    try { localStorage.setItem(ZIMRATE_CACHE_KEY, JSON.stringify(entry)); } catch {}
    renderZimRate(records, entry.fetchedAt);
  } catch (error) {
    if (cached?.records) {
      renderZimRate(cached.records, cached.fetchedAt, true);
      $("zimrate-updated").textContent += ` Refresh failed: ${error.message}`;
    } else {
      target.textContent = "Market reference unavailable. Check your connection and refresh.";
      $("zimrate-updated").textContent = error.message || "Could not load ZimRate.";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

$("refresh-zimrate")?.addEventListener("click", () => loadZimRate(true));

async function loadRate() {
  const rateDisplay = $("exchange-rate");
  if (!rateDisplay) return;
  rateDisplay.textContent = "Loading…";
  try {
    const result = await getRateDetails({ forceRefresh: true });
    rateDisplay.textContent = Number(result.rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    $("rate-updated").textContent = `${result.stale ? "Saved offline copy" : "Bank rate"} · Updated ${result.updatedAt ? new Date(result.updatedAt).toLocaleString() : "date unavailable"}.`;
    if ($("bank-rate-input")) $("bank-rate-input").value = Number(result.rate).toFixed(6);
  } catch (error) {
    rateDisplay.textContent = "Not set";
    $("rate-updated").textContent = error.message || "Enter the bank rate to enable currency conversions.";
  }
}

$("save-bank-rate")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const rate = Number($("bank-rate-input")?.value);
  const message = $("bank-rate-message");
  if (!Number.isFinite(rate) || rate <= 0) {
    if (message) { message.textContent = "Enter a bank rate greater than zero."; message.style.color = "var(--danger)"; }
    return;
  }
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Saving…";
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Your session has expired. Sign in again.");
    const { error } = await supabase.from("business_settings").update({
      usd_to_zig_bank_rate: rate,
      exchange_rate_updated_at: new Date().toISOString(),
      exchange_rate_updated_by: user.id,
    }).eq("id", 1);
    if (error) throw error;
    if (message) { message.textContent = "Bank rate saved. New conversions will use this rate."; message.style.color = "var(--success)"; }
    await loadRate();
  } catch (error) {
    if (message) { message.textContent = "Couldn't save bank rate: " + (error.message || String(error)); message.style.color = "var(--danger)"; }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

// ---- Account ----
async function loadAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  $("account-email").textContent = user.email;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const labels = { super_admin: "Super Admin", accounting: "Accounting", staff: "Staff" };
  $("account-role").textContent = profile ? (labels[profile.role] || profile.role) : "—";
  if ($("bank-rate-editor")) $("bank-rate-editor").hidden = profile?.role !== "super_admin";
}
$("reset-password-btn")?.addEventListener("click", async (e) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  busy(e.currentTarget, true, "Sending…");
  try {
    const redirectTo = new URL("reset-password.html", window.location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo });
    say("m-account", error ? "Couldn't send: " + error.message : `Password reset email sent to ${user.email}.`, !error);
  } catch (error) {
    console.error("Couldn't send password reset email:", error);
    say("m-account", "Couldn't send the reset email. Check your connection and try again.", false);
  } finally {
    busy(e.currentTarget, false);
  }
});
$("sign-out-btn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("../login.html");
});

document.addEventListener("DOMContentLoaded", () => {
  const sectionOrder = ["account", "access-control", "fingerprint", "appearance", "about", "currency", "labour", "daily-goals", "notifications", "app", "guide"];
  const settingsSections = document.querySelector(".sg-wrap");
  if (settingsSections) {
    sectionOrder.forEach(id => {
      const section = $(id);
      if (section) settingsSections.append(section);
    });
  }
  loadBusinessSettings();
  loadGoals();
  loadFingerprints();
  refreshInstall();
  loadTiers();
  loadNotifications();
  loadRate();
  loadZimRate();
  loadAccount();
  if (window.lucide) lucide.createIcons();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
});
