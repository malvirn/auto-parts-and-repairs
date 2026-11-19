import supabase from "./supabaseClient.js";

const form = document.getElementById("reset-form");
const message = document.getElementById("reset-message");
const submit = document.getElementById("reset-submit");
let recoverySessionReady = false;

function showMessage(text, tone) {
  message.textContent = text;
  message.dataset.tone = tone;
}

function allowPasswordChange() {
  recoverySessionReady = true;
  form.hidden = false;
  showMessage("Reset link verified. Enter your new password.", "success");
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY" && session) allowPasswordChange();
});

const hashParams = new URLSearchParams(window.location.hash.slice(1));
const queryParams = new URLSearchParams(window.location.search);
const recoveryUrl = hashParams.get("type") === "recovery"
  || queryParams.get("type") === "recovery"
  || queryParams.has("code");

try {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!recoverySessionReady && session && recoveryUrl) allowPasswordChange();
  if (!recoverySessionReady) {
    showMessage("This reset link is invalid or has expired. Request a new one from the sign-in page.", "error");
  }
} catch (error) {
  console.error("Couldn't verify password reset link:", error);
  showMessage(`Couldn't verify this reset link: ${error.message || String(error)}`, "error");
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!recoverySessionReady) {
    showMessage("This reset link is no longer valid. Request a new one from the sign-in page.", "error");
    return;
  }

  const password = document.getElementById("new-password").value;
  const confirmation = document.getElementById("confirm-password").value;
  if (password.length < 8) {
    showMessage("Use at least 8 characters for your new password.", "error");
    return;
  }
  if (password !== confirmation) {
    showMessage("The passwords do not match.", "error");
    return;
  }

  submit.disabled = true;
  showMessage("Updating your password…", "info");
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) throw new Error(`Password changed, but this session could not be signed out: ${signOutError.message}`);
    window.location.replace("../login.html?password=updated");
  } catch (error) {
    console.error("Couldn't complete password reset:", error);
    showMessage(`Couldn't update the password: ${error.message || String(error)}`, "error");
    submit.disabled = false;
  }
});
