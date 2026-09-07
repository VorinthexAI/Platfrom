import { beforeEach, expect, mock, test } from "bun:test";

const calls: unknown[][] = [];
let response: unknown;

mock.module("./api-client", () => ({ apiClient: {
  get: async (...args: unknown[]) => { calls.push(args); return { data: response }; },
  post: async (...args: unknown[]) => { calls.push(args); return { data: response }; },
} }));

const { billingSummaryQueryKey, billingSummarySchema, currentSubscriptionQueryKey, fetchBillingSummary, fetchCurrentSubscription, formatWholeSparks, setSubscriptionCancellation, sparkTransactionSchema, subscriptionSchema, wholeSparks } = await import("./billing-client");

beforeEach(() => {
  calls.splice(0);
  response = { success: true, data: { microSparkBalance: 343_999_999, microSparkDebt: 0, spendingBlocked: false, transactions: [] } };
});

test("fetches the strict one-item billing summary", async () => {
  expect(await fetchBillingSummary()).toEqual({ microSparkBalance: 343_999_999, microSparkDebt: 0, spendingBlocked: false, transactions: [] });
  expect(calls).toEqual([["/billing/summary", { params: { limit: 1 } }]]);
});

test("accepts the previous billing summary shape and additive response fields", async () => {
  response = { success: true, requestId: "future", data: { microSparkBalance: 100_000_000, transactions: [], futureField: true } };
  expect(await fetchBillingSummary()).toEqual({ microSparkBalance: 100_000_000, microSparkDebt: 0, spendingBlocked: false, transactions: [] });
});

test("rejects negative, fractional, unsafe, and malformed balances", () => {
  for (const microSparkBalance of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, "1000000", null]) {
    expect(() => billingSummarySchema.parse({ microSparkBalance, microSparkDebt: 0, spendingBlocked: false, transactions: [] })).toThrow();
  }
  expect(billingSummarySchema.parse({ microSparkBalance: 0, microSparkDebt: 0, spendingBlocked: false, transactions: [], extra: true })).toEqual({ microSparkBalance: 0, microSparkDebt: 0, spendingBlocked: false, transactions: [] });
  expect(() => billingSummarySchema.parse({ microSparkBalance: 0 })).toThrow();
  expect(() => billingSummarySchema.parse({ microSparkBalance: 0, microSparkDebt: 0, spendingBlocked: false, transactions: [{ key: "partial" }] })).toThrow();
  expect(() => billingSummarySchema.parse({ microSparkBalance: 0, microSparkDebt: 1, spendingBlocked: false, transactions: [] })).toThrow();
});

test("matches backend transaction bounds and strict recurring-kind contract", () => {
  const transaction = {
    key: "transaction", userKey: "user", kind: "action", deltaMicroSparks: -1,
    idempotencyKey: "request", requestHash: "request_hash_1234", actionSlug: "generate",
    metadata: { source: "inbox" }, balanceAfterMicroSparks: 0, createdAt: "2026-09-04T12:00:00.000Z",
  };
  expect(sparkTransactionSchema.parse(transaction)).toEqual(transaction);
  expect(() => sparkTransactionSchema.parse({ ...transaction, key: "x".repeat(201) })).toThrow();
  expect(() => sparkTransactionSchema.parse({ ...transaction, requestHash: "short" })).toThrow();
  expect(() => sparkTransactionSchema.parse({ ...transaction, toolSlug: "not-dotted" })).toThrow();
  expect(() => sparkTransactionSchema.parse({ ...transaction, actionSlug: "Bad Action" })).toThrow();
  expect(() => sparkTransactionSchema.parse({ ...transaction, metadata: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`key-${index}`, true])) })).toThrow();
  expect(sparkTransactionSchema.parse({ ...transaction, kind: "recurring-service" }).kind).toBe("recurring-service");
  expect(sparkTransactionSchema.parse({ ...transaction, kind: "referral-reward" }).kind).toBe("referral-reward");
  expect(sparkTransactionSchema.parse({ ...transaction, kind: "purchase" }).kind).toBe("purchase");
  expect(() => sparkTransactionSchema.parse({ ...transaction, kind: "unknown" })).toThrow();
});

test("rejects malformed and unsuccessful response envelopes", async () => {
  for (const malformed of [
    { success: false, error: { code: "FAILED" } },
    { success: true, data: { microSparkBalance: -1, microSparkDebt: 0, spendingBlocked: false, transactions: [] } },
    { success: true, data: null },
  ]) {
    response = malformed;
    await expect(fetchBillingSummary()).rejects.toBeDefined();
  }
});

test("floors micro-Sparks before rendering and ignores fractional Spark changes", () => {
  expect(wholeSparks(0)).toBe(0);
  expect(wholeSparks(999_999)).toBe(0);
  expect(wholeSparks(1_000_000)).toBe(1);
  expect(wholeSparks(1_999_999)).toBe(1);
  expect(wholeSparks(2_000_000)).toBe(2);
});

test("truncates whole Spark boundaries without upward rounding or suffix promotion", () => {
  expect(formatWholeSparks(343)).toBe("343");
  expect(formatWholeSparks(1_330)).toBe("1.33k");
  expect(formatWholeSparks(1_999)).toBe("1.99k");
  expect(formatWholeSparks(24_500)).toBe("24.5k");
  expect(formatWholeSparks(999_499)).toBe("999k");
  expect(formatWholeSparks(999_999)).toBe("999k");
  expect(formatWholeSparks(1_250_000)).toBe("1.25m");
  expect(formatWholeSparks(999_999_999)).toBe("999m");
  expect(formatWholeSparks(-10)).toBe("0");
  expect(formatWholeSparks(343.9)).toBe("343");
});

test("isolates billing query keys by authenticated user", () => {
  expect(billingSummaryQueryKey("user-a")).toEqual(["billing-summary", "user-a"]);
  expect(billingSummaryQueryKey("user-a")).not.toEqual(billingSummaryQueryKey("user-b"));
  expect(currentSubscriptionQueryKey("user-a")).toEqual(["billing-subscription", "user-a"]);
});

test("strictly fetches current subscription and only confirms server mutations", async () => {
  const subscription = {
    key: "c000000000000000000000001", userKey: "c000000000000000000000002", productKey: "c000000000000000000000003",
    status: "active", cancelAtPeriodEnd: false, currentPeriodStart: "2026-09-01T12:00:00.000Z", currentPeriodEnd: "2026-10-01T12:00:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z",
  };
  expect(subscriptionSchema.parse(subscription)).toEqual(subscription);
  for (const status of ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]) {
    expect(subscriptionSchema.parse({ ...subscription, status }).status).toBe(status);
  }
  expect(() => subscriptionSchema.parse({ ...subscription, status: "revoked" })).toThrow();
  response = { success: true, data: subscription };
  expect(await fetchCurrentSubscription()).toEqual(subscription);
  expect(calls.at(-1)).toEqual(["/subscriptions/current"]);
  expect(await setSubscriptionCancellation(true)).toEqual(subscription);
  expect(calls.at(-1)).toEqual(["/subscriptions/current/cancel", {}]);
  expect(await setSubscriptionCancellation(false)).toEqual(subscription);
  expect(calls.at(-1)).toEqual(["/subscriptions/current/restore", {}]);
  response = { success: true, data: null };
  await expect(setSubscriptionCancellation(false)).rejects.toThrow("returned no subscription");
  expect(() => subscriptionSchema.parse({ ...subscription, providerSubscriptionId: "secret" })).toThrow();
});
