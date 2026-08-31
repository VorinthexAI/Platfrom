import type { QueryClient } from "@tanstack/react-query";

import type { GalleryGenerationHistoryItem, GalleryImage, GalleryOverview } from "./gallery-client";
import type { WorkspaceContext } from "./workspace-query-cache";

export type GalleryGenerationPlaceholder = {
  collectionKey: string;
  count: number;
  createdAt: string;
  requestKey: string;
};

let generationSequence = 0;
export function createGalleryGenerationRequestKey(now = Date.now()) {
  generationSequence += 1;
  return `gallery-image-${now.toString(36)}-${generationSequence.toString(36)}`;
}

export const galleryGenerationHistoryQueryKey = (context: WorkspaceContext) => ["gallery", context.organizationKey, context.scopeKey, "generation-history"] as const;
const generatedGalleryOverviewQueryKey = (context: WorkspaceContext, collectionKey: string) => ["gallery", context.organizationKey, context.scopeKey, "overviews", collectionKey, "generated"] as const;

export function addGalleryGenerationPlaceholder(current: GalleryGenerationPlaceholder[], placeholder: GalleryGenerationPlaceholder) {
  return [placeholder, ...current.filter(({ requestKey }) => requestKey !== placeholder.requestKey)];
}

export function removeGalleryGenerationPlaceholder(current: GalleryGenerationPlaceholder[], requestKey: string) {
  return current.filter((placeholder) => placeholder.requestKey !== requestKey);
}

export function prependGeneratedGalleryImages(current: GalleryImage[], generated: GalleryImage[]) {
  const generatedKeys = new Set(generated.map(({ key }) => key));
  return [...generated, ...current.filter(({ key }) => !generatedKeys.has(key))];
}

export function prependGeneratedGalleryImagesToCache(queryClient: QueryClient, context: WorkspaceContext, collectionKey: string, generated: GalleryImage[]) {
  queryClient.setQueryData<GalleryOverview>(generatedGalleryOverviewQueryKey(context, collectionKey), (overview) => overview ? {
    ...overview,
    images: prependGeneratedGalleryImages(overview.images, generated),
  } : overview);
}

export function removeCachedGalleryGenerationHistory(queryClient: QueryClient, context: WorkspaceContext, normalizedPrompt: string) {
  const key = galleryGenerationHistoryQueryKey(context);
  const previous = queryClient.getQueryData<GalleryGenerationHistoryItem[]>(key) ?? [];
  queryClient.setQueryData(key, previous.filter((item) => item.normalizedPrompt !== normalizedPrompt));
  return previous;
}
