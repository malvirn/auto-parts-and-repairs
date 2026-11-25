import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRED_ROLES_KEY } from "./auth.decorators.js";
import type { CentricRole, AuthenticatedUser } from "./auth.types.js";
import { hasAnyRole } from "./auth.types.js";

interface AuthenticatedRequest {
  user?: AuthenticatedUser;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      CentricRole[] | undefined
    >(REQUIRED_ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    if (!hasAnyRole(request.user?.role, requiredRoles)) {
      throw new ForbiddenException("Your Centric role cannot perform this action.");
    }

    return true;
  }
}
