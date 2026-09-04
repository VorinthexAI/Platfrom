import { beforeEach, expect, mock, test } from "bun:test";

const calls: unknown[][] = [];
let response: unknown;

mock.module("./api-client", () => ({ apiClient: {
  get: async (...args: unknown[]) => { calls.push(args); return { data: response }; },
} }));

const { billingSummaryQueryKey, billingSummarySchema, fetchBillingSummary, formatWholeSparks, sparkTransactionSchema, wholeSparks } = await import("./billing-client");

beforeEach(() => {
  calls.splice(0);
  response = { success: true, data: { microSparkBalance: 343_999_999, transactions: [] } };
});

test("fetches the strict one-item billing summary", async () => {
  expect(await fetchBillingSummary()).toEqual({ microSparkBalance: 343_999_999, transactions: [] });
  expect(calls).toEqual([["/billing/summary", { params: { limit: 1 } }]]);
});

test("rejects negative, fractional, unsafe, and malformed balances", () => {
  for (const microSparkBalance of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, "1000000", null]) {
    expect(() => billingSummarySchema.parse({ microSparkBalance, transactions: [] })).toThrow();
  }
  expect(() => billingSummarySchema.parse({ microSparkBalance: 0, transactions: [], extra: true })).toThrow();
  expect(() => billingSummarySchema.parse({ microSparkBalance: 0 })).toThrow();
  expect(() => billingSummarySchema.parse({ microSparkBalance: 0, transactions: [{ key: "partial" }] })).toThrow();
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
  expect(() => sparkTransactionSchema.parse({ ...transaction, kind: "unknown" })).toThrow();
});

test("rejects malformed and unsuccessful response envelopes", async () => {
  for (const malformed of [
    { success: false, error: { code: "FAILED" } },
    { success: true, data: { microSparkBalance: -1, transactions: [] } },
    { success: true, data: { microSparkBalance: 0, transactions: [] }, extra: true },
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
});
