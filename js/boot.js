// Sign-in progress. login.js drives it with the REAL sign-in work:
//   bootStart() -> bootStep(i, "active" | "done" | "error") -> bootSuccess() | bootError()
// No overlay: a thin bar runs along the top, the Sign in button shows the state,
// and on success the card fades out straight into the dashboard.

const STEPS = 4; // verify, profile, sync, prepare
const states = new Array(STEPS).fill("pending");
const CHECK = '<svg class="btn-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

let redirectTimer = 0, leaveTimer = 0, retryBox = null;

const $ = (id) => document.getElementById(id);
const body = () => document.body;

function setProgress(pct) {
  const fill = $("ld-fill");
  if (fill) fill.style.width = pct + "%";
}

function recompute() {
  const done = states.filter((s) => s === "done").length;
  const active = states.includes("active") ? 0.5 : 0;
  setProgress(Math.max(8, Math.round(((done + active) / STEPS) * 100)));
}

function clearRetry() {
  retryBox?.remove();
  retryBox = null;
  body().classList.remove("errored");
}

export function bootStart() {
  clearTimeout(redirectTimer);
  clearTimeout(leaveTimer);
  clearRetry();
  states.fill("pending");
  body().classList.remove("leaving");
  body().classList.add("booting");
  setProgress(8);
}

export function bootStep(index, state) {
  if (index < 0 || index >= STEPS) return;
  states[index] = state;
  recompute();
}

// Hand the sign-in form back.
export function bootCancel() {
  clearTimeout(redirectTimer);
  clearTimeout(leaveTimer);
  clearRetry();
  body().classList.remove("booting", "leaving");
  setProgress(0);
}

// Something failed. Resolves "retry" or "back".
export function bootError(message, { canRetry = true } = {}) {
  return new Promise((resolve) => {
    setProgress(0);
    if (!canRetry) return resolve("back"); // login.js shows the reason on the form
    const msg = $("login-message");
    if (msg) { msg.textContent = message || "Something went wrong."; msg.dataset.tone = "error"; }
    body().classList.remove("booting");
    body().classList.add("errored");
    clearRetry();
    body().classList.add("errored");
    retryBox = document.createElement("div");
    retryBox.className = "ld-retry";
    retryBox.innerHTML = '<button type="button" data-act="back">Edit details</button><button type="button" class="primary" data-act="retry">Try again</button>';
    msg?.after(retryBox);
    retryBox.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
      if (msg) { msg.textContent = ""; msg.dataset.tone = ""; }
      clearRetry();
      resolve(b.dataset.act);
    }, { once: true }));
    retryBox.querySelector('[data-act="retry"]').focus();
  });
}

// Everything worked: bar completes, button turns into a check, card fades out, dashboard opens.
export function bootSuccess(profile, email, { destination = "index.html", warning = "" } = {}) {
  setProgress(100);
  const btn = $("login-submit");
  if (btn) { btn.disabled = true; btn.removeAttribute("aria-busy"); btn.innerHTML = CHECK + "<span>Signed in</span>"; }
  const go = () => window.location.replace(destination);
  if (warning) {
    // Leave time to read it; the dashboard still opens on its own.
    const msg = $("login-message");
    if (msg) { msg.textContent = warning; msg.dataset.tone = "warn"; }
    redirectTimer = setTimeout(go, 3000);
    return;
  }
  leaveTimer = setTimeout(() => body().classList.add("leaving"), 450);
  redirectTimer = setTimeout(go, 700);
}
