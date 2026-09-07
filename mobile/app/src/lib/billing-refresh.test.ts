import { expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

mock.module("./api-client", () => ({ apiClient: {} }));

const { billingSummaryQueryKey, currentSubscriptionQueryKey } = await import("./billing-client");
const { refreshAuthoritativeBilling } = await import("./billing-refresh");

test("refreshes both authoritative billing queries and requires successful state", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const userKey = "user-a";
  let billingFetches = 0;
  let subscriptionFetches = 0;
  await Promise.all([
    client.fetchQuery({ queryKey: billingSummaryQueryKey(userKey), queryFn: async () => { billingFetches += 1; return { microSparkBalance: 1, microSparkDebt: 0, spendingBlocked: false, transactions: [] }; } }),
    client.fetchQuery({ queryKey: currentSubscriptionQueryKey(userKey), queryFn: async () => { subscriptionFetches += 1; return null; } }),
  ]);

  await refreshAuthoritativeBilling(client, userKey);
  expect(billingFetches).toBe(2);
  expect(subscriptionFetches).toBe(2);
});

test("rejects when either authoritative billing query fails", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const userKey = "user-b";
  await Promise.all([
    client.fetchQuery({ queryKey: billingSummaryQueryKey(userKey), queryFn: async () => ({ microSparkBalance: 1, microSparkDebt: 0, spendingBlocked: false, transactions: [] }) }),
    client.fetchQuery({ queryKey: currentSubscriptionQueryKey(userKey), queryFn: async () => null }),
  ]);
  client.setQueryDefaults(currentSubscriptionQueryKey(userKey), { queryFn: async () => { throw new Error("offline"); }, retry: false });
  client.removeQueries({ queryKey: currentSubscriptionQueryKey(userKey), exact: true });

  await expect(refreshAuthoritativeBilling(client, userKey)).rejects.toThrow("Authoritative billing status");
});
