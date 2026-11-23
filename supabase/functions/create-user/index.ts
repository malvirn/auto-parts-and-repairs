import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return Response.json({ error: "Not authenticated" }, { status: 401, headers: corsHeaders });
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return Response.json({ error: "Invalid session" }, { status: 401, headers: corsHeaders });
    const { data: profile, error: profileError } = await caller.from("profiles").select("role").eq("id", user.id).single();
    if (profileError || profile?.role !== "super_admin") return Response.json({ error: "Only Super Admins can create accounts" }, { status: 403, headers: corsHeaders });
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.fullName || "").trim();
    const password = String(body.password || "");
    const role = String(body.role || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Enter a valid email address" }, { status: 400, headers: corsHeaders });
    if (!fullName || fullName.length > 120) return Response.json({ error: "Enter a name (maximum 120 characters)" }, { status: 400, headers: corsHeaders });
    if (!["workshop", "staff", "accounting"].includes(role)) return Response.json({ error: "Choose Workshop, Staff or Accounting" }, { status: 400, headers: corsHeaders });
    if (password.length < 8 || password.length > 72) return Response.json({ error: "Password must be between 8 and 72 characters" }, { status: 400, headers: corsHeaders });
    const admin = createClient(url, serviceKey);
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (createError || !created.user) return Response.json({ error: createError?.message || "Account creation failed" }, { status: 400, headers: corsHeaders });
    const { error: roleError } = await admin.from("profiles").update({ full_name: fullName, email, role, access_level: 1, is_active: true }).eq("id", created.user.id);
    if (roleError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return Response.json({ error: "Account setup failed; incomplete login rolled back. " + roleError.message }, { status: 500, headers: corsHeaders });
    }
    return Response.json({ success: true, user: { id: created.user.id, email, full_name: fullName, role } }, { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders }); }
});