import { expect, test } from "bun:test";

const bridge = await Bun.file(new URL("./event-bridge.tsx", import.meta.url)).text();
const cache = await Bun.file(new URL("./workspace-query-cache.ts", import.meta.url)).text();

test("the authenticated unified stream converges Signal and Archive caches", () => {
  expect(bridge.match(/getEventStream\("\/events\/stream"/g)).toHaveLength(1);
  expect(bridge).not.toContain("EventSource");
  expect(bridge).toContain('event.event === "inbox.changed"');
  expect(bridge).toContain("signalQueryKeys.overviews(compassContext)");
  expect(cache).toContain("accountOverviews: (context: WorkspaceContext, connectorKey?: string)");
  expect(bridge).toContain("signalQueryKeys.details(compassContext)");
  expect(bridge).toContain("signalQueryKeys.tones(compassContext)");
  expect(bridge).toContain('publishAppEvent({ type: "inbox.changed" })');
  expect(bridge).toContain("contentQueryKeys.all(contentContext)");
  expect(bridge).not.toContain('["archive", organizationKey, scopeKey]');
});

test("content changes invalidate Signal tones in the current workspace", () => {
  expect(bridge).toMatch(/if \(event\.event === "content\.changed"\) \{[\s\S]*?signalQueryKeys\.tones\(compassContext\)[\s\S]*?refetchType: "active"[\s\S]*?\}/);
});
