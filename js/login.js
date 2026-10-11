import supabase from "./supabaseClient.js";
import { fingerprintSupported, deviceHasFingerprint, signInWithFingerprint } from "./passkey.js";

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

// If someone's already got a valid, server-verified session and lands
// back on the login page (e.g. a bookmark), send them straight through
// instead of making them log in again for no reason.
(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("terminated") === "1") {
    showMessage("This account has been deactivated. Contact your Super Admin.", "error");
    return; // don't auto-redirect a terminated account back in
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (user) window.location.replace("index.html");
})();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("", "");

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    showMessage(error.message || "Sign in failed. Check your email and password.", "error");
    resetButton();
    return;
  }

  if (!data.session) {
    showMessage("Sign in didn't return a session. Please try again.", "error");
    resetButton();
    return;
  }

  // This is the step a premature redirect would skip — confirming the
  // session is actually valid (checked against the server, not just
  // trusting what got written to storage) before navigating away.
  const { data: { user: confirmed } } = await supabase.auth.getUser();
  if (!confirmed) {
    showMessage("Session didn't save properly — please try again.", "error");
    resetButton();
    return;
  }

  window.location.href = "index.html";
});

// ---- Fingerprint sign-in ----

const fpBox = document.getElementById("fp-box");
const fpBtn = document.getElementById("fp-signin");
const fpMsg = document.getElementById("fp-message");

async function doFingerprint() {
  if (!fpBtn || fpBtn.disabled) return;
  fpBtn.disabled = true;
  fpMsg.textContent = "Touch the fingerprint sensor…";
  fpMsg.dataset.tone = "info";
  try {
    await signInWithFingerprint();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Session didn't save properly — please try again.");
    fpMsg.textContent = "Signed in.";
    window.location.href = "index.html";
  } catch (err) {
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
  // Opened as the installed app on a device that already has a fingerprint
  // sign-in: offer the fingerprint prompt straight away.
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const terminated = new URLSearchParams(location.search).get("terminated") === "1";
  if (standalone && deviceHasFingerprint() && !terminated) setTimeout(doFingerprint, 300);
})();
