import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { AppEnvironment } from "./config/env.js";
import { APP_ENVIRONMENT } from "./config/env.js";
import { MeController } from "./auth/me.controller.js";
import { RolesGuard } from "./auth/roles.guard.js";
import { SupabaseAuthGuard } from "./auth/supabase-auth.guard.js";
import { SupabaseAuthService } from "./auth/supabase-auth.service.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  controllers: [HealthController, MeController],
  providers: [
    SupabaseAuthService,
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {
  static register(environment: AppEnvironment): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: APP_ENVIRONMENT, useValue: environment }],
    };
  }
}
