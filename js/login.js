import supabase from "./supabaseClient.js";

const form = document.getElementById("login-form");
const message = document.getElementById("login-message");

form.addEventListener("submit", async event => {
  event.preventDefault();
  message.textContent = "Signing in…";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    message.textContent = "Sign-in failed: " + error.message;
    return;
  }

  window.location.replace("index.html");
});
