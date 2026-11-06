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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY secret is not set on this project.");

    const { to, subject, text, fileBase64, imageBase64, fileName, mimeType, jobNumber } = await req.json();
    const attachment = fileBase64 || imageBase64;
    if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !attachment) {
      return new Response(JSON.stringify({ error: "A valid recipient email and document attachment are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof attachment !== "string" || attachment.length > 14_000_000) {
      return new Response(JSON.stringify({ error: "The attachment is too large to email." }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const contentType = mimeType === "application/pdf" ? mimeType : "image/png";
    const safeFileName = typeof fileName === "string" && /^[\w.-]+$/.test(fileName)
      ? fileName
      : `receipt-${String(jobNumber || "").replace(/[^\w.-]/g, "-")}.png`;
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]!);
    const emailText = typeof text === "string" ? text : "Please find your receipt attached. Thank you for choosing us.";

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: typeof subject === "string" ? subject.slice(0, 200) : `Your document — ${String(jobNumber || "")}`,
        text: emailText,
        html: `<p>${escapeHtml(emailText).replace(/\n/g, "<br>")}</p>`,
        attachments: [
          {
            filename: safeFileName,
            content: attachment,
            content_type: contentType,
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
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});