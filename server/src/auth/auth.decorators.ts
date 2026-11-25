import { SetMetadata } from "@nestjs/common";
import type { CentricRole } from "./auth.types.js";

export const IS_PUBLIC_KEY = "centric:is-public";
export const REQUIRED_ROLES_KEY = "centric:required-roles";

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: CentricRole[]) =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
