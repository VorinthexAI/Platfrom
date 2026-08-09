import { describe, expect, test } from "bun:test";

import { extractSessionTokens, firstNameFor, normalizeApiPath, normalizeAuthContext } from "./auth-helpers";

describe("mobile auth helpers", () => {
  test("normalizes every request beneath the API version", () => {
    expect(normalizeApiPath("/auth/me")).toBe("/auth/me");
    expect(normalizeApiPath("/api/v1/auth/me")).toBe("/auth/me");
    expect(normalizeApiPath("https://vorinthex.com/api/v1/auth/me")).toBe("/auth/me");
  });

  test("extracts completion tokens from JSON or rotation headers", () => {
    expect(extractSessionTokens({
      access_token: "access",
      refresh_token: "refresh",
      access_token_max_age_seconds: 60,
      refresh_token_max_age_seconds: 120,
    }, () => null, 1_000)).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: 61_000,
      refreshExpiresAt: 121_000,
    });
    const headers: Record<string, string> = {
      "x-access-token": "rotated-access",
      "x-refresh-token": "rotated-refresh",
      "x-access-token-max-age": "30",
      "x-refresh-token-max-age": "90",
    };
    expect(extractSessionTokens({}, (name) => headers[name], 0)?.refreshToken).toBe("rotated-refresh");
  });

  test("normalizes the me boundary and derives a greeting name", () => {
    const context = normalizeAuthContext({
      user: { display_name: "Ada Lovelace" },
      org: { key: "org" },
      main_scope: { key: "scope" },
    });
    expect(context.organization).toEqual({ key: "org" });
    expect(context.scope).toEqual({ key: "scope" });
    expect(firstNameFor(context.user)).toBe("Ada");
  });
});
