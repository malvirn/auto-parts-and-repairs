// supabase/functions/generate-diagnosis-update/index.ts
//
// Deploy:  supabase functions deploy generate-diagnosis-update
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Keeps the API key server-side — never put it in repairs.js or any other
// browser code, unlike the Google Places key, Anthropic's keys can't be
// restricted by domain, so exposing one client-side is a real billing risk.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// Check https://docs.claude.com for the current model id if this one ages out.
const MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY secret is not set on this project.");

    const { customerName, jobNumber, vehicle, diagnosis, eta } = await req.json();
    if (!diagnosis || !String(diagnosis).trim()) {
      return new Response(JSON.stringify({ error: "diagnosis is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const etaLine = eta
      ? `The diagnosis is expected to be complete by ${new Date(eta).toLocaleString()}.`
      : "";

    const prompt = `Write a short, friendly, professional update message from a car repair shop to a customer.
Customer name: ${customerName || "there"}
Job number: #${String(jobNumber || "").padStart(4, "0")}
Vehicle: ${vehicle || "their vehicle"}
Mechanic's diagnosis notes (internal — rewrite in plain, customer-friendly language, don't copy them verbatim): ${diagnosis}
${etaLine}

Keep it to 2-4 short sentences, plain text, suitable for both WhatsApp and email. No subject line and no sign-off (the shop adds that separately).`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error (${response.status}): ${await response.text()}`);
    }

    const data = await response.json();
    const message = (data.content || []).find((block) => block.type === "text")?.text?.trim() || "";
    if (!message) throw new Error("No message text returned from the model.");

    return new Response(JSON.stringify({ message }), {
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