import "reflect-metadata";
import { env as cloudflareEnv } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureHttpApp } from "./app.setup.js";
import { validateEnvironment } from "./config/env.js";

const bindings = cloudflareEnv as typeof cloudflareEnv & {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  CORS_ORIGINS?: string;
  PORT?: string;
};

const environment = validateEnvironment({
  SUPABASE_URL: bindings.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: bindings.SUPABASE_PUBLISHABLE_KEY,
  CORS_ORIGINS: bindings.CORS_ORIGINS ?? "",
  PORT: bindings.PORT ?? "3000",
});

const app = await NestFactory.create(AppModule.register(environment), {
  bufferLogs: true,
});
configureHttpApp(app, environment);

// Workers do not provide a traditional process to shut down. The HTTP server
// is bridged to the Worker fetch handler by Cloudflare's Node.js integration.
await app.listen(environment.port, "0.0.0.0");

export default httpServerHandler({ port: environment.port });
