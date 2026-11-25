import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { SupabaseAuthService } from "./supabase-auth.service.js";
import type { AppEnvironment } from "../config/env.js";

const environment: AppEnvironment = {
  port: 3000,
  supabaseUrl: "https://project-ref.supabase.co",
  supabasePublishableKey: "sb_publishable_test_key",
  corsOrigins: ["https://centric.example.com"],
};

const userId = "11111111-2222-4333-8444-555555555555";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function service() {
  return new SupabaseAuthService(environment);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SupabaseAuthService", () => {
  it("verifies the access token and returns an active Centric role", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse([
        { id: userId, role: "workshop", is_active: true },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service().authenticate("valid-user-token")).resolves.toEqual({
      id: userId,
      role: "workshop",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [authUrl, authOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(authUrl).toBe("https://project-ref.supabase.co/auth/v1/user");
    expect(new Headers(authOptions.headers).get("Authorization")).toBe(
      "Bearer valid-user-token",
    );
    const [profileUrl, profileOptions] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(profileUrl.searchParams.get("select")).toBe("id,role,is_active");
    expect(profileUrl.searchParams.get("id")).toBe(`eq.${userId}`);
    expect(profileOptions.method).toBe("GET");
  });

  it("rejects invalid or expired access tokens without querying profiles", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service().authenticate("expired-token")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects inactive profiles", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse([
        { id: userId, role: "staff", is_active: false },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service().authenticate("valid-user-token")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("rejects profiles with unrecognised roles", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: userId }))
      .mockResolvedValueOnce(jsonResponse([
        { id: userId, role: "superadmin", is_active: true },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service().authenticate("valid-user-token")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("fails closed when Supabase cannot be reached", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service().authenticate("valid-user-token")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
