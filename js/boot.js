// Sign-in loading screen. login.js drives it with the REAL sign-in work:
//   bootStart() -> bootStep(i, "active" | "done" | "error") -> bootSuccess() | bootError()
// Minimal design: pulsing logo ring, one status line, thin progress bar.

const STEPS = [
  "Verifying credentials",
  "Loading your profile",
  "Syncing your data",
  "Preparing dashboard",
];

const REDIRECT_DELAY_MS = 900;
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let el = null, redirectTimer = 0;
const states = STEPS.map(() => "pending");

function build() {
  const wrap = document.createElement("div");
  wrap.className = "ld";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.innerHTML = `
    <div class="ld-box">
      <div id="ld-main">
        <div class="ld-ring"><img src="assets/logo.png" alt="" onerror="this.onerror=null;this.src=window.__ACLOGO"></div>
        <p class="ld-text" id="ld-text">${STEPS[0]}</p>
        <div class="ld-bar" role="progressbar" aria-label="Sign-in progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="ld-bar"><i id="ld-fill"></i></div>
      </div>
      <div class="ld-result" id="ld-result" hidden></div>
    </div>`;
  document.body.appendChild(wrap);
  return wrap;
}

function setProgress() {
  const done = states.filter((s) => s === "done").length;
  const active = states.includes("active") ? 0.5 : 0;
  const pct = Math.round(((done + active) / STEPS.length) * 100);
  el.querySelector("#ld-fill").style.width = pct + "%";
  el.querySelector("#ld-bar").setAttribute("aria-valuenow", String(pct));
  const i = states.findIndex((s) => s === "active");
  if (i >= 0) el.querySelector("#ld-text").textContent = STEPS[i] + "…";
}

export function bootStart() {
  clearTimeout(redirectTimer);
  if (!el) el = build();
  states.fill("pending");
  el.hidden = false;
  el.querySelector("#ld-main").hidden = false;
  el.querySelector("#ld-result").hidden = true;
  el.querySelector("#ld-text").textContent = STEPS[0] + "…";
  document.body.classList.add("booting");
  setProgress();
}

export function bootStep(index, state) {
  if (!el || index < 0 || index >= STEPS.length) return;
  states[index] = state;
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
    const box = el.querySelector("#ld-result");
    el.querySelector("#ld-main").hidden = true;
    box.innerHTML = `
      <div class="ld-badge bad" aria-hidden="true">${CROSS}</div>
      <h2>Couldn't sign you in</h2>
      <p>${esc(message || "Something went wrong.")}</p>
      <div class="ld-actions">
        ${canRetry ? '<button type="button" class="ld-btn" data-act="retry">Try again</button>' : ""}
        <button type="button" class="ld-btn ghost" data-act="back">Back to sign in</button>
      </div>`;
    box.hidden = false;
    box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      resolve(b.dataset.act);
    }, { once: true }));
    (box.querySelector('[data-act="retry"]') || box.querySelector('[data-act="back"]')).focus();
  });
}

// Everything worked: quick checkmark, then straight to the dashboard.
export function bootSuccess(profile, email, { destination = "index.html", warning = "" } = {}) {
  if (!el) return;
  const who = profile?.full_name || email || "";
  const box = el.querySelector("#ld-result");
  el.querySelector("#ld-main").hidden = true;
  box.innerHTML = `
    <div class="ld-badge ok" aria-hidden="true">${CHECK}</div>
    <h2>Welcome${who ? `, ${esc(who.split(" ")[0])}` : ""}</h2>
    ${warning ? `<p class="ld-note">${esc(warning)}</p><div class="ld-actions"><button type="button" class="ld-btn" id="ld-go">Open dashboard</button></div>` : ""}`;
  box.hidden = false;
  const go = () => { clearTimeout(redirectTimer); window.location.replace(destination); };
  if (warning) {
    // Give the person time to read the warning; they continue manually.
    box.querySelector("#ld-go").addEventListener("click", go);
    box.querySelector("#ld-go").focus();
  } else {
    redirectTimer = setTimeout(go, REDIRECT_DELAY_MS);
  }
}
