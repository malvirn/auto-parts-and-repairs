import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const upstream = await fetch("https://zimrate.com/api/rates/latest", {
      headers: { Accept: "application/json" },
    });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `ZimRate returned HTTP ${upstream.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const records = await upstream.json();
    if (!Array.isArray(records)) {
      throw new Error("ZimRate returned an unexpected response.");
    }

    const rates = records.filter((row: Record<string, unknown>) =>
      typeof row.currencyPair === "string" && row.currencyPair.startsWith("USD/ZiG")
    );

    return new Response(JSON.stringify({
      rates,
      fetchedAt: new Date().toISOString(),
      source: "https://zimrate.com",
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unable to retrieve ZimRate data.",
    }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
