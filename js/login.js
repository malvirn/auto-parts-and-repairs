import supabase from "./supabaseClient.js";

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

// If someone's already got a valid session and lands back on the login
// page (e.g. a bookmark), send them straight through instead of making
// them log in again for no reason.
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) window.location.replace("index.html");
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
  // session is actually readable back from storage before navigating
  // away. Skipping this is the single most common cause of "logs in
  // fine, but the very next page acts logged out": the redirect fires
  // before the async write to storage has actually finished.
  const { data: { session: confirmed } } = await supabase.auth.getSession();
  if (!confirmed) {
    showMessage("Session didn't save properly — please try again.", "error");
    resetButton();
    return;
  }

  window.location.href = "index.html";
});