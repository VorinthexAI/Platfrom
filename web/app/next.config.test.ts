import { describe, expect, test } from "bun:test";
import nextConfig, { getCheckoutHeaders, getPrivateAuthHeaders } from "./next.config";

describe("checkout response headers", () => {
  test("prevents storage, referrer leakage, framing, and indexing", () => {
    const headers = Object.fromEntries(getCheckoutHeaders().map(({ key, value }) => [key, value]));
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Robots-Tag"]).toContain("nosnippet");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self'");
  });
});

describe("private authentication response headers", () => {
  test("prevents storage, referrer leakage, framing, and indexing", () => {
    const headers = Object.fromEntries(getPrivateAuthHeaders().map(({ key, value }) => [key, value]));
    expect(headers["Cache-Control"]).toContain("no-store");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Robots-Tag"]).toContain("noarchive");
    expect(headers["X-Robots-Tag"]).toContain("nosnippet");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("form-action 'self'");
  });

  test("applies the private policy to both page trees", async () => {
    const rules = await nextConfig.headers?.();
    const privateSources = rules
      ?.filter((rule) => rule.headers.some(({ key }) => key === "X-Robots-Tag" && rule.source !== "/checkout/:path*"))
      .map(({ source }) => source);
    expect(privateSources).toContain("/admin/:path*");
    expect(privateSources).toContain("/auth/mfa/:path*");
    expect(privateSources).toContain("/public/auth/token");
    expect(privateSources).toContain("/auth/mfa");
    expect(privateSources).toContain("/capability/signal");
    expect(privateSources).toContain("/referral/:path*");
  });
});
