export const SPARK_PRICING_CURRENCY = "USD" as const;
export const NEWCOMER_FREE_SPARKS = 100;

export const SPARK_MONTHLY_PLANS = [
  { name: "Moon", price: 19.99, sparks: 1_000 },
  { name: "Comet", price: 39.99, sparks: 5_000 },
  { name: "Nova", price: 99.99, sparks: 25_000 },
] as const;

export const SPARK_TOP_UPS = [
  { sparks: 500, price: 14.99 },
  { sparks: 2_500, price: 49.99 },
  { sparks: 10_000, price: 149.99 },
  { sparks: 50_000, price: 599.99 },
] as const;

export const SPARK_ON_DEMAND = {
  name: "On-Demand",
  description: "Overflow Sparks added after the included balance runs out",
  requiresPlan: "Nova",
} as const;

export function formatSparkCount(sparks: number) {
  return new Intl.NumberFormat("en-US").format(sparks);
}

export function formatUsd(price: number) {
  return `$${price.toFixed(2)} ${SPARK_PRICING_CURRENCY}`;
}
