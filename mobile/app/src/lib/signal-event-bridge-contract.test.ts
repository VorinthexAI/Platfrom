import { expect, test } from "bun:test";

const bridge = await Bun.file(new URL("./event-bridge.tsx", import.meta.url)).text();
const cache = await Bun.file(new URL("./workspace-query-cache.ts", import.meta.url)).text();
const appSearch = await Bun.file(new URL("./app-search-client.ts", import.meta.url)).text();

test("the authenticated unified stream converges Signal and Archive caches", () => {
  expect(bridge.match(/getEventStream\("\/events\/stream"/g)).toHaveLength(1);
  expect(bridge).not.toContain("EventSource");
  expect(bridge).toContain('event.event === "inbox.changed"');
  expect(bridge).toContain("signalQueryKeys.overviews(compassContext)");
  expect(cache).toContain("accountOverviews: (context: WorkspaceContext, connectorKey?: string)");
  expect(bridge).toContain("signalQueryKeys.details(compassContext)");
  expect(bridge).toContain("signalQueryKeys.overview(compassContext)");
  expect(bridge).toContain("signalQueryKeys.replyContexts(compassContext)");
  expect(bridge).toContain('publishAppEvent({ type: "inbox.changed" })');
  expect(bridge).toContain("contentQueryKeys.all(contentContext)");
  expect(bridge).toMatch(/if \(event\.event === "inbox\.changed"\) \{[\s\S]*?invalidateArchive\(\)[\s\S]*?\}/);
  expect(bridge).not.toContain('["archive", teamKey, scopeKey]');
});

test("content changes invalidate Signal metadata in the current workspace", () => {
  expect(bridge).toMatch(/if \(event\.event === "content\.changed"\) \{[\s\S]*?signalQueryKeys\.overview\(compassContext\)[\s\S]*?refetchType: "active"[\s\S]*?\}/);
  expect(bridge).toMatch(/if \(event\.event === "content\.changed"\) \{[\s\S]*?signalQueryKeys\.replyContexts\(compassContext\)[\s\S]*?refetchType: "active"[\s\S]*?\}/);
  expect(bridge).not.toMatch(/if \(event\.event === "content\.changed"\) \{[\s\S]*?publishAppEvent\(\{ type: "inbox\.changed" \}\)[\s\S]*?\}/);
});

test("successful recorded searches invalidate the singleton user history cache", () => {
  expect(appSearch).toContain("if (parsed.recordHistory) publishUserSearchHistoryAppend");
  expect(bridge).toContain("subscribeUserSearchHistoryAppends");
  expect(bridge).toContain("userSearchHistoryQueryKey(userKey)");
  expect(bridge).toContain('refetchType: "none"');
});

test("workspace events and reconnects refresh active canonical search retrievals", () => {
  expect(appSearch).toContain('appSearchQueryRoot = ["app-search"]');
  expect(bridge).toContain("queryKey: appSearchQueryRoot");
  expect(bridge.match(/invalidateAppSearch\(\)/g)?.length).toBeGreaterThanOrEqual(3);
  expect(bridge).toContain('refetchType: "active"');
});

test("referral rewards and no-replay recovery refresh the authenticated user's billing summary", () => {
  expect(bridge).toContain('import { billingSummaryQueryKey } from "./billing-client"');
  expect(bridge).toContain('queryKey: billingSummaryQueryKey(userKey), exact: true, refetchType: "active"');
  expect(bridge).toContain('if (event.event === "referral.reward.created") invalidateBilling()');
  expect(bridge.match(/invalidateBilling\(\)/g)?.length).toBe(3);
  expect(bridge).toMatch(/}, currentController\.signal, \(\) => \{[\s\S]*?invalidateBilling\(\)[\s\S]*?publishAppEvent\(\{ type: "event-stream\.connected" \}\)/);
  expect(bridge).toMatch(/if \(!wasActive\) \{[\s\S]*?invalidateBilling\(\)[\s\S]*?connect\(\)/);
});
