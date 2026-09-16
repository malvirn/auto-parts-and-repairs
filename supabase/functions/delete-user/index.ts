// supabase/functions/delete-user/index.ts
//
// Deletes a login entirely. This can only be done with the service role
// key, which never touches the browser — so this function's job is to
// (1) verify the CALLER is actually a super_admin using their own JWT,
// then (2) perform the deletion using an admin client initialised with
// the service role key, which Supabase makes available to Edge Functions
// automatically as an environment variable.
//
// Deploy: supabase functions deploy delete-user
// No secrets need setting manually — SUPABASE_URL, SUPABASE_ANON_KEY, and
// SUPABASE_SERVICE_ROLE_KEY are auto-injected into every Edge Function.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // This client carries the CALLER's own JWT — used only to figure out
    // who is actually asking, nothing more.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: corsHeaders });
    }

    const { data: callerProfile, error: profileError } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profileError || callerProfile?.role !== "super_admin") {
      return new Response(JSON.stringify({ error: "Only Super Admins can delete a user" }), { status: 403, headers: corsHeaders });
    }

    const { targetUserId } = await req.json();
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "targetUserId is required" }), { status: 400, headers: corsHeaders });
    }
    if (targetUserId === user.id) {
      return new Response(JSON.stringify({ error: "You can't delete your own account from here" }), { status: 400, headers: corsHeaders });
    }

    // Only NOW do we touch the service role key, and only to perform the
    // one action that actually needs it.
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});