import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalisePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!authHeader.startsWith("Bearer ") || !supabaseUrl || !anonKey) {
    return json({ error: "Authentication required" }, 401);
  }

  const token = authHeader.slice(7);
  const authCheck = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!authCheck.ok) return json({ error: "Invalid or expired session" }, 401);

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const to = normalisePhone(input.to);
  if (!to) return json({ error: "Customer phone number must include a valid country code" }, 400);

  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
  const templateLanguage = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") || "en_US";
  if (!accessToken || !phoneNumberId || !templateName) {
    return json({
      error: "WhatsApp is not fully configured. Add WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE_NAME to Supabase secrets.",
    }, 503);
  }

  const parameters = [
    String(input.customerName || "Customer").slice(0, 80),
    String(input.jobNumber || "N/A").slice(0, 40),
    String(input.status || "Updated").slice(0, 80),
    String(input.vehicle || "Vehicle").slice(0, 80),
  ];

  const graphResponse = await fetch(
    `https://graph.facebook.com/v26.0/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLanguage },
          components: [{
            type: "body",
            parameters: parameters.map((text) => ({ type: "text", text })),
          }],
        },
      }),
    },
  );

  const result = await graphResponse.json().catch(() => ({}));
  if (!graphResponse.ok) {
    console.error("WhatsApp Cloud API error:", JSON.stringify(result));
    return json({
      error: result?.error?.message || "WhatsApp could not send the message",
      code: result?.error?.code || null,
    }, 502);
  }

  return json({ success: true, messageId: result?.messages?.[0]?.id || null });
});
