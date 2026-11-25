import { describe, expect, it } from "vitest";
import {
  CENTRIC_ROLES,
  hasAnyRole,
  isCentricRole,
} from "./auth.types.js";

describe("Centric role checks", () => {
  it("recognises the four configured application roles", () => {
    expect(CENTRIC_ROLES).toEqual([
      "super_admin",
      "workshop",
      "staff",
      "accounting",
    ]);
    for (const role of CENTRIC_ROLES) expect(isCentricRole(role)).toBe(true);
  });

  it("rejects unknown and missing roles", () => {
    expect(isCentricRole("admin")).toBe(false);
    expect(isCentricRole(undefined)).toBe(false);
    expect(hasAnyRole("admin", ["super_admin"])).toBe(false);
  });

  it("allows only an explicitly required role", () => {
    expect(hasAnyRole("workshop", ["workshop", "staff"])).toBe(true);
    expect(hasAnyRole("accounting", ["workshop", "staff"])).toBe(false);
  });
});
