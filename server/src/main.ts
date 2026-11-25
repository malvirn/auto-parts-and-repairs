import "reflect-metadata";
import "dotenv/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureHttpApp } from "./app.setup.js";
import { validateEnvironment } from "./config/env.js";

async function bootstrap(): Promise<void> {
  const env = validateEnvironment();
  const app = await NestFactory.create(AppModule.register(env), {
    bufferLogs: true,
  });

  configureHttpApp(app, env);
  app.enableShutdownHooks();

  await app.listen(env.port, "0.0.0.0");
  Logger.log(`Centric API listening on port ${env.port}`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  console.error("Centric API failed to start:", error);
  process.exitCode = 1;
});
