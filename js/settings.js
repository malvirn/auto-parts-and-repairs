import supabase from "./supabaseClient.js";
import { fingerprintSupported, registerFingerprint, listFingerprints, removeFingerprint, MAX_FINGERPRINTS } from "./passkey.js";

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

// ---- Fingerprint sign-in ----
async function loadFingerprints() {
  const list = $("fp-list");
  if (!list) return;
  const supported = await fingerprintSupported();
  let items = [];
  try { items = await listFingerprints(); }
  catch (e) { list.innerHTML = `<div class="sx" style="color:var(--danger)">Couldn't load fingerprints: ${escapeHtml(e.message)}</div>`; return; }

  list.innerHTML = items.length ? items.map(f => `
    <div class="sr">
      <div class="t"><b><i data-lucide="fingerprint" class="fp-row-ic"></i> ${escapeHtml(f.label)}</b>
        <span>Added ${new Date(f.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}${f.last_used_at ? ` · last used ${new Date(f.last_used_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : " · not used yet"}</span></div>
      <button type="button" class="btn btn--danger fp-del" data-id="${f.id}" data-label="${escapeHtml(f.label)}"><i data-lucide="trash-2"></i> Remove</button>
    </div>`).join("")
    : `<div class="sr"><div class="t"><b>No fingerprints yet</b><span>Add one below to sign in with your finger.</span></div></div>`;

  const full = items.length >= MAX_FINGERPRINTS;
  const addBtn = $("fp-add");
  const label = $("fp-label");
  if (addBtn) addBtn.disabled = full || !supported;
  if (label) label.disabled = full || !supported;
  if (!supported) say("m-fp", "This device or browser doesn't offer fingerprint sign-in. Open the app on a phone or computer with a fingerprint sensor (over https).", false);
  else if (full) say("m-fp", `This account has ${MAX_FINGERPRINTS} fingerprints, the most allowed. Remove one to add another.`, true);
  if (window.lucide) lucide.createIcons();

  list.querySelectorAll(".fp-del").forEach(b => b.addEventListener("click", async () => {
    if (!confirm(`Remove "${b.dataset.label}"? You won't be able to sign in with it any more.`)) return;
    try { await removeFingerprint(b.dataset.id); say("m-fp", "Fingerprint removed."); }
    catch (e) { say("m-fp", "Couldn't remove: " + e.message, false); }
    loadFingerprints();
  }));
}

$("fp-add")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const label = ($("fp-label")?.value || "").trim() || "Fingerprint";
  busy(btn, true, "Touch the sensor…");
  say("m-fp", "");
  try {
    await registerFingerprint(label);
    $("fp-label").value = "";
    say("m-fp", `"${label}" added. Next time, tap "Sign in with fingerprint".`);
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
  if (error) { list.innerHTML = `<div class="sx" style="color:var(--danger)">Couldn't load labour charges: ${escapeHtml(error.message)}</div>`; return; }
  tiers = data || [];
  if (!tiers.length) {
    list.innerHTML = `<div class="sx" style="color:var(--text-muted)">No labour charges yet. Add the first one below.</div>`;
    return;
  }
  list.innerHTML = tiers.map(t => `
    <form class="tier-row" data-id="${t.id}" novalidate>
      <div class="field"><label for="tn-${t.id}">Name</label><input id="tn-${t.id}" name="name" type="text" maxlength="60" value="${escapeHtml(t.tier_name)}" /></div>
      <div class="field"><label for="tr-${t.id}">Per hour ($)</label><input id="tr-${t.id}" name="rate" type="number" step="0.01" min="0" value="${Number(t.hourly_rate).toFixed(2)}" /></div>
      <div class="field wide"><label for="tm-${t.id}">Makes</label><input id="tm-${t.id}" name="makes" type="text" value="${escapeHtml((t.makes || []).join(", "))}" placeholder="Picked by hand only" /></div>
      <label class="def"><input type="radio" name="tier-default" ${t.is_default ? "checked" : ""} aria-label="Default labour charge" /> Default</label>
      <div class="acts">
        <button type="submit" class="btn" aria-label="Save ${escapeHtml(t.tier_name)}"><i data-lucide="check"></i> Save</button>
        <button type="button" class="btn btn--danger tier-del" aria-label="Delete ${escapeHtml(t.tier_name)}"><i data-lucide="trash-2"></i></button>
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
      if (!confirm(`Delete "${t?.tier_name}"? Jobs that already used it keep their recorded labour cost; it just won't be offered on new jobs.`)) return;
      const { error } = await supabase.from("vehicle_rate_tiers").delete().eq("id", id);
      say("tier-form-message", error
        ? (/foreign key|violates/i.test(error.message) ? "This charge is used by existing jobs, so it can't be deleted. Rename it or change its rate instead." : "Couldn't delete: " + error.message)
        : "Labour charge deleted.", !error);
      if (!error) loadTiers();
    });
  });
}

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
async function loadRate() {
  const rateInput = $("exchange-rate");
  if (!rateInput) return;
  const { data } = await supabase.from("settings").select("usd_to_zwg_rate, rate_updated_at").maybeSingle();
  if (!data) return;
  rateInput.value = data.usd_to_zwg_rate;
  if (data.rate_updated_at) $("rate-updated").textContent = `Last updated ${new Date(data.rate_updated_at).toLocaleString()}.`;
}
$("save-rate-btn")?.addEventListener("click", async (e) => {
  const rate = parseFloat($("exchange-rate")?.value);
  if (!(rate > 0)) { say("m-rate", "Enter a rate above zero.", false); return; }
  busy(e.currentTarget, true);
  const { error } = await supabase.from("settings").update({ usd_to_zwg_rate: rate, rate_updated_at: new Date().toISOString() }).eq("id", true);
  busy(e.currentTarget, false);
  say("m-rate", error ? "Couldn't save: " + error.message : "Exchange rate saved.", !error);
  if (!error) loadRate();
});

// ---- Account ----
async function loadAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  $("account-email").textContent = user.email;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const labels = { super_admin: "Super Admin", accounting: "Accounting", staff: "Staff" };
  $("account-role").textContent = profile ? (labels[profile.role] || profile.role) : "—";
}
$("reset-password-btn")?.addEventListener("click", async (e) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  busy(e.currentTarget, true, "Sending…");
  const { error } = await supabase.auth.resetPasswordForEmail(user.email);
  busy(e.currentTarget, false);
  say("m-account", error ? "Couldn't send: " + error.message : `Password reset email sent to ${user.email}.`, !error);
});
$("sign-out-btn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("../login.html");
});

document.addEventListener("DOMContentLoaded", () => {
  loadBusinessSettings();
  loadFingerprints();
  refreshInstall();
  loadTiers();
  loadNotifications();
  loadRate();
  loadAccount();
  if (window.lucide) lucide.createIcons();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
});
