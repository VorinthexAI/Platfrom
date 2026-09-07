import { z } from "zod";

import { apiClient } from "./api-client";

const boundedKeySchema = z.string().trim().min(1).max(200);
const dottedSlugSchema = z.string().max(200).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/);
const actionSlugSchema = z.string().max(200).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/);
const metadataValueSchema = z.union([z.string().max(500), z.boolean(), z.number().int().safe(), z.null()]);
const metadataSchema = z.record(z.string().min(1).max(64), metadataValueSchema).refine((value) => Object.keys(value).length <= 20);
export const sparkTransactionSchema = z.strictObject({
  key: boundedKeySchema,
  userKey: boundedKeySchema,
  kind: z.enum(["account-grant", "referral-reward", "purchase", "tool", "action", "storage", "recurring-service", "refund", "adjustment", "expiration"]),
  deltaMicroSparks: z.number().int().safe().refine((value) => value !== 0),
  idempotencyKey: boundedKeySchema,
  requestHash: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  eventKey: boundedKeySchema.optional(),
  toolSlug: dottedSlugSchema.optional(),
  actionSlug: actionSlugSchema.optional(),
  metadata: metadataSchema.optional(),
  balanceAfterMicroSparks: z.number().int().safe(),
  createdAt: z.string().datetime({ offset: true }),
});

export const billingSummarySchema = z.object({
  microSparkBalance: z.number().int().safe().nonnegative(),
  microSparkDebt: z.number().int().safe().nonnegative().default(0),
  spendingBlocked: z.boolean().default(false),
  transactions: z.array(sparkTransactionSchema).max(1),
}).refine((summary) => summary.spendingBlocked === (summary.microSparkDebt > 0), {
  message: "Spending block must match the outstanding Spark debt.",
  path: ["spendingBlocked"],
});

const billingSummaryEnvelopeSchema = z.object({
  success: z.literal(true),
  data: billingSummarySchema,
});

export type BillingSummary = z.infer<typeof billingSummarySchema>;

export const subscriptionSchema = z.strictObject({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  productKey: z.string().cuid(),
  status: z.enum(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodStart: z.string().datetime({ offset: true }).nullable(),
  currentPeriodEnd: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

const subscriptionEnvelopeSchema = z.strictObject({ success: z.literal(true), data: subscriptionSchema.nullable() });
export type CurrentSubscription = z.infer<typeof subscriptionSchema>;

export const billingSummaryQueryKey = (userKey: string) => ["billing-summary", userKey] as const;
export const currentSubscriptionQueryKey = (userKey: string) => ["billing-subscription", userKey] as const;

export async function fetchBillingSummary(): Promise<BillingSummary> {
  const response = await apiClient.get("/billing/summary", { params: { limit: 1 } });
  return billingSummaryEnvelopeSchema.parse(response.data).data;
}

export async function fetchCurrentSubscription(): Promise<CurrentSubscription | null> {
  const response = await apiClient.get("/subscriptions/current");
  return subscriptionEnvelopeSchema.parse(response.data).data;
}

export async function setSubscriptionCancellation(cancelAtPeriodEnd: boolean): Promise<CurrentSubscription> {
  const action = cancelAtPeriodEnd ? "cancel" : "restore";
  const response = await apiClient.post(`/subscriptions/current/${action}`, {});
  const subscription = subscriptionEnvelopeSchema.parse(response.data).data;
  if (!subscription) throw new Error("Subscription update returned no subscription.");
  return subscription;
}

export function wholeSparks(microSparkBalance: number) {
  return Math.floor(microSparkBalance / 1_000_000);
}

export function formatWholeSparks(value: number) {
  const whole = Math.max(0, Math.floor(value));
  if (whole < 1_000) return String(whole);
  const units = [[1_000_000_000, "b"], [1_000_000, "m"], [1_000, "k"]] as const;
  for (const [divisor, suffix] of units) {
    if (whole < divisor) continue;
    const scaled = whole / divisor;
    const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
    const factor = 10 ** decimals;
    const formatted = (Math.floor(scaled * factor) / factor).toFixed(decimals).replace(/\.0+$|(?<=\.[0-9])0$/, "");
    return `${formatted}${suffix}`;
  }
  return String(whole);
}
