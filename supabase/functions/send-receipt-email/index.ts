import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://centric-auto-mobile.pages.dev";
const ALLOWED_ORIGINS = new Set([
  APP_ORIGIN,
  "https://apandr.netlify.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : APP_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 15_000_000) {
      return jsonResponse({ error: "The document is too large to email" }, 413, origin);
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication is required" }, 401, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("STATUS_FROM_EMAIL") || Deno.env.get("RECEIPT_FROM_EMAIL");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "The email service is not configured" }, 503, origin);
    }
    if (!resendApiKey || !fromEmail) {
      return jsonResponse({
        error: "Document email is not configured. Set RESEND_API_KEY and a verified STATUS_FROM_EMAIL sender.",
      }, 503, origin);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: "Your session could not be verified" }, 401, origin);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role,access_level")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError || !profile ||
        (profile.role !== "super_admin" && profile.role !== "accounting" && Number(profile.access_level || 0) < 1)) {
      return jsonResponse({ error: "You are not authorised to email business documents" }, 403, origin);
    }

    const rawBody = await req.text();
    if (rawBody.length > 15_000_000) {
      return jsonResponse({ error: "The document is too large to email" }, 413, origin);
    }
    const payload = JSON.parse(rawBody);
    const recipient = typeof payload?.to === "string" ? payload.to.trim().toLowerCase() : "";
    const attachment = typeof payload?.fileBase64 === "string"
      ? payload.fileBase64
      : typeof payload?.imageBase64 === "string" ? payload.imageBase64 : "";
    const mimeType = payload?.mimeType === "application/pdf" ? "application/pdf" : "image/png";
    const subject = typeof payload?.subject === "string" ? payload.subject.trim().slice(0, 200) : "Your document from Centric Auto Mobile";
    const emailText = typeof payload?.text === "string" ? payload.text.slice(0, 12000) : "Please find your document attached.";

    if (!validEmail(recipient) || !attachment) {
      return jsonResponse({ error: "A valid customer email and document attachment are required" }, 400, origin);
    }
    if (attachment.length > 14_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(attachment)) {
      return jsonResponse({ error: "The attachment is invalid or too large" }, 413, origin);
    }

    const { data: emailCustomer, error: customerEmailError } = await supabase
      .from("customers")
      .select("id")
      .is("deleted_at", null)
      .eq("email", recipient)
      .limit(1)
      .maybeSingle();
    if (customerEmailError) {
      return jsonResponse({ error: "The customer email could not be verified" }, 503, origin);
    }
    let verifiedCustomer = emailCustomer;
    if (!verifiedCustomer) {
      const { data: companyCustomer, error: companyEmailError } = await supabase
        .from("customers")
        .select("id")
        .is("deleted_at", null)
        .eq("company_email", recipient)
        .limit(1)
        .maybeSingle();
      if (companyEmailError) {
        return jsonResponse({ error: "The customer email could not be verified" }, 503, origin);
      }
      verifiedCustomer = companyCustomer;
    }
    if (!verifiedCustomer) {
      return jsonResponse({ error: "The recipient must match an email saved on an active customer record" }, 403, origin);
    }

    const fileName = typeof payload?.fileName === "string" && /^[\w.-]{1,120}$/.test(payload.fileName)
      ? payload.fileName
      : "centric-document." + (mimeType === "application/pdf" ? "pdf" : "png");

    const providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
        subject,
        text: emailText,
        html: "<p>" + emailText.replace(/[&<>\\"']/g, character => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        })[character] || character).replace(/\n/g, "<br>") + "</p>",
        attachments: [{
          filename: fileName,
          content: attachment,
          content_type: mimeType,
        }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!providerResponse.ok) {
      console.error("Document email provider rejected the request:", providerResponse.status);
      return jsonResponse({ error: "The email provider could not send this document" }, 502, origin);
    }

    const providerData = await providerResponse.json().catch(() => ({}));
    return jsonResponse({ sent: true, id: providerData?.id ?? null }, 200, origin);
  } catch (error) {
    console.error("Document email failed:", error);
    return jsonResponse({ error: "The document email could not be sent" }, 500, origin);
  }
});
