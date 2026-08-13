import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { ContentContext } from "./content-client";
import { contentQueryKeys } from "./content-query-cache";
import {
  ascendQueryKeys,
  compassQueryKeys,
  galleryQueryKeys,
  invalidateAssistantChanges,
  signalQueryKeys,
} from "./workspace-query-cache";

const context: ContentContext = { organizationKey: "org-a", scopeKey: "scope-a", agentKey: "agent-a" };
const otherContext: ContentContext = { organizationKey: "org-b", scopeKey: "scope-b", agentKey: "agent-b" };

test("isolates every routed workspace key by context and resource", () => {
  expect(galleryQueryKeys.overview(context, "collection")).not.toEqual(galleryQueryKeys.overview(otherContext, "collection"));
  expect(compassQueryKeys.overview(context)).not.toEqual(compassQueryKeys.overview(otherContext));
  expect(signalQueryKeys.overview(context, "all")).not.toEqual(signalQueryKeys.overview(context, "favorite"));
  expect(signalQueryKeys.detail(context, "thread-a")).not.toEqual(signalQueryKeys.detail(context, "thread-b"));
  expect(ascendQueryKeys.detail(context, "book-a")).not.toEqual(ascendQueryKeys.detail(otherContext, "book-a"));
});

test("assistant changes invalidate exact workspace prefixes without crossing contexts", async () => {
  const client = new QueryClient();
  const galleryOverview = galleryQueryKeys.overview(context);
  const galleryDetail = galleryQueryKeys.overview(context, "collection");
  const otherGallery = galleryQueryKeys.overview(otherContext);
  const signalOverview = signalQueryKeys.overview(context);
  const archiveLocation = contentQueryKeys.location(context);
  for (const key of [galleryOverview, galleryDetail, otherGallery, signalOverview, archiveLocation]) client.setQueryData(key, {});

  await invalidateAssistantChanges(client, context, [{ workspace: "gallery" }, { workspace: "gallery" }, { workspace: "archive" }]);

  expect(client.getQueryState(galleryOverview)?.isInvalidated).toBe(true);
  expect(client.getQueryState(galleryDetail)?.isInvalidated).toBe(true);
  expect(client.getQueryState(archiveLocation)?.isInvalidated).toBe(true);
  expect(client.getQueryState(otherGallery)?.isInvalidated).toBe(false);
  expect(client.getQueryState(signalOverview)?.isInvalidated).toBe(false);
});
