import { afterEach, describe, expect, test } from "bun:test";
import { POST } from "./route";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("magic-link backend bridge", () => {
  test("rejects malformed and unknown request fields", async () => {
    const response = await POST(new Request("http://localhost/api/auth/magic/validate", {
      method: "POST",
      body: JSON.stringify({ token_hash: "invalid", extra: true }),
    }));

    expect(response.status).toBe(400);
  });

  test("forwards authentication cookies from the backend", async () => {
    process.env.BACKEND_API_URL = "https://api.example.com";
    process.env.BACKEND_API_KEY = "test-key";
    let forwardedUrl = "";
    let forwardedApiKey = "";
    const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const forwardedRequest = new Request(input, init);
      forwardedUrl = forwardedRequest.url;
      forwardedApiKey = forwardedRequest.headers.get("x-vorinthex-api-key") ?? "";
      return new Response(JSON.stringify({ status: "authenticated" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "vorinthex_access=token; HttpOnly; Path=/",
        },
      });
    }) as typeof fetch;
    fetchMock.preconnect = originalFetch.preconnect;
    globalThis.fetch = fetchMock;

    const response = await POST(new Request("http://localhost/api/auth/magic/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_hash: "a".repeat(64) }),
    }));

    expect(forwardedUrl).toBe("https://api.example.com/api/v1/auth/magic/validate");
    expect(forwardedApiKey).toBe("test-key");
    expect(response.headers.get("set-cookie")).toContain("vorinthex_access=token");
    expect(await response.json()).toEqual({ status: "authenticated" });
  });
});
