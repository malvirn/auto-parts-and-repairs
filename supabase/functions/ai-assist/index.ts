// supabase/functions/ai-assist/index.ts
//
// A single, reusable entry point for every AI feature in this app.
// Client code never touches Gemini/Groq directly or holds their keys —
// it calls this function with { provider, prompt, systemPrompt? } and
// gets back { text } regardless of which provider actually answered.
//
// Deploy: supabase functions deploy ai-assist
// Then set the two secrets (one-time):
//   supabase secrets set GEMINI_API_KEY=your_key_here
//   supabase secrets set GROQ_API_KEY=your_key_here

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.6-flash"; // current stable Gemini flash model as of Sept 2026 — 2.5 Flash retires Oct 16 2026
const GROQ_MODEL = "llama-3.3-70b-versatile"; // current, well-supported Groq model

async function callGemini(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text — check the response shape hasn't changed.");
  return text;
}

async function callGroq(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no text — check the response shape hasn't changed.");
  return text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { provider, prompt, systemPrompt } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), { status: 400, headers: corsHeaders });
    }
    if (provider !== "gemini" && provider !== "groq") {
      return new Response(JSON.stringify({ error: "provider must be 'gemini' or 'groq'" }), { status: 400, headers: corsHeaders });
    }

    const text = provider === "gemini"
      ? await callGemini(prompt, systemPrompt)
      : await callGroq(prompt, systemPrompt);

    return new Response(JSON.stringify({ text, provider }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-assist error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
