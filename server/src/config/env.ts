export interface AppEnvironment {
  port: number;
  supabaseUrl: string;
  supabasePublishableKey: string;
  corsOrigins: string[];
}

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): AppEnvironment {
  const supabaseUrl = source.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabasePublishableKey = source.SUPABASE_PUBLISHABLE_KEY?.trim();
  const rawPort = source.PORT?.trim() || "3000";
  const port = Number(rawPort);

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured before the API can start.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS.");
  }

  if (
    /service[_-]?role|sb_secret_/i.test(supabasePublishableKey)
  ) {
    throw new Error(
      "Do not configure a Supabase service-role or secret key in this API foundation. Use the project publishable key.",
    );
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const corsOrigins = (source.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of corsOrigins) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error("Every CORS_ORIGINS entry must be a valid HTTPS origin.");
    }
    if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin) {
      throw new Error("CORS_ORIGINS entries must be HTTPS origins without paths.");
    }
  }

  return { port, supabaseUrl, supabasePublishableKey, corsOrigins };
}

export function validateEnvironment(): AppEnvironment {
  return loadEnvironment();
}
