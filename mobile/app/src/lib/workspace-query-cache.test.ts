import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { ContentContext } from "./content-client";
import { contentQueryKeys } from "./content-query-cache";
import {
  ascendQueryKeys,
  compassQueryKeys,
  galleryQueryKeys,
  invalidateAssistantChanges,
  patchGalleryImage,
  removeCachedGalleryImages,
  restoreGalleryOverviews,
  snapshotGalleryOverviews,
  signalQueryKeys,
  transferCachedGalleryImages,
} from "./workspace-query-cache";
import type { GalleryImage, GalleryOverview } from "./gallery-client";

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

const image = (key: string, isFavorite = false): GalleryImage => ({ key, filename: `${key}.jpg`, caption: key, imageCaptionKey: null, mimeType: "image/jpeg", sizeBytes: 100, width: 10, height: 10, isFavorite, createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", url: `https://images.example/${key}` });

test("optimistically patches favorites across every Gallery overview", () => {
  const client = new QueryClient();
  const original = image("image");
  const overview: GalleryOverview = { collections: [], images: [original], nextCursor: null };
  client.setQueryData(galleryQueryKeys.overview(context), overview);
  client.setQueryData(galleryQueryKeys.overview(context, "collection"), overview);

  patchGalleryImage(client, context, { ...original, isFavorite: true });

  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context))?.images[0]?.isFavorite).toBe(true);
  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "collection"))?.images[0]?.isFavorite).toBe(true);
});

test("optimistically copies and moves many images to many collection caches", () => {
  const client = new QueryClient();
  const first = image("first"), second = image("second");
  const collections = [
    { key: "source", name: "Source", description: null, isFavorite: false, count: 2, coverUrl: first.url },
    { key: "one", name: "One", description: null, isFavorite: false, count: 0, coverUrl: null },
    { key: "two", name: "Two", description: null, isFavorite: false, count: 0, coverUrl: null },
  ];
  client.setQueryData(galleryQueryKeys.overview(context), { collections, images: [first, second], nextCursor: null });
  client.setQueryData(galleryQueryKeys.overview(context, "source"), { collections, images: [first, second], nextCursor: null });
  client.setQueryData(galleryQueryKeys.overview(context, "one"), { collections, images: [], nextCursor: null });
  client.setQueryData(galleryQueryKeys.overview(context, "two"), { collections, images: [], nextCursor: null });

  transferCachedGalleryImages(client, context, { sourceCollectionKey: "source", destinationCollectionKeys: ["one", "two"], images: [first, second], mode: "move" });

  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "source"))?.images).toEqual([]);
  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "one"))?.images).toEqual([first, second]);
  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "two"))?.images).toEqual([first, second]);
});

test("removes deleted images everywhere and restores exact optimistic snapshots", () => {
  const client = new QueryClient();
  const deleted = image("deleted"), retained = image("retained");
  const key = galleryQueryKeys.overview(context, "collection");
  client.setQueryData(key, { collections: [{ key: "collection", name: "Collection", description: null, isFavorite: false, count: 2, coverUrl: deleted.url }], images: [deleted, retained], nextCursor: null });
  const snapshot = snapshotGalleryOverviews(client, context);

  removeCachedGalleryImages(client, context, [deleted]);
  expect(client.getQueryData<GalleryOverview>(key)).toMatchObject({ collections: [{ count: 1 }], images: [retained] });
  restoreGalleryOverviews(client, snapshot);
  expect(client.getQueryData<GalleryOverview>(key)?.images).toEqual([deleted, retained]);
});
