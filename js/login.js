import supabase from "./supabaseClient.js";
import { loadUserProfile } from "./profile.js";
import { fingerprintSupported, deviceHasFingerprint, signInWithFingerprint } from "./passkey.js";
import { bootStart, bootStep, bootCancel, bootError, bootSuccess } from "./boot.js";
import { syncUserData } from "./prefetch.js";

const form = document.getElementById("login-form");
const messageEl = document.getElementById("login-message");
const submitBtn = document.getElementById("login-submit");
const forgotPasswordBtn = document.getElementById("forgot-password");
const openedFromFile = window.location.protocol === "file:";
const ADMIN_LOGIN_EMAIL = "malvirngomo8@gmail.com";

const LOGIN_GUARD_KEY = "centric-login-guard-v1";
const LOGIN_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000;
const LOGIN_GUARD_LIMITS = [
  { attempts: 5, delay: 60 * 1000 },
  { attempts: 10, delay: 5 * 60 * 1000 },
  { attempts: 15, delay: 15 * 60 * 1000 },
];
let loginGuardTimer = null;

function loginGuardIdentity() {
  const identity = resolveLoginEmail(document.getElementById("login-email")?.value || "").trim().toLowerCase();
  return identity || "empty";
}

function readLoginGuard() {
  try {
    const all = JSON.parse(localStorage.getItem(LOGIN_GUARD_KEY) || "{}");
    const record = all[loginGuardIdentity()];
    if (!record || Date.now() - Number(record.firstFailedAt || 0) > LOGIN_GUARD_WINDOW_MS) return { all, record: null };
    return { all, record };
  } catch (_) { return { all: {}, record: null }; }
}

function getLoginLock() {
  const { record } = readLoginGuard();
  const until = Number(record?.lockedUntil || 0);
  return until > Date.now() ? until : 0;
}

function updateLoginGuardAfterFailure() {
  const { all, record } = readLoginGuard();
  const now = Date.now();
  const count = Number(record?.count || 0) + 1;
  const threshold = [...LOGIN_GUARD_LIMITS].reverse().find(item => count >= item.attempts);
  all[loginGuardIdentity()] = {
    count,
    firstFailedAt: record?.firstFailedAt || now,
    lockedUntil: threshold ? now + threshold.delay : 0,
  };
  try { localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(all)); } catch (_) {}
  return all[loginGuardIdentity()];
}

function clearLoginGuard() {
  const { all } = readLoginGuard();
  delete all[loginGuardIdentity()];
  try { localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(all)); } catch (_) {}
}

function updateLoginGuardAfterRateLimit() {
  const { all, record } = readLoginGuard();
  const now = Date.now();
  const lockedUntil = now + 60 * 1000;
  all[loginGuardIdentity()] = {
    count: Number(record?.count || 0),
    firstFailedAt: record?.firstFailedAt || now,
    lockedUntil,
    rateLimited: true,
  };
  try { localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(all)); } catch (_) {}
  return lockedUntil;
}

function showLoginLock(until) {
  if (loginGuardTimer) clearInterval(loginGuardTimer);
  const update = () => {
    const remaining = Math.max(0, until - Date.now());
    if (!remaining) {
      clearInterval(loginGuardTimer);
      loginGuardTimer = null;
      resetButton();
      showMessage("You can try signing in again.", "info");
      return;
    }
    submitBtn.disabled = true;
    const seconds = Math.ceil(remaining / 1000);
    const { record } = readLoginGuard();
    const lockMessage = record?.rateLimited ? "Too many sign-in requests" : "Too many unsuccessful attempts";
    showMessage(`${lockMessage}. Try again in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.`, "error");
  };
  update();
  loginGuardTimer = setInterval(update, 1000);
}

function isInvalidCredentials(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "invalid_credentials" || /invalid login credentials|invalid email or password|email or password is incorrect/.test(message);
}

function resolveLoginEmail(value) {
  const input = String(value || "").trim();
  return input.toLowerCase() === "admin" ? ADMIN_LOGIN_EMAIL : input;
}

if (openedFromFile) {
  showMessage("This app cannot connect to Supabase reliably when opened as a file. Start a local web server or open the hosted HTTPS site.", "error");
  submitBtn.disabled = true;
  if (forgotPasswordBtn) forgotPasswordBtn.disabled = true;
}

function setLoading() {
  submitBtn.disabled = true;
  submitBtn.setAttribute("aria-busy", "true");
  submitBtn.innerHTML = '<i data-lucide="loader-circle" class="spin"></i> Signing in…';
  if (window.lucide) lucide.createIcons();
}

function resetButton() {
  submitBtn.disabled = false;
  submitBtn.removeAttribute("aria-busy");
  submitBtn.innerHTML = '<i data-lucide="log-in"></i> Sign In';
  if (window.lucide) lucide.createIcons();
}

function showMessage(text, tone) {
  messageEl.textContent = text;
  messageEl.dataset.tone = tone;
}

forgotPasswordBtn?.addEventListener("click", async () => {
  const emailInput = document.getElementById("login-email");
  const enteredLogin = emailInput.value.trim();
  const email = resolveLoginEmail(enteredLogin);
  if (!email) {
    emailInput.focus();
    showMessage("Enter your email address first, then choose the password reset link.", "error");
    return;
  }
  if (enteredLogin.toLowerCase() !== "admin" && !emailInput.checkValidity()) {
    emailInput.reportValidity();
    return;
  }

  forgotPasswordBtn.disabled = true;
  showMessage("Sending password reset instructions…", "info");
  try {
    const redirectTo = new URL("pages/reset-password.html", window.location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    showMessage("If an account exists for this address, password reset instructions have been sent.", "info");
  } catch (error) {
    console.error("Couldn't send password reset email:", error);
    showMessage(`Couldn't send the reset email: ${error.message || String(error)}`, "error");
  } finally {
    forgotPasswordBtn.disabled = false;
  }
});

const MIN_STEP_MS = 450; // so each step is readable even when the server answers instantly
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isNetworkError = (e) => /fetch|network|timed out|timeout|retryable/i.test(`${e?.name || ""} ${e?.message || ""}`);
let busy = false;

// Runs one step: marks it active, does the real work, keeps it on screen for
// at least MIN_STEP_MS, marks it done. If the work throws, marks it failed.
async function runStep(index, work) {
  bootStep(index, "active");
  const started = performance.now();
  try {
    const result = await work();
    const left = MIN_STEP_MS - (performance.now() - started);
    if (left > 0) await wait(left);
    bootStep(index, "done");
    return result;
  } catch (error) {
    bootStep(index, "error");
    throw error;
  }
}

// The real sign-in pipeline. `state` keeps what earlier steps produced, so
// "Try again" resumes at the step that failed instead of starting over.
//   0 verify credentials -> 1 load profile -> 2 sync user data -> 3 prepare dashboard
async function runPipeline(state) {
  if (state.step <= 0) {
    await runStep(0, async () => {
      if (state.email && state.password) {
        const { data, error } = await supabase.auth.signInWithPassword({ email: state.email, password: state.password });
        if (error) throw Object.assign(new Error(error.message || "Sign in failed. Check your email and password."), { network: isNetworkError(error) });
        if (!data.session) throw new Error("Sign in didn't return a session. Please try again.");
      }
      // Confirm with the server that the session is genuine (not just stored locally).
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) throw Object.assign(new Error("Session didn't save properly — please try again."), { network: isNetworkError(error) });
      clearLoginGuard();
      state.user = user;
      state.password = null; // never keep the password around after it's been used
    });
    state.step = 1;
  }
  if (state.step <= 1) {
    await runStep(1, async () => {
      const profile = await loadUserProfile(state.user.id);
      if (profile.is_active === false) {
        await supabase.auth.signOut();
        throw Object.assign(new Error("This account has been deactivated. Contact your Super Admin."), { fatal: true });
      }
      state.profile = profile;
    });
    state.step = 2;
  }
  if (state.step <= 2) {
    await runStep(2, async () => {
      try {
        state.sync = await syncUserData();
      } catch (error) {
        throw Object.assign(error, { network: true });
      }
    });
    state.step = 3;
  }
  if (state.step <= 3) {
    await runStep(3, async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session ended before the dashboard could open. Please sign in again.");
    });
    state.step = 4;
  }
}

// Drives the screen: runs the pipeline, offers "Try again" on recoverable
// failures, and on success shows the access level then opens the dashboard.
// Resolves true if the dashboard is opening, false if the person is back on the form.
async function signIn(state, { quietIfNoSession = false } = {}) {
  bootStart();
  for (;;) {
    try {
      await runPipeline(state);
      const warnings = [];
      if (state.profile?.lookup_failed) warnings.push("We couldn't load your role, so you're signed in with Staff access.");
      if (state.sync?.failed?.length) warnings.push(`Some data couldn't sync (${state.sync.failed.join(", ")}). Pages will load it when you open them.`);
      bootSuccess(state.profile || { role: "staff" }, state.user?.email || state.email, { warning: warnings.join(" ") });
      return true;
    } catch (error) {
      console.error(`Sign-in failed at step ${state.step}:`, error);
      let reason = error?.message || "Something went wrong. Please try again.";
      if (state.step === 0 && state.email && state.password && isInvalidCredentials(error)) {
        const guard = updateLoginGuardAfterFailure();
        reason = "Sign-in failed. Check your username and password.";
        if (guard.lockedUntil > Date.now()) reason = "Too many unsuccessful attempts. Please wait before trying again.";
      } else if (state.step === 0 && Number(error?.status) === 429) {
        updateLoginGuardAfterRateLimit();
        reason = "Too many sign-in requests. Sign in is temporarily locked for 60 seconds.";
      }
      if (quietIfNoSession && state.step === 0) { bootCancel(); return false; } // stale bookmark session: just show the form
      const canRetry = !error?.fatal && !!error?.network;
      const choice = await bootError(reason, { canRetry });
      if (choice === "retry") { bootStart(); for (let i = 0; i < state.step; i++) bootStep(i, "done"); continue; }
      if (state.step >= 1 && !error?.fatal) await supabase.auth.signOut().catch(() => {});
      bootCancel();
      showMessage(reason, "error");
      resetButton();
      return false;
    }
  }
}

// If someone's already got a valid, server-verified session and lands
// back on the login page (e.g. a bookmark), send them straight through.
(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("password") === "updated") {
    showMessage("Your password has been updated. Sign in with your new password.", "info");
  }
  if (params.get("terminated") === "1") {
    showMessage("This account has been deactivated. Contact your Super Admin.", "error");
    return; // don't auto-redirect a terminated account back in
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  busy = true;
  await signIn({ step: 0 }, { quietIfNoSession: true });
  busy = false;
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (openedFromFile || busy) return;
  const lockedUntil = getLoginLock();
  if (lockedUntil) { showLoginLock(lockedUntil); return; }
  showMessage("", "");
  busy = true;
  setLoading();
  const email = resolveLoginEmail(document.getElementById("login-email").value);
  const password = document.getElementById("login-password").value;
  const ok = await signIn({ step: 0, email, password });
  if (!ok) {
    busy = false;
    const lockedUntil = getLoginLock();
    if (lockedUntil) showLoginLock(lockedUntil);
  }
});

// ---- Device passkey sign-in ----

const fpBox = document.getElementById("fp-box");
const fpBtn = document.getElementById("fp-signin");
const fpMsg = document.getElementById("fp-message");

async function doFingerprint() {
  if (!fpBtn || fpBtn.disabled || busy || document.body.classList.contains("booting")) return;
  const lockedUntil = getLoginLock();
  if (lockedUntil) { showLoginLock(lockedUntil); return; }
  fpBtn.disabled = true;
  fpMsg.textContent = "Verify with your device…";
  fpMsg.dataset.tone = "info";
  try {
    await signInWithFingerprint();
    fpMsg.textContent = "";
    busy = true;
    const ok = await signIn({ step: 0 });
    busy = false;
    if (!ok) fpBtn.disabled = false;
  } catch (err) {
    busy = false;
    fpMsg.textContent = err.message || String(err);
    fpMsg.dataset.tone = "error";
    fpBtn.disabled = false;
  }
}

(async () => {
  if (!fpBox || !(await fingerprintSupported())) return;
  fpBox.hidden = false;
  if (window.lucide) lucide.createIcons();
  fpBtn.addEventListener("click", doFingerprint);
  // Opened as the installed app on a device that already has a passkey:
  // offer the device verification prompt straight away.
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const terminated = new URLSearchParams(location.search).get("terminated") === "1";
  if (standalone && deviceHasFingerprint() && !terminated) setTimeout(doFingerprint, 300);
})();
