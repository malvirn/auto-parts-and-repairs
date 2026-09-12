import supabase from "./supabaseClient.js";

// ---- Tab switching ----
document.querySelectorAll(".settings-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".settings-section").forEach(s => s.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.target).classList.add("active");
  });
});

// ---- Dark mode ----
const darkToggle = document.getElementById("dark-mode-toggle");
darkToggle.checked = (localStorage.getItem("apr-theme") || "dark") === "dark";
darkToggle.addEventListener("change", () => {
  const theme = darkToggle.checked ? "dark" : "light";
  localStorage.setItem("apr-theme", theme);
  document.documentElement.setAttribute("data-theme", theme);
});

// ---- About Us / business settings ----
async function loadBusinessSettings() {
  const { data, error } = await supabase.from("business_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return;
  document.getElementById("biz-name").value = data.business_name || "";
  document.getElementById("biz-tagline").value = data.tagline || "";
  document.getElementById("biz-address").value = data.address || "";
  document.getElementById("biz-phone").value = data.phone || "";
  document.getElementById("biz-email").value = data.email || "";
  document.getElementById("biz-hours").value = data.hours || "";
}

document.getElementById("save-business-btn").addEventListener("click", async () => {
  const { error } = await supabase.from("business_settings").update({
    business_name: document.getElementById("biz-name").value.trim(),
    tagline: document.getElementById("biz-tagline").value.trim(),
    address: document.getElementById("biz-address").value.trim(),
    phone: document.getElementById("biz-phone").value.trim(),
    email: document.getElementById("biz-email").value.trim(),
    hours: document.getElementById("biz-hours").value.trim(),
  }).eq("id", 1);
  if (error) { alert("Failed to save: " + error.message); return; }
  alert("Business info saved.");
});

// ---- Notifications ----
async function loadNotifications() {
  const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20);
  const list = document.getElementById("notifications-list");
  if (error) { list.innerHTML = `<p style="color:#ff6b6b">Failed to load: ${error.message}</p>`; return; }
  if (!data || data.length === 0) { list.innerHTML = `<p style="color:var(--text-dim,#7c9490)">No notifications yet.</p>`; return; }
  list.innerHTML = data.map(n => `
    <div class="toggle-row">
      <span>${escapeHtml(n.message)}</span>
      <span style="font-size:0.7rem; color:var(--text-dim,#7c9490)">${new Date(n.created_at).toLocaleDateString()}</span>
    </div>
  `).join("");
}

// ---- User Guide ----
const GUIDE_TOPICS = [
  { title: "Creating a repair job", body: "Go to Repair Jobs, select the customer, fill in the vehicle details and fault, then click Create Repair Job." },
  { title: "Adding parts to a job", body: "Open a job's edit modal, pick a part from the Shop dropdown, set quantity, and click the + button. Stock updates automatically." },
  { title: "Generating a receipt", body: "Once a job's status is Completed, go to Receipts and click Generate next to that job." },
  { title: "Restocking parts", body: "On the Shop page, click Restock next to a part, choose a supplier, quantity, and unit cost." },
  { title: "Understanding job statuses", body: "Received → Diagnosing → Awaiting Parts → In Repair → Ready for Pickup → Completed → Collected. Unclaimed means a completed job hasn't been picked up." },
];
document.getElementById("guide-accordion").innerHTML = GUIDE_TOPICS.map((t, i) => `
  <div class="accordion-item" data-i="${i}">
    <div class="accordion-header">${t.title} <i data-lucide="chevron-down"></i></div>
    <div class="accordion-body">${t.body}</div>
  </div>
`).join("");
document.querySelectorAll(".accordion-header").forEach(h => {
  h.addEventListener("click", () => h.closest(".accordion-item").classList.toggle("open"));
});

// ---- Currency ----
async function loadRate() {
  const { data } = await supabase.from("settings").select("usd_to_zwg_rate").single();
  if (data) document.getElementById("exchange-rate").value = data.usd_to_zwg_rate;
}
document.getElementById("save-rate-btn").addEventListener("click", async () => {
  const rate = parseFloat(document.getElementById("exchange-rate").value);
  const { error } = await supabase.from("settings").update({ usd_to_zwg_rate: rate }).eq("id", 1);
  if (error) { alert("Failed to save: " + error.message); return; }
  alert("Rate updated.");
});

// ---- Account ----
async function loadAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  document.getElementById("account-email").textContent = user.email;
  const { data: profile } = await supabase.from("profiles").select("role, access_level").eq("id", user.id).maybeSingle();
  document.getElementById("account-role").textContent = profile ? `${profile.role} (level ${profile.access_level})` : "—";
}
document.getElementById("reset-password-btn").addEventListener("click", async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.auth.resetPasswordForEmail(user.email);
  alert(error ? "Failed: " + error.message : "Password reset email sent.");
});

// ---- Danger zone ----
document.getElementById("reset-data-btn").addEventListener("click", async () => {
  if (document.getElementById("reset-confirm-input").value !== "RESET") {
    alert('Type RESET exactly to confirm.');
    return;
  }
  if (!confirm("This is permanent. Are you absolutely sure?")) return;
  for (const table of ["job_parts", "restocks", "repair_jobs", "vehicles", "receipts", "parts", "suppliers", "technicians", "customers"]) {
    await supabase.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }
  alert("All data wiped.");
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  loadBusinessSettings();
  loadNotifications();
  loadRate();
  loadAccount();
  if (window.lucide) lucide.createIcons();
});