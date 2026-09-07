export const SPARK_PRICING_CURRENCY = "USD" as const;
export const NEWCOMER_FREE_SPARKS = 100;

export const SPARK_SUBSCRIPTIONS = [
  {
    name: "Monthly",
    price: 19.99,
    referencePrice: 24.99,
    sparks: 1_000,
    cadence: "month",
    badge: "Best Value",
  },
  {
    name: "Weekly",
    price: 7.99,
    sparks: 200,
    cadence: "week",
  },
] as const;

export const SPARK_TOP_UP = { sparks: 200, price: 9.99 } as const;

export const REFERRAL_REWARDS = {
  signup: 50,
  firstSubscriptionPurchase: 100,
  recipient: "referrer",
  frequency: "one-time per referred user at each stage",
} as const;

export function formatSparkCount(sparks: number) {
  return new Intl.NumberFormat("en-US").format(sparks);
}

export function formatUsd(price: number) {
  return `$${price.toFixed(2)} ${SPARK_PRICING_CURRENCY}`;
}
