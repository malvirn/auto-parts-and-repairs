import { describe, expect, it } from "vitest";

describe("Vitest environment", () => {
  it("runs tests in the configured test mode", () => {
    expect(import.meta.env.MODE).toBe("test");
  });
});
