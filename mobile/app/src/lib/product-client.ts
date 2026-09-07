import { z } from "zod";

import { appsBootstrapHeaders } from "./apps-registry";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://vorinthex.com";

export const productIdSchema = z.enum([
  "nova.weekly",
  "nova.monthly",
  "nova.monthly.discounted",
  "topup.small",
]);

export const productSchema = z.strictObject({
  key: z.string().cuid(),
  productId: productIdSchema,
  priceCents: z.number().int().safe().positive(),
  discountedPriceCents: z.number().int().safe().positive().nullable(),
  active: z.boolean(),
  type: z.enum(["subscription", "one_time"]),
  billingPeriod: z.enum(["week", "month"]).nullable(),
  currency: z.literal("USD"),
  sparkGrantMicroSparks: z.number().int().safe().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).superRefine((product, context) => {
  const topup = product.productId === "topup.small";
  if (topup !== (product.type === "one_time")) context.addIssue({ code: "custom", message: "Product type does not match its identifier." });
  if (topup !== (product.billingPeriod === null)) context.addIssue({ code: "custom", message: "Billing period does not match product type." });
  if (product.discountedPriceCents !== null && product.discountedPriceCents >= product.priceCents) context.addIssue({ code: "custom", message: "Discounted price must be lower than the reference price." });
});

export const productsResponseSchema = z.strictObject({
  success: z.literal(true),
  data: z.array(productSchema).max(20),
}).superRefine(({ data: products }, context) => {
  const identifiers = new Set<string>();
  const keys = new Set<string>();
  for (const product of products) {
    if (identifiers.has(product.productId)) context.addIssue({ code: "custom", message: `Duplicate product identifier: ${product.productId}`, path: ["products"] });
    if (keys.has(product.key)) context.addIssue({ code: "custom", message: `Duplicate product key: ${product.key}`, path: ["products"] });
    identifiers.add(product.productId);
    keys.add(product.key);
  }
});

const healthResponseSchema = z.strictObject({ ok: z.literal(true) });

export type MobileProduct = z.infer<typeof productSchema>;

export async function fetchPublic(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/v1/${path}`, {
      headers: appsBootstrapHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Public ${path} request failed with status ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function parseProducts(input: unknown): MobileProduct[] {
  return productsResponseSchema.parse(input).data;
}

export async function fetchProducts(): Promise<MobileProduct[]> {
  return parseProducts(await fetchPublic("products"));
}

export async function fetchPublicBootstrap(): Promise<MobileProduct[]> {
  const [health, products] = await Promise.all([fetchPublic("health"), fetchProducts()]);
  healthResponseSchema.parse(health);
  return products;
}

export function effectivePriceCents(product: MobileProduct) {
  return product.discountedPriceCents ?? product.priceCents;
}

export function formatProductPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function activeSubscriptionOffers(products: readonly MobileProduct[]) {
  return products
    .filter((product) => product.active && product.type === "subscription" && product.productId !== "nova.monthly")
    .sort((left, right) => Number(right.productId === "nova.monthly.discounted") - Number(left.productId === "nova.monthly.discounted"));
}

export function activeTopup(products: readonly MobileProduct[]) {
  return products.find((product) => product.active && product.productId === "topup.small");
}

export function productSparkAmount(product: MobileProduct) {
  return Math.floor(product.sparkGrantMicroSparks / 1_000_000);
}
