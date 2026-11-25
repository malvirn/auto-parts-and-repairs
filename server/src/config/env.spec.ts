import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./env.js";

const validEnvironment = {
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  PORT: "3000",
  CORS_ORIGINS: "https://centric.example.com",
};

describe("API environment validation", () => {
  it("loads a valid HTTPS Supabase configuration", () => {
    expect(loadEnvironment(validEnvironment)).toEqual({
      port: 3000,
      supabaseUrl: "https://project-ref.supabase.co",
      supabasePublishableKey: "sb_publishable_test_key",
      corsOrigins: ["https://centric.example.com"],
    });
  });

  it("rejects legacy JWT service-role keys", () => {
    const payload = Buffer.from(
      JSON.stringify({ role: "service_role" }),
    ).toString("base64url");
    const legacySecret = `header.${payload}.signature`;

    expect(() =>
      loadEnvironment({
        ...validEnvironment,
        SUPABASE_PUBLISHABLE_KEY: legacySecret,
      }),
    ).toThrow(/service-role or secret key/i);
  });

  it("rejects secret-key format", () => {
    expect(() =>
      loadEnvironment({
        ...validEnvironment,
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_use",
      }),
    ).toThrow(/service-role or secret key/i);
  });

  it("rejects non-HTTPS Supabase URLs", () => {
    expect(() =>
      loadEnvironment({
        ...validEnvironment,
        SUPABASE_URL: "http://project-ref.supabase.co",
      }),
    ).toThrow(/HTTPS/);
  });
});
