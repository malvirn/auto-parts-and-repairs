// Sign-in loading screen: a progress bar that follows the real sign-in
// steps, an animated developer credit while it loads, and the person's
// access level once their account is confirmed.

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

const MIN_SHOW_MS = 3000; // long enough for the developer credit to play
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let el = null, startedAt = 0, shown = 0, target = 0, raf = 0;

function build() {
  const letters = [...DEVELOPER.name].map((ch, i) =>
    `<span style="--i:${i}">${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");
  const wrap = document.createElement("div");
  wrap.id = "boot";
  wrap.className = "boot";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.innerHTML = `
    <div class="boot-card">
      <div class="boot-logo"><img src="assets/logo.png" alt="Auto Parts &amp; Repairs" onerror="this.style.display='none'"></div>
      <div class="boot-stage" id="boot-stage">
        <p class="boot-step" id="boot-step">Signing you in…</p>
        <div class="boot-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="boot-bar">
          <div class="boot-fill" id="boot-fill"></div>
        </div>
        <p class="boot-pct" id="boot-pct">0%</p>
        <div class="boot-dev" aria-label="Developed by ${esc(DEVELOPER.name)}">
          <small class="boot-dev-k">Developed by</small>
          <div class="boot-dev-name" aria-hidden="true">${letters}</div>
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

function tick() {
  // ease the visible bar toward the current target
  shown += Math.max(0.4, (target - shown) * 0.08);
  if (shown > target) shown = target;
  const v = Math.round(shown);
  const fill = document.getElementById("boot-fill");
  if (fill) fill.style.width = v + "%";
  const pct = document.getElementById("boot-pct");
  if (pct) pct.textContent = v + "%";
  document.getElementById("boot-bar")?.setAttribute("aria-valuenow", String(v));
  if (shown < target) raf = requestAnimationFrame(tick); else raf = 0;
}

export function bootStart(step = "Signing you in…") {
  if (!el) el = build();
  el.classList.remove("out");
  el.hidden = false;
  document.body.classList.add("booting");
  startedAt = performance.now();
  shown = 0; target = 0;
  document.getElementById("boot-stage").hidden = false;
  document.getElementById("boot-access").hidden = true;
  bootProgress(8, step);
}

export function bootProgress(value, step) {
  if (!el) return;
  target = Math.max(target, Math.min(100, value));
  if (step) document.getElementById("boot-step").textContent = step;
  if (!raf) raf = requestAnimationFrame(tick);
}

// Sign-in failed: take the screen away so the form and its message show.
export function bootCancel() {
  if (!el) return;
  cancelAnimationFrame(raf); raf = 0;
  el.hidden = true;
  document.body.classList.remove("booting");
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle() {
  while (Math.round(shown) < 100) await wait(40);
}

// All steps done: fill the bar, show the access level, then open the app.
export async function bootFinish(profile, email, destination = "index.html") {
  bootProgress(92, "Preparing your workspace…");
  const left = MIN_SHOW_MS - (performance.now() - startedAt);
  if (left > 0) await wait(left);
  bootProgress(100, "Ready");
  await settle();
  await wait(250);

  const info = ROLE_INFO[profile?.role] || ROLE_INFO.staff;
  const who = profile?.full_name || email || "";
  const box = document.getElementById("boot-access");
  box.innerHTML = `
    <div class="boot-ok"><i data-lucide="shield-check"></i></div>
    <p class="boot-hi">Welcome${who ? `, <b>${esc(who)}</b>` : ""}</p>
    <div class="boot-level"><span>Access level</span><strong>${esc(info.label)}</strong></div>
    <p class="boot-sum">${esc(info.summary)}</p>
    <ul class="boot-areas">${info.areas.map((a, i) => `<li style="--i:${i}">${esc(a)}</li>`).join("")}</ul>
    <p class="boot-open"><i data-lucide="loader-circle"></i> Opening…</p>`;
  document.getElementById("boot-stage").hidden = true;
  box.hidden = false;
  if (window.lucide) window.lucide.createIcons();
  await wait(1900);
  window.location.href = destination;
}
