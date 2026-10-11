// Sign-in loading screen: a 10-second progress bar through the sign-in
// steps, the system name and developer credit animating while it loads,
// then a green tick with the person's access level before the app opens.

const SYSTEM = { name: "Auto Parts & Repairs", tagline: "Workshop Management System" };

const DEVELOPER = {
  name: "Malvirn Gomo",
  email: "malvirngomo8@gmail.com",
  phone: "+263 71 147 8580",
  phoneHref: "+263711478580",
};

// Mirrors the page rules in auth.js (PAGE_ACCESS).
const ROLE_INFO = {
  super_admin: {
    label: "Super Admin",
    summary: "Full access to every module",
    areas: ["Job Cards", "Customers", "Mechanics", "Shop", "Quotations", "Receipts", "Suppliers", "Accounting", "Analytics", "Settings"],
  },
  accounting: {
    label: "Accounting",
    summary: "Finance, reports and sales records",
    areas: ["Accounting", "Ledger", "Payables", "Cash Book", "Statements", "Analytics", "Shop", "Quotations", "Receipts", "Settings"],
  },
  staff: {
    label: "Staff",
    summary: "Workshop and sales",
    areas: ["Job Cards", "Customers", "Suppliers", "Shop", "Quotations", "Receipts", "Settings"],
  },
};

const DURATION_MS = 10000;     // the progress bar runs for 10 seconds
const ACCESS_SHOW_MS = 3000;   // the green tick + access level stays this long
const HOLD_AT = 92;            // the bar waits here if the real sign-in is still busy

// Step text shown as the bar moves (from this % onwards).
const STEPS = [
  [0, "Checking your details…"],
  [20, "Verifying your session…"],
  [42, "Loading your access level…"],
  [64, "Preparing your workspace…"],
  [86, "Almost ready…"],
  [100, "Ready"],
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Wrap each character in a span so it can animate in on its own.
export function splitLetters(text, startIndex = 0) {
  return [...text].map((ch, i) =>
    `<span style="--i:${i + startIndex}">${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");
}

let el = null, startedAt = 0, raf = 0, ready = false, shown = 0;

function build() {
  const wrap = document.createElement("div");
  wrap.id = "boot";
  wrap.className = "boot";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.innerHTML = `
    <div class="boot-card">
      <div class="boot-logo"><img src="assets/logo.png" alt="" onerror="this.style.display='none'"></div>
      <div class="sys-anim boot-sys" aria-label="${esc(SYSTEM.name)}">
        <div class="sys-name" aria-hidden="true">${splitLetters(SYSTEM.name)}</div>
        <small class="sys-tag">${esc(SYSTEM.tagline)}</small>
      </div>
      <div class="boot-stage" id="boot-stage">
        <p class="boot-step" id="boot-step">${STEPS[0][1]}</p>
        <div class="boot-bar" role="progressbar" aria-label="Signing in" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="boot-bar">
          <div class="boot-fill" id="boot-fill"></div>
        </div>
        <p class="boot-pct" id="boot-pct">0%</p>
        <div class="boot-dev" aria-label="Developed by ${esc(DEVELOPER.name)}">
          <small class="boot-dev-k">Developed by</small>
          <div class="boot-dev-name" aria-hidden="true">${splitLetters(DEVELOPER.name)}</div>
          <a class="boot-dev-line" style="--d:0" href="mailto:${esc(DEVELOPER.email)}"><i data-lucide="mail"></i>${esc(DEVELOPER.email)}</a>
          <a class="boot-dev-line" style="--d:1" href="tel:${esc(DEVELOPER.phoneHref)}"><i data-lucide="phone"></i>${esc(DEVELOPER.phone)}</a>
        </div>
      </div>
      <div class="boot-access" id="boot-access" hidden></div>
    </div>`;
  document.body.appendChild(wrap);
  if (window.lucide) window.lucide.createIcons();
  return wrap;
}

function render(value) {
  const v = Math.floor(value);
  document.getElementById("boot-fill").style.width = value + "%";
  document.getElementById("boot-pct").textContent = v + "%";
  document.getElementById("boot-bar").setAttribute("aria-valuenow", String(v));
  const step = STEPS.filter(([at]) => v >= at).pop()[1];
  const stepEl = document.getElementById("boot-step");
  if (stepEl.textContent !== step) stepEl.textContent = step;
}

function tick() {
  const byTime = Math.min(100, ((performance.now() - startedAt) / DURATION_MS) * 100);
  shown = Math.min(byTime, ready ? 100 : HOLD_AT);
  render(shown);
  raf = shown < 100 ? requestAnimationFrame(tick) : 0;
}

export function bootStart() {
  if (!el) el = build();
  cancelAnimationFrame(raf);
  el.hidden = false;
  document.body.classList.add("booting");
  document.getElementById("boot-stage").hidden = false;
  document.getElementById("boot-access").hidden = true;
  startedAt = performance.now();
  ready = false; shown = 0;
  render(0);
  raf = requestAnimationFrame(tick);
}

// Sign-in failed: take the screen away so the form and its message show.
export function bootCancel() {
  if (!el) return;
  cancelAnimationFrame(raf); raf = 0;
  el.hidden = true;
  document.body.classList.remove("booting");
}

// The account is confirmed: let the bar finish its 10 seconds, show the
// green tick with the access level, then open the app.
export async function bootFinish(profile, email, destination = "index.html") {
  ready = true;
  if (!raf && shown < 100) raf = requestAnimationFrame(tick);
  while (shown < 100) await wait(50);
  await wait(400);

  const info = ROLE_INFO[profile?.role] || ROLE_INFO.staff;
  const who = profile?.full_name || email || "";
  const box = document.getElementById("boot-access");
  box.innerHTML = `
    <div class="boot-tick" aria-hidden="true">
      <svg viewBox="0 0 52 52"><circle class="boot-tick-c" cx="26" cy="26" r="24"/><path class="boot-tick-p" d="M15 27 l7.5 7.5 L37.5 19"/></svg>
    </div>
    <p class="boot-granted">Access granted</p>
    <p class="boot-hi">Welcome${who ? `, <b>${esc(who)}</b>` : ""}</p>
    <div class="boot-level"><span>Access level</span><strong><i data-lucide="circle-check"></i>${esc(info.label)}</strong></div>
    <p class="boot-sum">${esc(info.summary)}</p>
    <ul class="boot-areas">${info.areas.map((a, i) => `<li style="--i:${i}">${esc(a)}</li>`).join("")}</ul>
    <p class="boot-open"><i data-lucide="loader-circle"></i> Opening…</p>`;
  document.getElementById("boot-stage").hidden = true;
  box.hidden = false;
  if (window.lucide) window.lucide.createIcons();
  await wait(ACCESS_SHOW_MS);
  window.location.href = destination;
}
