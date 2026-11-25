import { Controller, Get, Req } from "@nestjs/common";
import type { AuthenticatedUser } from "./auth.types.js";

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@Controller("me")
export class MeController {
  @Get()
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return { user: request.user };
  }
}
