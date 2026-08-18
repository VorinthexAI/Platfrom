import { expect, test } from "bun:test";

const bridge = await Bun.file(new URL("./event-bridge.tsx", import.meta.url)).text();
const workspace = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();
const shareRoute = await Bun.file(new URL("../app/share/[token].tsx", import.meta.url)).text();
const layout = await Bun.file(new URL("../app/_layout.tsx", import.meta.url)).text();
const auth = await Bun.file(new URL("../app/auth.tsx", import.meta.url)).text();
const onboarding = await Bun.file(new URL("../app/onboarding.tsx", import.meta.url)).text();
const appConfig = await Bun.file(new URL("../../app.json", import.meta.url)).text();

test("uses one SSE bridge while notifying the visible Gallery workspace", () => {
  expect(bridge.match(/getEventStream\(/g)).toHaveLength(1);
  expect(bridge).toContain('publishAppEvent({ type: "gallery.changed", slug })');
  expect(bridge).toContain('publishAppEvent({ type: "event-stream.connected" })');
  expect(bridge).toContain("const generation = ++streamGeneration.current");
  expect(bridge).toContain("if (!isCurrent()) return");
  expect(workspace).toContain("subscribeAppEvent((event)");
  expect(workspace).toContain("queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext)");
  expect(workspace).toContain("const plan = galleryRefreshPlan");
  expect(workspace).toContain("scheduleGalleryRefresh(plan)");
  expect(workspace).toContain("resetAfterCollectionAccessLoss(fetchedRoot)");
});

test("preserves and activates authenticated share links", () => {
  expect(shareRoute).toContain("activateGalleryShare(token)");
  expect(shareRoute).toContain("activation.scopeKey !== context.scopeKey");
  expect(shareRoute).toContain("galleryQueryKeys.overview(context)");
  expect(shareRoute).toContain('slug: "gallery"');
  expect(layout).toContain("savePendingReturnRoute(pathname)");
  expect(layout).toContain(".finally(() => router.replace");
  expect(layout).toContain('params: { returnTo: pathname }');
  expect(auth).toContain("savePendingReturnRoute(returnTo)");
  expect(onboarding).toContain("readPendingReturnRoute()");
  expect(appConfig).toContain('"pathPrefix": "/share/"');
});
