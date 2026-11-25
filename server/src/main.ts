import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { validateEnvironment } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const env = validateEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.enableCors({
    origin: env.corsOrigins.length ? env.corsOrigins : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "apikey", "x-request-id"],
    credentials: false,
  });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  await app.listen(env.port, "0.0.0.0");
  app.getLogger().log(`Centric API listening on port ${env.port}`);
}

bootstrap().catch((error: unknown) => {
  console.error("Centric API failed to start:", error);
  process.exitCode = 1;
});
