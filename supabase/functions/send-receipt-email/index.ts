// supabase/functions/send-receipt-email/index.ts
//
// Deploy:  supabase functions deploy send-receipt-email
// Secrets: supabase secrets set RESEND_API_KEY=re_...
//          supabase secrets set RECEIPT_FROM_EMAIL="Auto Parts and Repairs <receipts@yourdomain.com>"
//
// Uses Resend (resend.com) because it's the simplest email API to set up
// with attachment support. If you already have a different provider wired
// up for send-status-email, tell Claude which one and this can be rewritten
// to match instead of running two separate email services.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("RECEIPT_FROM_EMAIL") || "receipts@example.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY secret is not set on this project.");

    const { to, subject, imageBase64, jobNumber } = await req.json();
    if (!to || !imageBase64) {
      return new Response(JSON.stringify({ error: "to and imageBase64 are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: subject || `Your receipt — Job #${String(jobNumber || "").padStart(4, "0")}`,
        html: `<p>Please find your receipt attached. Thank you for choosing us.</p>`,
        attachments: [
          {
            filename: `receipt-${String(jobNumber || "").padStart(4, "0")}.png`,
            content: imageBase64, // Resend expects base64-encoded content
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend API error (${response.status}): ${await response.text()}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});