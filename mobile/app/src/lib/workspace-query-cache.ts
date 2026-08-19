import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { AssistantChange } from "./assistant-changes";
import type { Book, BookDetail } from "./books-client";
import { contentQueryKeys } from "./content-query-cache";
import type { EmailFilter, EmailOverview, EmailThread } from "./email-client";
import { normalizeCollection } from "./collection-access";
import type { GalleryCollection, GalleryCollectionInvite, GalleryCollectionMember, GalleryCollectionShareLink, GalleryImage, GalleryOverview } from "./gallery-client";
import type { Place, Trip } from "./travel-client";
import type { UserHiddenRecord } from "./user-hidden-client";

export type WorkspaceContext = { organizationKey: string; scopeKey: string };

const contextKey = (context: WorkspaceContext) => [context.organizationKey, context.scopeKey] as const;

export const galleryQueryKeys = {
  all: (context: WorkspaceContext) => ["gallery", ...contextKey(context)] as const,
  collections: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "collections"] as const,
  userHiddens: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "user-hiddens"] as const,
  overviews: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "overviews"] as const,
  overview: (context: WorkspaceContext, collectionKey?: string) => [...galleryQueryKeys.overviews(context), collectionKey ?? null] as const,
  members: (context: WorkspaceContext, collectionKey: string) => [...galleryQueryKeys.all(context), "sharing", collectionKey, "members"] as const,
  invites: (context: WorkspaceContext, collectionKey: string) => [...galleryQueryKeys.all(context), "sharing", collectionKey, "invites"] as const,
  incomingInvites: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "sharing", "incoming-invites"] as const,
  shareLinks: (context: WorkspaceContext, collectionKey: string) => [...galleryQueryKeys.all(context), "sharing", collectionKey, "share-links"] as const,
  subjects: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "subjects"] as const,
  search: (context: WorkspaceContext, mode: "text" | "similar" | "identity", collectionKey: string | undefined, value: string) => [...galleryQueryKeys.all(context), "search", mode, collectionKey ?? null, value] as const,
  duplicates: (context: WorkspaceContext, collectionKey: string) => [...galleryQueryKeys.all(context), "duplicates", collectionKey] as const,
  cleanups: (context: WorkspaceContext, collectionKey: string) => [...galleryQueryKeys.all(context), "cleanup", collectionKey] as const,
  cleanup: (context: WorkspaceContext, collectionKey: string, threshold: number) => [...galleryQueryKeys.cleanups(context, collectionKey), threshold] as const,
  uploads: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "uploads"] as const,
  highlights: (context: WorkspaceContext, collectionKey: string) => [...galleryQueryKeys.all(context), "highlights", collectionKey] as const,
  highlight: (context: WorkspaceContext, collectionKey: string, highlightKey: string) => [...galleryQueryKeys.highlights(context, collectionKey), highlightKey] as const,
  memories: (context: WorkspaceContext, collectionKey: string) => [...galleryQueryKeys.all(context), "memories", collectionKey] as const,
  memory: (context: WorkspaceContext, collectionKey: string, memoryKey: string) => [...galleryQueryKeys.memories(context, collectionKey), memoryKey] as const,
};

export function patchGalleryUserHiddens(queryClient: QueryClient, context: WorkspaceContext, update: (current: UserHiddenRecord[]) => UserHiddenRecord[]) {
  const key = galleryQueryKeys.userHiddens(context);
  const previous = queryClient.getQueryData<UserHiddenRecord[]>(key) ?? [];
  queryClient.setQueryData(key, update(previous));
  return previous;
}

export function setCachedGalleryMembers(queryClient: QueryClient, context: WorkspaceContext, collectionKey: string, members: GalleryCollectionMember[]) {
  queryClient.setQueryData(galleryQueryKeys.members(context, collectionKey), members);
}

export function setCachedGalleryInvites(queryClient: QueryClient, context: WorkspaceContext, collectionKey: string, invites: GalleryCollectionInvite[]) {
  queryClient.setQueryData(galleryQueryKeys.invites(context, collectionKey), invites);
}

export function setCachedGalleryShareLinks(queryClient: QueryClient, context: WorkspaceContext, collectionKey: string, links: GalleryCollectionShareLink[]) {
  queryClient.setQueryData(galleryQueryKeys.shareLinks(context, collectionKey), links);
}

export async function getGalleryCollections(queryClient: QueryClient, context: WorkspaceContext, queryFn: () => Promise<GalleryCollection[]>) {
  const collections = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.collections(context), queryFn, staleTime: Infinity });
  const normalized = collections.map(normalizeCollection);
  queryClient.setQueryData(galleryQueryKeys.collections(context), normalized);
  return normalized;
}

export function setCachedGalleryCollections(queryClient: QueryClient, context: WorkspaceContext, collections: GalleryCollection[]) {
  queryClient.setQueryData(galleryQueryKeys.collections(context), collections.map(normalizeCollection));
}

export const compassQueryKeys = {
  all: (context: WorkspaceContext) => ["compass", ...contextKey(context)] as const,
  overview: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "overview"] as const,
  countryDetails: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "country-details"] as const,
  countryDetail: (context: WorkspaceContext, countryCode: string) => [...compassQueryKeys.countryDetails(context), countryCode] as const,
  countryImages: (context: WorkspaceContext, imageRequestToken: string) => [...compassQueryKeys.all(context), "country-images", imageRequestToken] as const,
};

export const signalQueryKeys = {
  all: (context: WorkspaceContext) => ["signal", ...contextKey(context)] as const,
  overviews: (context: WorkspaceContext) => [...signalQueryKeys.all(context), "overviews"] as const,
  overview: (context: WorkspaceContext, filter: EmailFilter = "all", search?: string) => [...signalQueryKeys.overviews(context), filter, search?.trim() || null] as const,
  details: (context: WorkspaceContext) => [...signalQueryKeys.all(context), "details"] as const,
  detail: (context: WorkspaceContext, threadKey: string) => [...signalQueryKeys.details(context), threadKey] as const,
};

export const ascendQueryKeys = {
  all: (context: WorkspaceContext) => ["ascend", ...contextKey(context)] as const,
  overview: (context: WorkspaceContext) => [...ascendQueryKeys.all(context), "overview"] as const,
  details: (context: WorkspaceContext) => [...ascendQueryKeys.all(context), "details"] as const,
  detail: (context: WorkspaceContext, bookKey: string) => [...ascendQueryKeys.details(context), bookKey] as const,
};

export async function invalidateAssistantChanges(
  queryClient: QueryClient,
  context: WorkspaceContext,
  changes: AssistantChange[] | undefined,
) {
  const prefixes = {
    archive: contentQueryKeys.all(context),
    gallery: galleryQueryKeys.all(context),
    signal: signalQueryKeys.all(context),
    compass: compassQueryKeys.all(context),
    ascend: ascendQueryKeys.all(context),
  } as const;
  await Promise.all([...new Set(changes?.map(({ workspace }) => workspace) ?? [])].map((workspace) =>
    queryClient.invalidateQueries({ queryKey: prefixes[workspace] }),
  ));
}

export function patchGalleryImage(queryClient: QueryClient, context: WorkspaceContext, image: GalleryImage) {
  queryClient.setQueriesData<GalleryOverview>({ queryKey: galleryQueryKeys.overviews(context) }, (overview) => overview ? {
    ...overview,
    images: overview.images.map((candidate) => candidate.key === image.key ? image : candidate),
  } : overview);
}

export type GalleryOverviewSnapshot = Array<[QueryKey, GalleryOverview | undefined]>;

export function snapshotGalleryOverviews(queryClient: QueryClient, context: WorkspaceContext): GalleryOverviewSnapshot {
  return queryClient.getQueriesData<GalleryOverview>({ queryKey: galleryQueryKeys.overviews(context) });
}

export function restoreGalleryOverviews(queryClient: QueryClient, snapshot: GalleryOverviewSnapshot) {
  for (const [queryKey, overview] of snapshot) queryClient.setQueryData(queryKey, overview);
}

export function transferCachedGalleryImages(queryClient: QueryClient, context: WorkspaceContext, input: {
  sourceCollectionKey: string;
  destinationCollectionKeys: string[];
  images: GalleryImage[];
  mode: "copy" | "move";
}) {
  const imageKeys = new Set(input.images.map(({ key }) => key));
  const destinationKeys = new Set(input.destinationCollectionKeys);
  const snapshots = snapshotGalleryOverviews(queryClient, context);
  const destinationAdditions = new Map(input.destinationCollectionKeys.map((key) => [key, input.images.length]));
  for (const [queryKey, overview] of snapshots) {
    const location = queryKey.at(-1);
    if (!overview || typeof location !== "string" || !destinationKeys.has(location)) continue;
    destinationAdditions.set(location, input.images.filter(({ key }) => !overview.images.some((image) => image.key === key)).length);
  }
  for (const [queryKey, overview] of snapshots) {
    if (!overview) continue;
    const location = queryKey.at(-1);
    const removeFromLocation = input.mode === "move" && location === input.sourceCollectionKey;
    const addToLocation = typeof location === "string" && destinationKeys.has(location);
    const existingKeys = new Set(overview.images.map(({ key }) => key));
    const added = input.images.filter(({ key }) => !existingKeys.has(key));
    const images = removeFromLocation
      ? overview.images.filter(({ key }) => !imageKeys.has(key))
      : addToLocation ? [...added, ...overview.images] : overview.images;
    const collections = overview.collections.map((collection) => {
      if (input.mode === "move" && collection.key === input.sourceCollectionKey) return { ...collection, count: Math.max(0, collection.count - input.images.length) };
      if (destinationKeys.has(collection.key)) return { ...collection, count: collection.count + (destinationAdditions.get(collection.key) ?? 0), coverUrl: collection.coverUrl ?? input.images[0]?.url ?? null };
      return collection;
    });
    queryClient.setQueryData(queryKey, { ...overview, collections, images });
  }
  const root = snapshots.find(([queryKey]) => queryKey.at(-1) === null)?.[1];
  if (!root) return;
  for (const collectionKey of input.destinationCollectionKeys) {
    const queryKey = galleryQueryKeys.overview(context, collectionKey);
    if (queryClient.getQueryData(queryKey)) continue;
    queryClient.setQueryData<GalleryOverview>(queryKey, { collections: root.collections.map((collection) => collection.key === collectionKey ? { ...collection, count: collection.count + input.images.length, coverUrl: collection.coverUrl ?? input.images[0]?.url ?? null } : collection), images: input.images, nextCursor: null, canCreateCollections: root.canCreateCollections });
  }
}

export function removeCachedGalleryImages(queryClient: QueryClient, context: WorkspaceContext, images: GalleryImage[]) {
  const removed = new Set(images.map(({ key }) => key));
  const removedUrls = new Set(images.map(({ url }) => url));
  const membershipCounts = new Map<string, number>();
  const snapshots = snapshotGalleryOverviews(queryClient, context);
  for (const [queryKey, overview] of snapshots) {
    const collectionKey = queryKey.at(-1);
    if (!overview || typeof collectionKey !== "string") continue;
    membershipCounts.set(collectionKey, overview.images.filter(({ key }) => removed.has(key)).length);
  }
  for (const [queryKey, overview] of snapshots) {
    if (!overview) continue;
    queryClient.setQueryData(queryKey, {
      ...overview,
      collections: overview.collections.map((collection) => ({ ...collection, count: Math.max(0, collection.count - (membershipCounts.get(collection.key) ?? 0)), coverUrl: collection.coverUrl && removedUrls.has(collection.coverUrl) ? null : collection.coverUrl })),
      images: overview.images.filter(({ key }) => !removed.has(key)),
    });
  }
}

export function patchCompassOverview(queryClient: QueryClient, context: WorkspaceContext, update: Place | Trip) {
  queryClient.setQueryData<{ places: Place[]; trips: Trip[] }>(compassQueryKeys.overview(context), (overview) => {
    if (!overview) return overview;
    if ("itinerary" in update) return { ...overview, trips: [...overview.trips.filter(({ key }) => key !== update.key), update] };
    return { ...overview, places: [...overview.places.filter(({ key }) => key !== update.key), update] };
  });
}

export function patchSignalThread(queryClient: QueryClient, context: WorkspaceContext, thread: EmailThread) {
  queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.overviews(context) }, (overview) => overview ? {
    ...overview,
    threads: overview.threads.map((candidate) => candidate.key === thread.key ? thread : candidate),
  } : overview);
  queryClient.setQueryData<{ thread: EmailThread; messages: unknown[] }>(signalQueryKeys.detail(context, thread.key), (detail) => detail ? { ...detail, thread } : detail);
}

export function addCachedBook(queryClient: QueryClient, context: WorkspaceContext, book: Book) {
  queryClient.setQueryData<{ books: Book[] }>(ascendQueryKeys.overview(context), (overview) => overview ? {
    books: [book, ...overview.books.filter(({ key }) => key !== book.key)],
  } : overview);
}

export function patchCachedBookDetail(queryClient: QueryClient, context: WorkspaceContext, detail: BookDetail) {
  queryClient.setQueryData(ascendQueryKeys.detail(context, detail.book.key), detail);
  queryClient.setQueryData<{ books: Book[] }>(ascendQueryKeys.overview(context), (overview) => overview ? {
    books: overview.books.map((book) => book.key === detail.book.key ? detail.book : book),
  } : overview);
}
