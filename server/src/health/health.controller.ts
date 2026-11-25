import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/auth.decorators.js";

@Public()
@Controller("health")
export class HealthController {
  @Get("live")
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  ready() {
    return { status: "ready" };
  }
}
