import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { handleFounderAuth } from "./founder-auth-bridge";

const originalFetch = globalThis.fetch;
const originalBackendUrl = process.env.BACKEND_API_URL;
const originalBackendKey = process.env.BACKEND_API_KEY;
const hash = "a".repeat(64);

function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch;
  fetchMock.preconnect = originalFetch.preconnect;
  globalThis.fetch = fetchMock;
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`https://vorinthex.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.BACKEND_API_URL = "https://backend.example";
  process.env.BACKEND_API_KEY = "server-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBackendUrl === undefined) delete process.env.BACKEND_API_URL;
  else process.env.BACKEND_API_URL = originalBackendUrl;
  if (originalBackendKey === undefined) delete process.env.BACKEND_API_KEY;
  else process.env.BACKEND_API_KEY = originalBackendKey;
});

describe("founder authentication BFF", () => {
  test("strictly rejects unknown fields, malformed codes, query strings, and non-JSON bodies", async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return Response.json({}); });
    const requests = [
      handleFounderAuth(jsonRequest("/api/admin/gate", { email: "founder@example.com", extra: true }), "gate"),
      handleFounderAuth(jsonRequest("/api/auth/magic/validate", { token_hash: "bad" }), "magic"),
      handleFounderAuth(jsonRequest("/api/auth/totp/setup/complete", { challenge_token_hash: hash, codes: ["123456"] }), "setup-complete"),
      handleFounderAuth(jsonRequest("/api/auth/totp/verify", { challenge_token_hash: hash, code: "12345x" }), "verify"),
      handleFounderAuth(new Request("https://vorinthex.com/api/admin/session?extra=1"), "session"),
      handleFounderAuth(new Request("https://vorinthex.com/api/admin/gate", { method: "POST", body: "founder@example.com" }), "gate"),
    ];
    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 400)).toBe(true);
    expect(calls).toBe(0);
  });

  test("forwards only the server key and session cookies to the exact session endpoint", async () => {
    let forwarded: Request | undefined;
    mockFetch((request) => {
      forwarded = request;
      const headers = new Headers();
      headers.append("Set-Cookie", "vorinthex_access=fresh; HttpOnly; Path=/");
      headers.append("Set-Cookie", "vorinthex_refresh=fresh; HttpOnly; Path=/");
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify({ user: { name: "Ada" } }), { status: 200, headers });
    });

    const response = await handleFounderAuth(new Request("https://vorinthex.com/api/admin/session", {
      headers: { Cookie: "vorinthex_access=old; vorinthex_refresh=old", Authorization: "Bearer exposed" },
    }), "session");

    expect(forwarded?.url).toBe("https://backend.example/api/v1/founders/me");
    expect(forwarded?.headers.get("x-vorinthex-api-key")).toBe("server-secret");
    expect(forwarded?.headers.get("cookie")).toBe("vorinthex_access=old; vorinthex_refresh=old");
    expect(forwarded?.headers.get("authorization")).toBeNull();
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("preserves backend statuses and cookies but returns generic gateway failures", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: "invalid or expired sign-in link" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "Set-Cookie": "vorinthex_access=; Max-Age=0; HttpOnly; Path=/" },
    }));
    const rejected = await handleFounderAuth(jsonRequest("/api/auth/magic/validate", { token_hash: hash }), "magic");
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("set-cookie")).toContain("vorinthex_access=");

    mockFetch(() => { throw new Error("private upstream detail"); });
    const unavailable = await handleFounderAuth(jsonRequest("/api/admin/gate", { email: "Founder@Example.com" }), "gate");
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toEqual({ error: "Authentication service unavailable." });
  });

  test("fails closed without a configured backend credential", async () => {
    delete process.env.BACKEND_API_KEY;
    let calls = 0;
    mockFetch(() => { calls += 1; return Response.json({ ok: true }); });

    const response = await handleFounderAuth(jsonRequest("/api/admin/gate", { email: "founder@example.com" }), "gate");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Authentication service unavailable." });
    expect(calls).toBe(0);
  });

  test("forwards each strict request contract to its explicit backend operation", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    mockFetch(async (request) => {
      seen.push({ url: request.url, body: await request.json() });
      return Response.json({ ok: true }, { status: 202 });
    });
    const gateResponse = await handleFounderAuth(jsonRequest("/api/admin/gate", { email: "Founder@Example.com" }), "gate");
    await handleFounderAuth(jsonRequest("/api/auth/totp/setup/start", { challenge_token_hash: hash }), "setup-start");
    await handleFounderAuth(jsonRequest("/api/auth/totp/setup/complete", { challenge_token_hash: hash, codes: ["123456", "234567"] }), "setup-complete");
    await handleFounderAuth(jsonRequest("/api/auth/totp/verify", { challenge_token_hash: hash, code: "123456" }), "verify");
    await handleFounderAuth(jsonRequest("/api/auth/totp/reset/request", { challenge_token_hash: hash }), "reset");
    expect(seen.map(({ url }) => url)).toEqual([
      "https://backend.example/api/v1/auth/founders-gate",
      "https://backend.example/api/v1/auth/totp/setup/start",
      "https://backend.example/api/v1/auth/totp/setup/complete",
      "https://backend.example/api/v1/auth/totp/verify",
      "https://backend.example/api/v1/auth/totp/reset/request",
    ]);
    expect(seen[0]?.body).toEqual({ email: "founder@example.com" });
    expect(seen[2]?.body).toEqual({ challenge_token_hash: hash, codes: ["123456", "234567"] });
    expect(await gateResponse.json()).toEqual({ ok: true });
  });
});
