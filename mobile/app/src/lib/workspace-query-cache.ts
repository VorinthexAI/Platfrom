import type { QueryClient } from "@tanstack/react-query";
import type { AssistantChange } from "./assistant-changes";
import type { Book, BookDetail } from "./books-client";
import type { ContentContext } from "./content-client";
import { contentQueryKeys } from "./content-query-cache";
import type { EmailFilter, EmailOverview, EmailThread } from "./email-client";
import type { GalleryImage, GalleryOverview } from "./gallery-client";
import type { Place, Trip } from "./travel-client";

export type WorkspaceContext = { organizationKey: string; scopeKey: string };

const contextKey = (context: WorkspaceContext) => [context.organizationKey, context.scopeKey] as const;

export const galleryQueryKeys = {
  all: (context: WorkspaceContext) => ["gallery", ...contextKey(context)] as const,
  overviews: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "overviews"] as const,
  overview: (context: WorkspaceContext, collectionKey?: string) => [...galleryQueryKeys.overviews(context), collectionKey ?? null] as const,
};

export const compassQueryKeys = {
  all: (context: WorkspaceContext) => ["compass", ...contextKey(context)] as const,
  overview: (context: WorkspaceContext) => [...compassQueryKeys.all(context), "overview"] as const,
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
  context: WorkspaceContext & Partial<Pick<ContentContext, "agentKey">>,
  changes: AssistantChange[] | undefined,
) {
  const prefixes = {
    archive: contentQueryKeys.all({ ...context, agentKey: context.agentKey ?? "" }),
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
