import { beforeEach, describe, expect, test } from "bun:test";

import { CANONICAL_APP_SLUGS, parseAppsRegistry } from "./apps-registry";
import { selectedAppKeyHeaders } from "./app-request-headers";
import { useAppsStore } from "@/state/apps";

const timestamp = "2026-09-03T12:00:00.000Z";

function app(slug: string, index: number) {
  return {
    key: `ck${String(index).padStart(23, "0")}`,
    slug,
    name: `${slug} name`,
    description: `${slug} description`,
    detailedDescription: `${slug} detailed description`,
    logoUrl: `https://vorinthex.com/logos/${slug}.png`,
    version: "1.0.0",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function response(extra: ReturnType<typeof app>[] = []) {
  return { apps: [...CANONICAL_APP_SLUGS.map(app), ...extra] };
}

const products = { success: true, data: [{ key: "c000000000000000000000001", productId: "nova.weekly", priceCents: 799, discountedPriceCents: null, active: true, type: "subscription", billingPeriod: "week", currency: "USD", sparkGrantMicroSparks: 200_000_000, createdAt: timestamp, updatedAt: timestamp }] };
const costs = { success: true, data: { capabilityCosts: { "profile.badge.generate": { sparkCost: "10", microSparkCost: 10_000_000, unit: "invocation" } }, charges: [{ key: "ai-usage", kind: "variable", name: "AI usage", description: "Varies by usage." }] } };

function mockResponse(body: unknown) {
  globalThis.fetch = (async (input) => {
    const path = String(input).split("/").at(-1);
    const payload = path === "health" ? { ok: true } : path === "products" ? products : path === "costs" ? costs : body;
    return { ok: true, status: 200, json: async () => payload };
  }) as typeof fetch;
}

describe("apps registry parsing", () => {
  test("strictly parses all canonical apps while retaining unknown server apps", () => {
    const parsed = parseAppsRegistry(response([app("future-app", 8)]));
    expect(parsed).toHaveLength(8);
    expect(parsed.at(-1)?.slug).toBe("future-app");
    expect(() => parseAppsRegistry({ ...response(), unexpected: true })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, unexpected: true }) })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, key: "not-a-cuid" }) })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, updatedAt: "yesterday" }) })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, logoUrl: "not-a-url" }) })).toThrow();
    expect(() => parseAppsRegistry({ apps: response().apps.map((entry, index) => index ? entry : { ...entry, logoUrl: undefined }) })).toThrow();
  });

  test("rejects duplicate keys, duplicate slugs, and missing canonical rows", () => {
    const rows = response().apps;
    expect(() => parseAppsRegistry({ apps: [...rows, { ...app("future-app", 8), key: rows[0]!.key }] })).toThrow(/Duplicate app key/);
    expect(() => parseAppsRegistry({ apps: [...rows, { ...app("archive", 8) }] })).toThrow(/Duplicate app slug/);
    expect(() => parseAppsRegistry({ apps: rows.filter(({ slug }) => slug !== "core") })).toThrow(/Missing canonical app: core/);
  });
});

describe("apps registry state", () => {
  beforeEach(() => {
    useAppsStore.setState({
      apps: [],
      products: [],
      sparkCosts: [],
      capabilityCosts: {},
      sparkCostsStatus: "idle",
      sparkCostsError: null,
      productsStatus: "idle",
      productsError: null,
      bootstrapStatus: "idle",
      bootstrapError: null,
      selectedApp: null,
      currentAppKey: null,
      workspaceSelection: null,
    });
  });

  test("tracks bootstrap progress and initially selects Core", async () => {
    const releases = new Map<string, (value: { ok: true; status: number; json: () => Promise<unknown> }) => void>();
    globalThis.fetch = ((input) => new Promise((resolve) => { releases.set(String(input).split("/").at(-1)!, resolve); })) as typeof fetch;
    const bootstrapping = useAppsStore.getState().bootstrap();
    expect(useAppsStore.getState().bootstrapStatus).toBe("bootstrapping");
    expect([...releases.keys()]).toEqual(["health", "products", "costs", "apps"]);
    releases.get("apps")!({ ok: true, status: 200, json: async () => response([app("future-app", 8)]) });
    releases.get("health")!({ ok: true, status: 200, json: async () => ({ ok: true }) });
    releases.get("products")!({ ok: true, status: 200, json: async () => products });
    releases.get("costs")!({ ok: true, status: 200, json: async () => costs });
    await bootstrapping;
    await useAppsStore.getState().refreshProducts();
    expect(useAppsStore.getState()).toMatchObject({
      bootstrapStatus: "ready",
      currentAppKey: app("core", 6).key,
      selectedApp: { slug: "core" },
    });
    expect(useAppsStore.getState().apps.some(({ slug }) => slug === "future-app")).toBe(true);
    expect(useAppsStore.getState().products).toHaveLength(1);
    expect(useAppsStore.getState().sparkCosts).toHaveLength(1);
  });

  test("fails bootstrap on an invalid registry and can retry", async () => {
    mockResponse({ apps: response().apps.filter(({ slug }) => slug !== "signal") });
    await useAppsStore.getState().bootstrap();
    expect(useAppsStore.getState()).toMatchObject({ bootstrapStatus: "failed", currentAppKey: null });
    mockResponse(response());
    await useAppsStore.getState().bootstrap();
    expect(useAppsStore.getState().bootstrapStatus).toBe("ready");
  });

  test("keeps the registry ready when the product catalog is invalid and retries products independently", async () => {
    globalThis.fetch = (async (input) => {
      const path = String(input).split("/").at(-1);
      const payload = path === "apps" ? response() : path === "health" ? { ok: true } : path === "costs" ? costs : { success: true, data: [{ ...products.data[0], productId: "forged.product" }] };
      return { ok: true, status: 200, json: async () => payload };
    }) as typeof fetch;
    await useAppsStore.getState().bootstrap();
    await useAppsStore.getState().refreshProducts();
    expect(useAppsStore.getState()).toMatchObject({ bootstrapStatus: "ready", productsStatus: "unavailable", products: [], currentAppKey: app("core", 6).key });
    mockResponse(response());
    await useAppsStore.getState().refreshProducts();
    expect(useAppsStore.getState()).toMatchObject({ bootstrapStatus: "ready", productsStatus: "ready", products: [{ productId: "nova.weekly" }] });
  });

  test("does not wait for commerce bootstrap before making the app registry ready", async () => {
    const releases = new Map<string, (value: { ok: true; status: number; json: () => Promise<unknown> }) => void>();
    globalThis.fetch = ((input) => {
      const path = String(input).split("/").at(-1);
      if (path === "apps") return Promise.resolve({ ok: true, status: 200, json: async () => response() });
      return new Promise((resolve) => releases.set(path!, resolve));
    }) as typeof fetch;

    await useAppsStore.getState().bootstrap();
    expect(useAppsStore.getState()).toMatchObject({ bootstrapStatus: "ready", productsStatus: "loading", currentAppKey: app("core", 6).key });
    releases.get("health")!({ ok: true, status: 200, json: async () => ({ ok: true }) });
    releases.get("products")!({ ok: true, status: 200, json: async () => products });
    releases.get("costs")!({ ok: true, status: 200, json: async () => costs });
    await useAppsStore.getState().refreshProducts();
  });

  test("synchronously selects workspaces and restores them after Core", async () => {
    mockResponse(response());
    await useAppsStore.getState().bootstrap();
    useAppsStore.getState().leaveCore();
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "core" }, workspaceSelection: null });
    useAppsStore.getState().enterWorkspace("gallery");
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "gallery" }, currentAppKey: app("gallery", 2).key, workspaceSelection: "gallery" });
    useAppsStore.getState().enterCore();
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "core" }, currentAppKey: app("core", 6).key, workspaceSelection: "gallery" });
    useAppsStore.getState().leaveCore();
    expect(useAppsStore.getState()).toMatchObject({ selectedApp: { slug: "gallery" }, currentAppKey: app("gallery", 2).key, workspaceSelection: "gallery" });
  });

  test("exposes only the exact selected app key header for transports", async () => {
    expect(() => selectedAppKeyHeaders()).toThrow("No app is selected");
    mockResponse(response());
    await useAppsStore.getState().bootstrap();
    expect(selectedAppKeyHeaders()).toEqual({ "X-Vorinthex-App-Key": app("core", 6).key });
    expect(selectedAppKeyHeaders()).not.toHaveProperty("X-Vorinthex-Domain");
  });
});
