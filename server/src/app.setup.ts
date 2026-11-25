import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";
import type { AppEnvironment } from "./config/env.js";

export function configureHttpApp(
  app: INestApplication,
  environment: AppEnvironment,
): void {
  app.use(helmet());
  app.enableCors({
    origin: environment.corsOrigins.length ? environment.corsOrigins : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "apikey", "x-request-id"],
    credentials: false,
  });
  app.setGlobalPrefix("api/v1");
}
