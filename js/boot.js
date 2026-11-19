// Sign-in sync screen. login.js drives it with the REAL sign-in work:
//   bootStart() -> bootStep(i, "active" | "done" | "error") -> bootSuccess() | bootError()
// Steps: verifying credentials, loading profile, syncing user data, preparing dashboard.

const STEPS = [
  { title: "Verifying credentials", detail: "Checking your email and password" },
  { title: "Loading profile", detail: "Fetching your account and access level" },
  { title: "Syncing user data", detail: "Pulling jobs, customers and stock" },
  { title: "Preparing dashboard", detail: "Setting up your workspace" },
];

// Mirrors the page rules in auth.js (PAGE_ACCESS).
const ROLE_INFO = {
  super_admin: {
    label: "Super Admin", summary: "Full access to every module",
    areas: ["Job Cards", "Customers", "Mechanics", "Shop", "Quotations", "Receipts", "Suppliers", "Accounting", "Analytics", "Settings"],
  },
  accounting: {
    label: "Accounting", summary: "Finance, reports and sales records",
    areas: ["Accounting", "Ledger", "Payables", "Cash Book", "Statements", "Analytics", "Shop", "Quotations", "Receipts", "Settings"],
  },
  staff: {
    label: "Staff", summary: "Workshop and sales",
    areas: ["Job Cards", "Customers", "Suppliers", "Shop", "Quotations", "Receipts", "Settings"],
  },
};

const REDIRECT_DELAY_MS = 3000;
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let el = null, redirectTimer = 0;

function build() {
  const wrap = document.createElement("div");
  wrap.className = "sync";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.innerHTML = `
    <div class="sync-card">
      <img class="sync-logo" src="assets/logo.png" alt="" onerror="this.onerror=null;this.src=window.__ACLOGO">
      <div id="sync-progress">
        <h2 class="sync-title" id="sync-title">Signing you in</h2>
        <p class="sync-sub" id="sync-sub">This only takes a moment</p>
        <div class="sync-bar" role="progressbar" aria-label="Sign-in progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="sync-bar"><div class="sync-fill" id="sync-fill"></div></div>
        <ol class="sync-steps">
          ${STEPS.map((s, i) => `<li class="sync-step" data-step="${i}" data-state="pending"><span class="sync-ico">${CHECK}</span><span>${s.title}<small>${s.detail}</small></span></li>`).join("")}
        </ol>
      </div>
      <div class="sync-result" id="sync-result" hidden></div>
    </div>`;
  document.body.appendChild(wrap);
  return wrap;
}

function setProgress() {
  const states = [...el.querySelectorAll(".sync-step")].map((n) => n.dataset.state);
  const done = states.filter((s) => s === "done").length;
  const active = states.includes("active") ? 0.5 : 0;
  const pct = Math.round(((done + active) / STEPS.length) * 100);
  el.querySelector("#sync-fill").style.width = pct + "%";
  el.querySelector("#sync-bar").setAttribute("aria-valuenow", String(pct));
}

export function bootStart() {
  clearTimeout(redirectTimer);
  if (!el) el = build();
  el.hidden = false;
  el.querySelectorAll(".sync-step").forEach((n) => { n.dataset.state = "pending"; n.querySelector(".sync-ico").innerHTML = CHECK; });
  el.querySelector("#sync-progress").hidden = false;
  el.querySelector("#sync-result").hidden = true;
  el.querySelector("#sync-title").textContent = "Signing you in";
  el.querySelector("#sync-sub").textContent = "This only takes a moment";
  document.body.classList.add("booting");
  setProgress();
}

export function bootStep(index, state, detail) {
  if (!el) return;
  const row = el.querySelector(`.sync-step[data-step="${index}"]`);
  if (!row) return;
  row.dataset.state = state;
  row.querySelector(".sync-ico").innerHTML = state === "error" ? CROSS : CHECK;
  if (detail) row.querySelector("small").textContent = detail;
  setProgress();
}

// Take the screen away so the sign-in form shows again.
export function bootCancel() {
  clearTimeout(redirectTimer);
  if (!el) return;
  el.hidden = true;
  document.body.classList.remove("booting");
}

// Something failed. Shows the reason and resolves "retry" or "back".
export function bootError(message, { canRetry = true } = {}) {
  return new Promise((resolve) => {
    if (!el) return resolve("back");
    const box = el.querySelector("#sync-result");
    el.querySelector("#sync-progress").hidden = true;
    box.innerHTML = `
      <div class="sync-badge bad" aria-hidden="true">${CROSS}</div>
      <h2>Couldn't sign you in</h2>
      <p>${esc(message || "Something went wrong.")}</p>
      <div class="sync-actions">
        ${canRetry ? '<button type="button" class="sync-btn" data-act="retry">Try again</button>' : ""}
        <button type="button" class="sync-btn ghost" data-act="back">Back to sign in</button>
      </div>`;
    box.hidden = false;
    box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      resolve(b.dataset.act);
    }, { once: true }));
    (box.querySelector('[data-act="retry"]') || box.querySelector('[data-act="back"]')).focus();
  });
}

// Everything worked: show success + the access level, then open the dashboard.
export function bootSuccess(profile, email, { destination = "index.html", warning = "" } = {}) {
  if (!el) return;
  const info = ROLE_INFO[profile?.role] || ROLE_INFO.staff;
  const who = profile?.full_name || email || "";
  const box = el.querySelector("#sync-result");
  el.querySelector("#sync-progress").hidden = true;
  box.innerHTML = `
    <div class="sync-badge ok" aria-hidden="true">${CHECK}</div>
    <h2>You're in${who ? `, ${esc(who.split(" ")[0])}` : ""}</h2>
    <p>Signed in successfully</p>
    <div class="sync-level"><span>Your access level</span><strong>${esc(info.label)}</strong></div>
    <p>${esc(info.summary)}</p>
    <ul class="sync-areas">${info.areas.map((a, i) => `<li style="--i:${i}">${esc(a)}</li>`).join("")}</ul>
    ${warning ? `<p class="sync-note">${esc(warning)}</p>` : ""}
    <div class="sync-actions"><button type="button" class="sync-btn" id="sync-continue">Open dashboard</button></div>
    <p class="sync-go"><i aria-hidden="true"></i>Opening your dashboard…</p>`;
  box.hidden = false;
  const go = () => { clearTimeout(redirectTimer); window.location.replace(destination); };
  box.querySelector("#sync-continue").addEventListener("click", go);
  box.querySelector("#sync-continue").focus();
  redirectTimer = setTimeout(go, REDIRECT_DELAY_MS);
}
