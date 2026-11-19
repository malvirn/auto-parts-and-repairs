// ========= Device passkey sign-in (WebAuthn) =========
// Talks to the `passkey` Supabase Edge Function, which verifies the device
// passkey and hands back a one-time token for a normal Supabase session.
// Biometric data never leaves the device.
import supabase, { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js";

const LIB_URL = "https://unpkg.com/@simplewebauthn/browser@13.1.0/dist/bundle/index.umd.min.js";
const HINT_KEY = "apr-fingerprint";
export const MAX_FINGERPRINTS = 3;

let libPromise = null;
function loadLib() {
  if (window.SimpleWebAuthnBrowser) return Promise.resolve(window.SimpleWebAuthnBrowser);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = LIB_URL;
      s.onload = () => window.SimpleWebAuthnBrowser ? resolve(window.SimpleWebAuthnBrowser) : reject(new Error("Passkey support didn't load."));
      s.onerror = () => { libPromise = null; reject(new Error("Couldn't load passkey support. Check your internet connection.")); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

export async function fingerprintSupported() {
  try {
    return !!(window.PublicKeyCredential && window.isSecureContext &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}

export function deviceHasFingerprint() {
  try { return localStorage.getItem(HINT_KEY) === "1"; } catch (e) { return false; }
}
function rememberDevice(on) {
  try { on ? localStorage.setItem(HINT_KEY, "1") : localStorage.removeItem(HINT_KEY); } catch (e) {}
}

async function callFn(action, payload = {}, accessToken = null) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/passkey`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch (e) {
    throw new Error("Couldn't reach the server. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function friendly(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "AbortError") return "Device verification was cancelled or timed out.";
  if (name === "InvalidStateError") return "This device already has that passkey.";
  if (name === "SecurityError") return "Passkey sign-in only works on the app's secure (https) address.";
  if (name === "NotSupportedError") return "This device doesn't support passkey sign-in.";
  return err?.message || String(err);
}

// Signed in → add a device passkey to this account (max 3).
export async function registerFingerprint(label) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sign in first.");
  const lib = await loadLib();
  const { options, challengeId } = await callFn("register-options", { label }, session.access_token);
  let response;
  try { response = await lib.startRegistration({ optionsJSON: options }); }
  catch (e) { throw new Error(friendly(e)); }
  const result = await callFn("register-verify", { challengeId, response, label }, session.access_token);
  rememberDevice(true);
  return result;
}

// Signed out → sign in with a registered device passkey.
export async function signInWithFingerprint() {
  const lib = await loadLib();
  const { options, challengeId } = await callFn("login-options");
  let response;
  try { response = await lib.startAuthentication({ optionsJSON: options }); }
  catch (e) { throw new Error(friendly(e)); }
  const { token_hash, type } = await callFn("login-verify", { challengeId, response });
  const { data, error } = await supabase.auth.verifyOtp({ token_hash, type: type || "magiclink" });
  if (error || !data?.session) throw new Error(error?.message || "Couldn't start your session. Try again.");
  rememberDevice(true);
  return data.session;
}

export async function listFingerprints() {
  const { data, error } = await supabase.from("webauthn_credentials")
    .select("id, label, created_at, last_used_at, device_type").order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function removeFingerprint(id) {
  const { data, error } = await supabase.from("webauthn_credentials").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("The device passkey was not removed. Refresh the list and try again.");
  const left = await listFingerprints().catch(() => []);
  if (!left.length) rememberDevice(false);
}

export async function renameFingerprint(id, label) {
  const { error } = await supabase.from("webauthn_credentials").update({ label: String(label).trim().slice(0, 40) || "Fingerprint" }).eq("id", id);
  if (error) throw new Error(error.message);
}
