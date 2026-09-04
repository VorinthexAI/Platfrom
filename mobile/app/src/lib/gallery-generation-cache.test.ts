import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { addGalleryGenerationPlaceholder, createGalleryGenerationRequestKey, galleryGenerationHistoryQueryKey, prependGeneratedGalleryImages, prependGeneratedGalleryImagesToCache, removeCachedGalleryGenerationHistory, removeGalleryGenerationPlaceholder } from "./gallery-generation-cache";

const context = { organizationKey: "organization", scopeKey: "scope" };
const image = (key: string) => ({ key, filename: `${key}.png`, caption: key, imageCaptionKey: null, mimeType: "image/png", sizeBytes: 0, width: 10, height: 10, city: null, country: null, countryCode: null, latitude: null, longitude: null, locationSource: null, mutationPolicy: "user" as const, isFavorite: false, createdAt: "2026-08-31T10:00:00.000Z", updatedAt: "2026-08-31T10:00:00.000Z", url: `https://images.example/${key}`, createdByKey: null });

test("keeps concurrent generation placeholders independently keyed", () => {
  const first = { collectionKey: "collection", count: 1, createdAt: "2026-08-31T10:00:00.000Z", requestKey: "first" };
  const second = { collectionKey: "collection", count: 3, createdAt: "2026-08-31T10:00:01.000Z", requestKey: "second" };
  const pending = addGalleryGenerationPlaceholder(addGalleryGenerationPlaceholder([], first), second);
  expect(removeGalleryGenerationPlaceholder(pending, "first")).toEqual([second]);
  expect(removeGalleryGenerationPlaceholder(pending, "unknown")).toEqual(pending);
});

test("creates distinct stable request keys for concurrent submissions", () => {
  const first = createGalleryGenerationRequestKey(1_000);
  const second = createGalleryGenerationRequestKey(1_000);
  expect(first).not.toBe(second);
  expect(first).toStartWith("gallery-image-rs-");
});

test("prepends and deduplicates authoritative generated images in state and cache", () => {
  const client = new QueryClient();
  const old = image("old"), generated = image("generated");
  const overviewKey = ["gallery", "organization", "scope", "overviews", "collection"];
  client.setQueryData(overviewKey, { collections: [], images: [old, generated], nextCursor: null, canCreateCollections: true });
  prependGeneratedGalleryImagesToCache(client, context, "collection", [generated]);
  expect(prependGeneratedGalleryImages([old, generated], [generated]).map(({ key }) => key)).toEqual(["generated", "old"]);
  expect((client.getQueryData<{ images: ReturnType<typeof image>[] }>(overviewKey))?.images.map(({ key }) => key)).toEqual(["generated", "old"]);
});

test("optimistically removes generation history and returns a rollback snapshot", () => {
  const client = new QueryClient();
  const history = [{ key: "one", type: "image" as const, prompt: "Lake", normalizedPrompt: "lake", usageCount: 1, generatedAt: "2026-08-31T10:00:00.000Z" }];
  client.setQueryData(galleryGenerationHistoryQueryKey(context), history);
  const previous = removeCachedGalleryGenerationHistory(client, context, "lake");
  expect(client.getQueryData(galleryGenerationHistoryQueryKey(context))).toEqual([]);
  client.setQueryData(galleryGenerationHistoryQueryKey(context), previous);
  expect(client.getQueryData(galleryGenerationHistoryQueryKey(context))).toEqual(history);
});
