import { afterEach, describe, expect, test } from "bun:test";
import { fetchOrganizationProviders, updateOrganizationProviderCredentials } from "./client";

const originalFetch = globalThis.fetch;
const requestUrl = (input: RequestInfo | URL) => input instanceof Request
  ? input.url
  : new URL(input.toString(), "http://localhost").toString();

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("organization provider client", () => {
  test("loads safe provider metadata from the organization endpoint", async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (input) => {
      request = new Request(requestUrl(input));
      return Response.json({ providers: [{ provider: "openai", linked: true, credentialsConfigured: true }] });
    }) as typeof fetch;

    await expect(fetchOrganizationProviders("org/key")).resolves.toEqual([
      { provider: "openai", linked: true, credentialsConfigured: true },
    ]);
    expect(request?.url).toEndWith("/api/founders/organizations/org%2Fkey/providers");
  });

  test("sends newly entered credentials with PUT", async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (input, init) => {
      request = new Request(requestUrl(input), init);
      return Response.json({ provider: "openai", linked: true, credentialsConfigured: true });
    }) as typeof fetch;

    await updateOrganizationProviderCredentials("org", "openai", { apiKey: "new-secret" });
    expect(request?.method).toBe("PUT");
    expect(request?.url).toEndWith("/api/founders/organizations/org/providers/openai/credentials");
    await expect(request?.json()).resolves.toEqual({ credentials: { apiKey: "new-secret" } });
  });
});
