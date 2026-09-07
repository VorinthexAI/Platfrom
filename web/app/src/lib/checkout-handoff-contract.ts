const HANDOFF_TOKEN_PATTERN = /^vch_[A-Za-z0-9_-]{43}$/;

const POLAR_CHECKOUT_HOSTS = new Set([
  "polar.sh",
  "www.polar.sh",
  "checkout.polar.sh",
  "sandbox.polar.sh",
]);

export type CheckoutProduct = {
  name: string;
  type: "subscription" | "one_time";
  priceCents: number;
  referencePriceCents: number | null;
  currency: "USD";
  billingPeriod: "week" | "month" | null;
  sparks: number;
};

export type CheckoutResolution = {
  product: CheckoutProduct;
  expiresAt: string;
};

export function isCheckoutHandoffToken(value: unknown): value is string {
  return typeof value === "string" && HANDOFF_TOKEN_PATTERN.test(value);
}

export function isAllowedPolarCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      POLAR_CHECKOUT_HOSTS.has(url.hostname) && url.port === "";
  } catch {
    return false;
  }
}
