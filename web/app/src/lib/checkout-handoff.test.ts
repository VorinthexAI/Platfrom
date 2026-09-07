import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isAllowedPolarCheckoutUrl } from "./checkout-handoff-contract";
import { handleCheckoutHandoff } from "./checkout-handoff";

const originalFetch = globalThis.fetch;
const originalBackendUrl = process.env.BACKEND_API_URL;
const originalBackendKey = process.env.BACKEND_API_KEY;
const token = `vch_${"a".repeat(43)}`;

function mockFetch(handler: (request: Request) => Response | Promise<Response>) {
  const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => handler(new Request(input, init))) as typeof fetch;
  fetchMock.preconnect = originalFetch.preconnect;
  globalThis.fetch = fetchMock;
}

function request(body: unknown, headers: HeadersInit = { "Content-Type": "application/json" }) {
  return new Request("https://vorinthex.com/api/checkout/resolve", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
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

describe("checkout handoff BFF", () => {
  test("rejects malformed bodies, unknown fields, wrong content types, and oversized bodies without fetching", async () => {
    let calls = 0;
    mockFetch(() => { calls += 1; return new Response(); });

    const responses = await Promise.all([
      handleCheckoutHandoff(request({ token: "bad" }), "resolve"),
      handleCheckoutHandoff(request({ token, extra: true }), "resolve"),
      handleCheckoutHandoff(request({ token }, { "Content-Type": "text/plain" }), "resolve"),
      handleCheckoutHandoff(request(`{"token":"${token}","padding":"${"x".repeat(100)}"}`), "resolve"),
    ]);

    expect(responses.every(({ status }) => status === 400)).toBe(true);
    expect(calls).toBe(0);
    expect(responses[0]?.headers.get("cache-control")).toContain("no-store");
  });

  test("resolves through the configured backend without forwarding incoming auth or cookies", async () => {
    let forwarded: Request | undefined;
    mockFetch((backendRequest) => {
      forwarded = backendRequest;
      return Response.json({
        success: true,
        data: {
          product: {
            key: "cm12345678901234567890123",
            productId: "nova.monthly.discounted",
            type: "subscription",
            priceCents: 2499,
            discountedPriceCents: 1999,
            currency: "USD",
            billingPeriod: "month",
            sparkGrantMicroSparks: 1_000_000_000,
            active: true,
            createdAt: "2026-09-05T00:00:00.000Z",
            updatedAt: "2026-09-05T00:00:00.000Z",
          },
          expiresAt: "2026-09-05T01:00:00.000Z",
        },
      }, { headers: { "Set-Cookie": "backend_session=secret" } });
    });

    const response = await handleCheckoutHandoff(request({ token }, {
      "Content-Type": "application/json; charset=utf-8",
      Cookie: "incoming=secret",
      Authorization: "Bearer incoming",
    }), "resolve");

    expect(response.status).toBe(200);
    expect(forwarded?.url).toBe("https://backend.example/api/v1/payments/checkout-handoffs/resolve");
    expect(forwarded?.headers.get("x-vorinthex-api-key")).toBe("server-secret");
    expect(forwarded?.headers.get("cookie")).toBeNull();
    expect(forwarded?.headers.get("authorization")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      success: true,
      data: {
        product: {
          name: "Monthly membership",
          type: "subscription",
          priceCents: 1999,
          referencePriceCents: 2499,
          currency: "USD",
          billingPeriod: "month",
          sparks: 1000,
        },
        expiresAt: "2026-09-05T01:00:00.000Z",
      },
    });
  });

  test("returns only an allowlisted Polar HTTPS URL from continue and forwards a validated customer IP", async () => {
    let forwarded: Request | undefined;
    mockFetch((backendRequest) => { forwarded = backendRequest; return Response.json({ success: true, data: { url: "https://checkout.polar.sh/session/abc" } }); });
    const response = await handleCheckoutHandoff(request({ token }, { "Content-Type": "application/json", "x-forwarded-for": "invalid, 203.0.113.7" }), "continue");
    expect(await response.json()).toEqual({ success: true, data: { url: "https://checkout.polar.sh/session/abc" } });
    expect(forwarded?.headers.get("x-vorinthex-customer-ip")).toBe("203.0.113.7");
  });

  test("rejects deceptive checkout hosts and converts backend details to generic errors", async () => {
    expect(isAllowedPolarCheckoutUrl("https://checkout.polar.sh.evil.example/session")).toBe(false);
    expect(isAllowedPolarCheckoutUrl("http://checkout.polar.sh/session")).toBe(false);
    expect(isAllowedPolarCheckoutUrl("https://checkout.polar.sh:8443/session")).toBe(false);
    mockFetch(() => Response.json({ success: true, data: { url: "https://checkout.polar.sh.evil.example/session" } }));
    const invalidUrl = await handleCheckoutHandoff(request({ token }), "continue");
    expect(invalidUrl.status).toBe(502);

    mockFetch(() => Response.json({ success: false, error: "database details" }, { status: 500 }));
    const backendError = await handleCheckoutHandoff(request({ token }), "resolve");
    expect(await backendError.text()).not.toContain("database details");
  });
});
