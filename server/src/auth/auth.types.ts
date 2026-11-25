export const CENTRIC_ROLES = [
  "super_admin",
  "workshop",
  "staff",
  "accounting",
] as const;

export type CentricRole = (typeof CENTRIC_ROLES)[number];

export interface AuthenticatedUser {
  id: string;
  role: CentricRole;
}

export function isCentricRole(value: unknown): value is CentricRole {
  return (
    typeof value === "string" &&
    (CENTRIC_ROLES as readonly string[]).includes(value)
  );
}

export function hasAnyRole(
  actualRole: unknown,
  requiredRoles: readonly CentricRole[],
): boolean {
  return isCentricRole(actualRole) && requiredRoles.includes(actualRole);
}
