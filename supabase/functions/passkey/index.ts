// supabase/functions/passkey/index.ts
//
// Fingerprint sign-in (WebAuthn passkeys) for Auto Parts & Repairs.
//   register-options / register-verify  — signed-in user adds a fingerprint (max 3)
//   login-options    / login-verify     — anyone proves a registered fingerprint
//                                         and receives a one-time sign-in token
//
// Deployed with verify_jwt = false because the login steps run before the
// person is signed in; the register steps check the caller's JWT themselves.
// Uses the project's built-in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.1.1";
import { isoBase64URL } from "npm:@simplewebauthn/server@13.1.1/helpers";

const RP_NAME = "Auto Parts & Repairs";
const MAX_CREDENTIALS = 3;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function originOf(req: Request): { origin: string; rpID: string } {
  const origin = req.headers.get("origin") || "";
  let url: URL;
  try { url = new URL(origin); } catch { throw new HttpError(400, "Missing or invalid Origin header."); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new HttpError(400, "Fingerprint sign-in needs a secure (https) address.");
  return { origin: url.origin, rpID: url.hostname };
}

async function requireUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first.");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Your session has expired. Sign in again.");
  return data.user;
}

async function saveChallenge(challenge: string, kind: "register" | "login", origin: string, userId: string | null) {
  // tidy up old, unused challenges while we're here
  await admin.from("webauthn_challenges").delete().lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const { data, error } = await admin.from("webauthn_challenges")
    .insert({ challenge, kind, origin, user_id: userId }).select("id").single();
  if (error) throw new HttpError(500, "Couldn't start: " + error.message);
  return data.id as string;
}

async function takeChallenge(id: string, kind: "register" | "login", origin: string, userId: string | null) {
  if (!id) throw new HttpError(400, "Missing challenge.");
  const { data, error } = await admin.from("webauthn_challenges")
    .update({ used: true }).eq("id", id).eq("kind", kind).eq("used", false).select("*").maybeSingle();
  if (error || !data) throw new HttpError(400, "This request has expired. Try again.");
  if (Date.now() - new Date(data.created_at).getTime() > CHALLENGE_TTL_MS) throw new HttpError(400, "This request has expired. Try again.");
  if (data.origin !== origin) throw new HttpError(400, "This request came from a different address.");
  if (userId && data.user_id !== userId) throw new HttpError(400, "This request belongs to another account.");
  return data.challenge as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const { origin, rpID } = originOf(req);

    // ---------- add a fingerprint (signed in) ----------
    if (action === "register-options") {
      const user = await requireUser(req);
      const { count } = await admin.from("webauthn_credentials").select("id", { count: "exact", head: true }).eq("user_id", user.id);
      if ((count || 0) >= MAX_CREDENTIALS) throw new HttpError(400, "This account already has 3 fingerprint sign-ins. Remove one first.");
      // A fresh user handle per fingerprint: phones keep one passkey per
      // (site, user handle), so reusing the account id would make each new
      // registration replace the previous one on the same device.
      const label = String(body.label || "").trim().slice(0, 40) || "Fingerprint";
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID,
        userName: user.email || user.id,
        userDisplayName: `${user.email || "Staff member"} (${label})`,
        attestationType: "none",
        authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
        timeout: 60000,
      });
      const challengeId = await saveChallenge(options.challenge, "register", origin, user.id);
      return json({ options, challengeId });
    }

    if (action === "register-verify") {
      const user = await requireUser(req);
      const expectedChallenge = await takeChallenge(String(body.challengeId || ""), "register", origin, user.id);
      const verification = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) throw new HttpError(400, "The fingerprint couldn't be verified.");
      const info = verification.registrationInfo;
      const label = String(body.label || "").trim().slice(0, 40) || "Fingerprint";
      const { error } = await admin.from("webauthn_credentials").insert({
        user_id: user.id,
        credential_id: info.credential.id,
        public_key: isoBase64URL.fromBuffer(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports || [],
        label,
        rp_id: rpID,
        origin,
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
      });
      if (error) throw new HttpError(400, /3 fingerprint/.test(error.message) ? error.message : "Couldn't save the fingerprint: " + error.message);
      return json({ ok: true, label });
    }

    // ---------- sign in with a fingerprint ----------
    if (action === "login-options") {
      const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: 60000 });
      const challengeId = await saveChallenge(options.challenge, "login", origin, null);
      return json({ options, challengeId });
    }

    if (action === "login-verify") {
      const expectedChallenge = await takeChallenge(String(body.challengeId || ""), "login", origin, null);
      const credentialId = String(body.response?.id || "");
      const { data: cred } = await admin.from("webauthn_credentials").select("*").eq("credential_id", credentialId).maybeSingle();
      if (!cred) throw new HttpError(400, "This fingerprint isn't registered for any account here. Sign in with your password, then add it in Settings.");
      if (cred.origin !== origin || cred.rp_id !== rpID) throw new HttpError(400, "This fingerprint was registered on a different address.");

      const verification = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge,
        expectedOrigin: cred.origin,
        expectedRPID: cred.rp_id,
        credential: {
          id: cred.credential_id,
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter: Number(cred.counter) || 0,
          transports: cred.transports || [],
        },
        requireUserVerification: true,
      });
      if (!verification.verified) throw new HttpError(401, "The fingerprint couldn't be verified.");

      await admin.from("webauthn_credentials").update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      }).eq("id", cred.id);

      const { data: profile } = await admin.from("profiles").select("is_active").eq("id", cred.user_id).maybeSingle();
      if (profile && profile.is_active === false) throw new HttpError(403, "This account has been deactivated. Contact your Super Admin.");

      const { data: u, error: uErr } = await admin.auth.admin.getUserById(cred.user_id);
      if (uErr || !u?.user?.email) throw new HttpError(400, "This account can't be found.");
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
      if (linkErr || !link?.properties?.hashed_token) throw new HttpError(500, "Couldn't start the session: " + (linkErr?.message || "no token"));
      return json({ token_hash: link.properties.hashed_token, type: link.properties.verification_type || "magiclink", email: u.user.email, label: cred.label });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 400;
    console.error("passkey error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});
