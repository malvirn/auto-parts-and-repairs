// Sign-in loading screen: a 5-second progress bar through the sign-in
// steps with workshop animations (gears, spanner, engine), the system name
// and developer credit. Then either a green tick with the person's access
// level before the app opens, or — for wrong details — "Access denied"
// after 4 seconds.

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

const DURATION_MS = 5000;      // the progress bar runs for 5 seconds
const DENY_AT_MS = 4000;       // wrong details are refused at 4 seconds
const DENY_SHOW_MS = 3500;     // the red "Access denied" stays this long
const ACCESS_SHOW_MS = 3000;   // the green tick + access level stays this long
const HOLD_AT = 92;            // the bar waits here if the real sign-in is still busy

// Step text shown as the bar moves (from this % onwards).
const STEPS = [
  [0, "Checking your details…"],
  [12, "Verifying your session…"],
  [25, "Loading your access level…"],
  [38, "Starting the engines…"],
  [52, "Tightening the bolts…"],
  [66, "Opening the workshop…"],
  [80, "Preparing your workspace…"],
  [92, "Almost ready…"],
  [100, "Ready"],
];

// Workshop animation: two meshing gears, a spanner turning a bolt, and an
// engine with pumping pistons. Drawn inline so it works offline.
const MECH_SVG = `
  <div class="mech" aria-hidden="true">
    <svg class="mech-gears" viewBox="0 0 76 52">
      <g class="gear gear-a" style="transform-origin:24px 28px">
        <circle cx="24" cy="28" r="15" fill="none" stroke="currentColor" stroke-width="7" stroke-dasharray="5 4.425"/>
        <circle cx="24" cy="28" r="12" fill="currentColor"/><circle cx="24" cy="28" r="4.5" class="hole"/>
      </g>
      <g class="gear gear-b" style="transform-origin:55px 18px">
        <circle cx="55" cy="18" r="10" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="4 3.854"/>
        <circle cx="55" cy="18" r="8" fill="currentColor"/><circle cx="55" cy="18" r="3" class="hole"/>
      </g>
    </svg>
    <svg class="mech-spanner" viewBox="0 0 52 52">
      <polygon class="bolt" points="26,34 31.2,37 31.2,43 26,46 20.8,43 20.8,37"/>
      <g class="spanner" style="transform-origin:26px 40px">
        <circle cx="26" cy="40" r="9.5" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="44 15.7" transform="rotate(137.5 26 40)"/>
        <path d="M26 30 L26 5" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
      </g>
    </svg>
    <svg class="mech-engine" viewBox="0 0 64 52">
      <rect x="10" y="4" width="14" height="22" rx="2" class="cyl"/>
      <rect x="30" y="4" width="14" height="22" rx="2" class="cyl"/>
      <rect x="12.5" y="8" width="9" height="7" rx="1.5" class="piston piston-a"/>
      <rect x="32.5" y="8" width="9" height="7" rx="1.5" class="piston piston-b"/>
      <rect x="6" y="24" width="42" height="20" rx="4" fill="currentColor"/>
      <rect x="48" y="30" width="8" height="6" rx="1.5" fill="currentColor"/>
      <circle class="puff puff-a" cx="58" cy="26" r="3"/><circle class="puff puff-b" cx="58" cy="26" r="3"/>
      <circle cx="27" cy="34" r="5" class="hole"/>
    </svg>
  </div>`;

// Tools drifting in the background of the loading screen.
const FLOATING = ["wrench", "cog", "car", "gauge", "fuel", "hammer", "settings", "battery", "wrench", "cog"];

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
  const floating = FLOATING.map((icon, i) =>
    `<i data-lucide="${icon}" class="boot-float" style="--x:${(i * 37 + 7) % 92}%;--d:${(i * 1.7) % 9}s;--t:${11 + (i % 4) * 2}s;--s:${22 + (i % 3) * 10}px"></i>`).join("");
  wrap.innerHTML = `
    <div class="boot-floats" aria-hidden="true">${floating}</div>
    <div class="boot-card">
      <div class="boot-logo"><img src="assets/AC_logo_transparent.png" alt="Centric Auto Mobile"></div>
      <div class="sys-anim boot-sys" aria-label="${esc(SYSTEM.name)}">
        <div class="sys-name" aria-hidden="true">${splitLetters(SYSTEM.name)}</div>
        <small class="sys-tag">${esc(SYSTEM.tagline)}</small>
      </div>
      <div class="boot-stage" id="boot-stage">
        ${MECH_SVG}
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
  el.classList.remove("denied");
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
  el.classList.remove("denied");
  document.body.classList.remove("booting");
}

// Sign-in refused (wrong email/password, deactivated account, …): keep
// the loading screen running until 4 seconds, then show "Access denied"
// with the reason, and finally return to the sign-in form.
export async function bootDeny(reason) {
  if (!el || el.hidden) return;
  const left = DENY_AT_MS - (performance.now() - startedAt);
  if (left > 0) await wait(left);
  cancelAnimationFrame(raf); raf = 0;
  el.classList.add("denied");
  document.getElementById("boot-step").textContent = "Access denied";
  const box = document.getElementById("boot-access");
  box.innerHTML = `
    <div class="boot-cross" aria-hidden="true">
      <svg viewBox="0 0 52 52"><circle class="boot-cross-c" cx="26" cy="26" r="24"/><path class="boot-cross-p" d="M18 18 L34 34"/><path class="boot-cross-p p2" d="M34 18 L18 34"/></svg>
    </div>
    <p class="boot-denied">Access denied</p>
    <p class="boot-reason">${esc(reason || "Sign in failed.")}</p>
    <p class="boot-open"><i data-lucide="arrow-left"></i> Returning to sign in…</p>`;
  document.getElementById("boot-stage").hidden = true;
  box.hidden = false;
  if (window.lucide) window.lucide.createIcons();
  await wait(DENY_SHOW_MS);
  bootCancel();
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
    <p class="boot-open"><i data-lucide="loader-circle" class="boot-spin"></i> Opening…</p>`;
  document.getElementById("boot-stage").hidden = true;
  box.hidden = false;
  if (window.lucide) window.lucide.createIcons();
  await wait(ACCESS_SHOW_MS);
  window.location.href = destination;
}
