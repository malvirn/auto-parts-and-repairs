import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://centric-auto-mobile.pages.dev";
const ALLOWED_ORIGINS = new Set([APP_ORIGIN,"https://apandr.netlify.app","http://localhost:5500","http://127.0.0.1:5500"]);
const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const jsonResponse = (body: Record<string, unknown>, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });

const GEMINI_MODEL = "gemini-3.6-flash";
const GROQ_MODEL = "openai/gpt-oss-120b";

async function callGemini(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const body: Record<string, unknown> = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }
  );
  if (!response.ok) { console.error("Gemini request failed:", response.status, await response.text()); throw new Error("Gemini request failed"); }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function callGroq(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = Deno.env.get("GROQ_API_KEY");
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({ model: GROQ_MODEL, messages }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) { console.error("Groq request failed:", response.status, await response.text()); throw new Error("Groq request failed"); }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Groq returned no text");
  return text;
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);
  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > 20000) return jsonResponse({ error: "Request is too large" }, 413, origin);
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "Authentication is required" }, 401, origin);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return jsonResponse({ error: "AI service is not configured" }, 503, origin);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: "Your session could not be verified" }, 401, origin);
    const payload = await req.json();
    const provider = payload?.provider;
    const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
    const systemPrompt = typeof payload?.systemPrompt === "string" ? payload.systemPrompt.trim() : "";
    if (!prompt) return jsonResponse({ error: "prompt is required" }, 400, origin);
    if (prompt.length > 12000 || systemPrompt.length > 6000) return jsonResponse({ error: "The prompt is too long" }, 413, origin);
    if (provider !== "gemini" && provider !== "groq") return jsonResponse({ error: "provider must be 'gemini' or 'groq'" }, 400, origin);
    if (provider === "gemini" && !Deno.env.get("GEMINI_API_KEY")) return jsonResponse({ error: "Gemini is not configured" }, 503, origin);
    if (provider === "groq" && !Deno.env.get("GROQ_API_KEY")) return jsonResponse({ error: "Groq is not configured" }, 503, origin);
    const { error: quotaError } = await supabase.rpc("consume_ai_assist_quota");
    if (quotaError) {
      if (quotaError.code === "P0001" || quotaError.message?.includes("AI request limit")) return jsonResponse({ error: "AI request limit reached. Try again in a few minutes." }, 429, origin);
      console.error("AI quota check failed:", quotaError);
      return jsonResponse({ error: "AI service could not verify your usage limit" }, 503, origin);
    }
    const text = provider === "gemini" ? await callGemini(prompt, systemPrompt || undefined) : await callGroq(prompt, systemPrompt || undefined);
    return jsonResponse({ text, provider }, 200, origin);
  } catch (error) {
    console.error("ai-assist error:", error);
    return jsonResponse({ error: "AI request failed. Please try again." }, 502, origin);
  }
});