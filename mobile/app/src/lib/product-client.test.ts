import { afterEach, expect, test } from "bun:test";

import { activeSubscriptionOffers, activeTopup, effectivePriceCents, fetchPublicBootstrap, parseProducts } from "./product-client";

const product = (productId: "nova.weekly" | "nova.monthly" | "nova.monthly.discounted" | "topup.small", index: number) => ({
  key: `c${String(index).padStart(24, "0")}`,
  productId,
  priceCents: productId === "nova.weekly" ? 799 : productId === "topup.small" ? 999 : 2499,
  discountedPriceCents: productId === "nova.monthly.discounted" ? 1999 : null,
  active: productId !== "nova.monthly",
  type: productId === "topup.small" ? "one_time" as const : "subscription" as const,
  billingPeriod: productId === "topup.small" ? null : productId === "nova.weekly" ? "week" as const : "month" as const,
  currency: "USD",
  sparkGrantMicroSparks: productId === "nova.weekly" || productId === "topup.small" ? 200_000_000 : 1_000_000_000,
  createdAt: "2026-09-05T12:00:00.000Z",
  updatedAt: "2026-09-05T12:00:00.000Z",
});

const catalog = { success: true as const, data: [product("nova.weekly", 1), product("nova.monthly", 2), product("nova.monthly.discounted", 3), product("topup.small", 4)] };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("strictly parses the complete public product contract", () => {
  expect(parseProducts(catalog)).toEqual(catalog.data);
  expect(() => parseProducts({ ...catalog, extra: true })).toThrow();
  expect(() => parseProducts({ success: true, data: [{ ...catalog.data[0], productId: "nova.yearly" }] })).toThrow();
  expect(() => parseProducts({ success: true, data: [{ ...catalog.data[0], key: "not-a-cuid" }] })).toThrow();
  expect(() => parseProducts({ success: true, data: [{ ...catalog.data[0], priceCents: 7.99 }] })).toThrow();
  expect(() => parseProducts({ success: true, data: [{ ...catalog.data[0], discountedPriceCents: undefined }] })).toThrow();
  expect(() => parseProducts({ success: true, data: [{ ...catalog.data[0], unexpected: true }] })).toThrow();
});

test("filters inactive legacy monthly pricing and prioritizes Best Value", () => {
  const parsed = parseProducts(catalog);
  expect(activeSubscriptionOffers(parsed).map(({ productId }) => productId)).toEqual(["nova.monthly.discounted", "nova.weekly"]);
  expect(effectivePriceCents(activeSubscriptionOffers(parsed)[0]!)).toBe(1999);
  expect(activeTopup(parsed)).toMatchObject({ productId: "topup.small", priceCents: 999, sparkGrantMicroSparks: 200_000_000 });
});

test("starts health and products together and rejects either invalid response", async () => {
  const started: string[] = [];
  const releases = new Map<string, (value: Response) => void>();
  globalThis.fetch = ((input) => {
    const path = String(input).split("/").at(-1)!;
    started.push(path);
    return new Promise<Response>((resolve) => releases.set(path, resolve));
  }) as typeof fetch;
  const request = fetchPublicBootstrap();
  await Promise.resolve();
  expect(started).toEqual(["health", "products"]);
  releases.get("health")!(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  releases.get("products")!(new Response(JSON.stringify(catalog), { status: 200 }));
  await expect(request).resolves.toEqual(catalog.data);

  globalThis.fetch = (async (input) => new Response(JSON.stringify(String(input).endsWith("health") ? { ok: true, extra: true } : catalog), { status: 200 })) as typeof fetch;
  await expect(fetchPublicBootstrap()).rejects.toBeDefined();
});
