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
  const email = emailInput.value.trim();
  if (!email) {
    emailInput.focus();
    showMessage("Enter your email address first, then choose the password reset link.", "error");
    return;
  }
  if (!emailInput.checkValidity()) {
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
      const reason = error?.message || "Something went wrong. Please try again.";
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
  showMessage("", "");
  busy = true;
  setLoading();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const ok = await signIn({ step: 0, email, password });
  if (!ok) { busy = false; }
});

// ---- Device passkey sign-in ----

const fpBox = document.getElementById("fp-box");
const fpBtn = document.getElementById("fp-signin");
const fpMsg = document.getElementById("fp-message");

async function doFingerprint() {
  if (!fpBtn || fpBtn.disabled || busy || document.body.classList.contains("booting")) return;
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
