import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  APP_ENVIRONMENT,
  type AppEnvironment,
} from "../config/env.js";
import {
  isCentricRole,
  type AuthenticatedUser,
} from "./auth.types.js";

interface SupabaseAuthUser {
  id?: unknown;
}

interface ProfileRecord {
  id?: unknown;
  role?: unknown;
  is_active?: unknown;
}

@Injectable()
export class SupabaseAuthService {
  constructor(
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const env = this.env;
    const headers = {
      apikey: env.supabasePublishableKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    let authResponse: Response;
    try {
      authResponse = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Authentication service is temporarily unavailable.",
      );
    }

    if (authResponse.status === 401 || authResponse.status === 403) {
      throw new UnauthorizedException("Your session is invalid or has expired.");
    }
    if (!authResponse.ok) {
      throw new ServiceUnavailableException(
        "The authentication service could not verify this session.",
      );
    }

    const authUser = (await authResponse.json()) as SupabaseAuthUser;
    if (typeof authUser.id !== "string" || !authUser.id) {
      throw new UnauthorizedException("The session did not contain a valid user.");
    }

    const profileUrl = new URL(`${env.supabaseUrl}/rest/v1/profiles`);
    profileUrl.search = new URLSearchParams({
      select: "id,role,is_active",
      id: `eq.${authUser.id}`,
    }).toString();

    let profileResponse: Response;
    try {
      profileResponse = await fetch(profileUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ServiceUnavailableException(
        "The user access profile could not be checked.",
      );
    }

    if (profileResponse.status === 401) {
      throw new UnauthorizedException("Your session is invalid or has expired.");
    }
    if (profileResponse.status === 403) {
      throw new ForbiddenException("Your account cannot access its user profile.");
    }
    if (!profileResponse.ok) {
      throw new ServiceUnavailableException(
        "The user access profile could not be checked.",
      );
    }

    const profiles = (await profileResponse.json()) as ProfileRecord[];
    const profile = Array.isArray(profiles) ? profiles[0] : undefined;

    if (!profile || profile.id !== authUser.id) {
      throw new ForbiddenException("No active Centric user profile was found.");
    }
    if (profile.is_active !== true) {
      throw new ForbiddenException("This Centric account is inactive.");
    }
    if (!isCentricRole(profile.role)) {
      throw new ForbiddenException("This account has no recognised Centric role.");
    }

    return { id: authUser.id, role: profile.role };
  }
}
