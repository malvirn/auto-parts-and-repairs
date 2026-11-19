import supabase from "./supabaseClient.js";

const overlay = document.getElementById("technicians-reconfirm");
const form = document.getElementById("technicians-reconfirm-form");
const emailInput = document.getElementById("technicians-reconfirm-email");
const passwordInput = document.getElementById("technicians-reconfirm-password");
const message = document.getElementById("technicians-reconfirm-message");

let initialized = false;
let accountId = null;

async function showReconfirmation() {
  if (initialized || !overlay) return;
  initialized = true;
  if (document.body.dataset.role !== "super_admin") return;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.email) {
    message.textContent = "We could not verify your signed-in account. Please sign in again.";
    overlay.hidden = false;
    return;
  }
  accountId = data.user.id;
  emailInput.value = data.user.email;
  overlay.hidden = false;
  passwordInput.focus();
  window.lucide?.createIcons();
}

if (document.body.dataset.role) showReconfirmation();
else document.addEventListener("apr:access-ready", showReconfirmation, { once: true });

form?.addEventListener("submit", async event => {
  event.preventDefault();
  message.textContent = "";
  const password = passwordInput.value;
  if (!accountId || !emailInput.value || !password) {
    message.textContent = "Enter the password for your signed-in Super Admin account.";
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Verifying…";
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value,
      password
    });
    if (error) throw error;
    if (!data?.user || data.user.id !== accountId) {
      await supabase.auth.signOut();
      throw new Error("The credentials did not match the signed-in Super Admin account.");
    }
    passwordInput.value = "";
    overlay.hidden = true;
    document.body.classList.remove("technicians-reconfirm-required");
    document.dispatchEvent(new Event("apr:technicians-unlocked"));
  } catch (error) {
    message.textContent = error.message || "Password confirmation failed.";
    passwordInput.value = "";
    passwordInput.focus();
  } finally {
    submit.disabled = false;
    submit.innerHTML = '<i data-lucide="lock-keyhole" aria-hidden="true"></i> Confirm and continue';
    window.lucide?.createIcons();
  }
});
