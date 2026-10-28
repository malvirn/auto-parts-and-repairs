import supabase from "./supabaseClient.js";
import { fingerprintSupported, deviceHasFingerprint, signInWithFingerprint } from "./passkey.js";
import { bootStart, bootCancel, bootDeny, bootFinish, splitLetters } from "./boot.js";
import { prefetchCoreData } from "./prefetch.js";

const form = document.getElementById("login-form");
const messageEl = document.getElementById("login-message");
const submitBtn = document.getElementById("login-submit");

function resetButton() {
  submitBtn.disabled = false;
  submitBtn.innerHTML = '<i data-lucide="log-in"></i> Sign In';
  if (window.lucide) lucide.createIcons();
}

function showMessage(text, tone) {
  messageEl.textContent = text;
  messageEl.dataset.tone = tone;
}

// Animated system name on the sign-in card.
const sysName = document.getElementById("sys-name");
if (sysName) {
  sysName.innerHTML = splitLetters(sysName.textContent);
  sysName.classList.add("split");
}

// After a successful sign-in: confirm the session with the server, load the
// person's role, then show their access level and open the app. Returns
// an error message instead of opening the app if something is wrong.
async function completeSignIn(fallbackEmail) {
  const { data: { user: confirmed } } = await supabase.auth.getUser();
  if (!confirmed) return "Session didn't save properly — please try again.";

  const { data: roleProfile, error } = await supabase.from("profiles")
    .select("role, full_name, access_level").eq("id", confirmed.id).maybeSingle();
  if (error) console.error("Unable to load account role:", error);
  let profile = roleProfile ? {
    ...roleProfile,
    role: Number(roleProfile.access_level) >= 2
      ? "super_admin"
      : normalizeRole(roleProfile.role),
    is_active: true,
  } : null;
  if (profile) {
    const { data: activeProfile, error: activeError } = await supabase.from("profiles")
      .select("is_active").eq("id", confirmed.id).maybeSingle();
    if (activeError) {
      console.warn("Unable to check whether the account is active; role data loaded successfully:", activeError);
    } else {
      profile.is_active = activeProfile?.is_active !== false;
    }
  }
  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    return "This account has been deactivated. Contact your Super Admin.";
  }

  prefetchCoreData(); // fire-and-forget — overlaps with the loading screen below
  await bootFinish(profile || { role: "staff" }, confirmed.email || fallbackEmail);
  return null;
}

function normalizeRole(role) {
  const normalized = String(role || "staff").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "superadmin" ? "super_admin" : normalized;
}

// If someone's already got a valid, server-verified session and lands
// back on the login page (e.g. a bookmark), send them straight through
// instead of making them log in again for no reason.
(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("terminated") === "1") {
    showMessage("This account has been deactivated. Contact your Super Admin.", "error");
    return; // don't auto-redirect a terminated account back in
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  bootStart();
  const problem = await completeSignIn("");
  if (problem) {
    bootCancel();
    if (/deactivated/.test(problem)) showMessage(problem, "error"); // a stale session just stays on the sign-in form
  }
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("", "");

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  bootStart();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    const reason = error ? (error.message || "Sign in failed. Check your email and password.") : "Sign in didn't return a session. Please try again.";
    await bootDeny(reason);
    showMessage(reason, "error");
    resetButton();
    return;
  }

  const problem = await completeSignIn(email);
  if (problem) {
    await bootDeny(problem);
    showMessage(problem, "error");
    resetButton();
  }
});

// ---- Device passkey sign-in ----

const fpBox = document.getElementById("fp-box");
const fpBtn = document.getElementById("fp-signin");
const fpMsg = document.getElementById("fp-message");

async function doFingerprint() {
  if (!fpBtn || fpBtn.disabled || document.body.classList.contains("booting")) return;
  fpBtn.disabled = true;
  fpMsg.textContent = "Verify with your device…";
  fpMsg.dataset.tone = "info";
  try {
    await signInWithFingerprint();
    fpMsg.textContent = "Signed in.";
    bootStart();
    const problem = await completeSignIn("");
    if (problem) {
      await bootDeny(problem);
      throw new Error(problem);
    }
  } catch (err) {
    bootCancel();
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
