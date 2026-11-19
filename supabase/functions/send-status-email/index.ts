import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://centric-auto-mobile.pages.dev";

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin === APP_ORIGIN ? origin : APP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
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

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication is required" }, 401, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("STATUS_FROM_EMAIL");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "The function's Supabase environment is incomplete" }, 503, origin);
    }
    if (!resendApiKey || !fromEmail) {
      return jsonResponse({
        error: "Status email is not configured. Add RESEND_API_KEY and STATUS_FROM_EMAIL using a verified sender domain.",
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

    const payload = await req.json();
    const jobId = typeof payload?.jobId === "string" ? payload.jobId : "";
    const requestedStatus = typeof payload?.status === "string" ? payload.status : "";
    if (!jobId || !["Ready for Pickup", "Processed", "Completed"].includes(requestedStatus)) {
      return jsonResponse({ error: "A valid job card and completed status are required" }, 400, origin);
    }

    const { data: job, error: jobError } = await supabase
      .from("repair_jobs")
      .select("id,job_number,cro_number,status,total_cost,customers(full_name,company_name,email,company_email),vehicles(make,model)")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      return jsonResponse({ error: "The job card could not be verified for this account" }, 403, origin);
    }
    if (!job) {
      return jsonResponse({ error: "Job card not found" }, 404, origin);
    }
    if (job.status !== requestedStatus) {
      return jsonResponse({ error: "The job status has changed. Refresh the job card before sending an update." }, 409, origin);
    }

    const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers;
    const vehicle = Array.isArray(job.vehicles) ? job.vehicles[0] : job.vehicles;
    const recipient = customer?.company_email || customer?.email || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return jsonResponse({ error: "The customer does not have a valid email address on file" }, 400, origin);
    }

    const ready = requestedStatus === "Ready for Pickup";
    const customerName = customer?.company_name || customer?.full_name || "Customer";
    const device = [vehicle?.make, vehicle?.model].filter(Boolean).join(" ") || "your vehicle";
    const jobNumber = job.cro_number || ("JC-" + String(job.job_number ?? "").padStart(5, "0"));
    const totalCost = Number(job.total_cost || 0);
    const safeName = escapeHtml(customerName);
    const safeDevice = escapeHtml(device);
    const safeJobNumber = escapeHtml(jobNumber);
    const safeTotal = totalCost.toFixed(2);

    const subject = ready
      ? "Your " + device + " is ready for pickup (Job #" + jobNumber + ")"
      : "Your " + device + " repair is complete (Job #" + jobNumber + ")";
    const html = ready
      ? "Hi " + safeName + ",<br><br>Your " + safeDevice + " (Job #" + safeJobNumber + ") is ready for pickup.<br>Total cost: $" + safeTotal + "<br><br>Thank you for choosing Centric Auto Mobile."
      : "Hi " + safeName + ",<br><br>Your " + safeDevice + " (Job #" + safeJobNumber + ") has been completed.<br>Total cost: $" + safeTotal + "<br><br>Thank you for choosing Centric Auto Mobile.";
    const text = ready
      ? "Hi " + customerName + ", your " + device + " (Job #" + jobNumber + ") is ready for pickup. Total cost: $" + safeTotal + "."
      : "Hi " + customerName + ", your " + device + " repair (Job #" + jobNumber + ") has been completed. Total cost: $" + safeTotal + ".";

    const providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromEmail, to: [recipient], subject, html, text }),
    });
    const providerData = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok) {
      return jsonResponse({ error: "The email provider rejected the status message", providerStatus: providerResponse.status }, 502, origin);
    }

    return jsonResponse({ sent: true, id: providerData?.id ?? null }, 200, origin);
  } catch (error) {
    console.error("Status email failed:", error);
    return jsonResponse({ error: "The status email could not be sent" }, 500, origin);
  }
});