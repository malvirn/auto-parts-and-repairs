import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./auth.decorators.js";
import type { AuthenticatedUser } from "./auth.types.js";
import { SupabaseAuthService } from "./supabase-auth.service.js";

interface AuthenticatedRequest {
  headers: { authorization?: string };
  user?: AuthenticatedUser;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: SupabaseAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(authorization);

    if (!match?.[1]) {
      throw new UnauthorizedException("A valid Bearer session is required.");
    }

    request.user = await this.authService.authenticate(match[1].trim());
    return true;
  }
}
