import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { AssistantChange } from "./assistant-changes";
import type { Book, BookChapter, BookDetail } from "./books-client";
import { contentQueryKeys } from "./content-query-cache";
import { normalizeEmailOverviewQuery, type EmailConnector, type EmailDraft, type EmailFacet, type EmailFilter, type EmailOverview, type EmailOverviewQuery, type EmailReplyContext, type EmailSummary, type EmailThread, type EmailToneRecord, type EmailTranslationVersion } from "./email-client";
import { normalizeCollection } from "./collection-access";
import type { GalleryCollection, GalleryCollectionInvite, GalleryCollectionMember, GalleryCollectionShareLink, GalleryImage, GalleryOverview } from "./gallery-client";
import type { Place, RecentPlace, Trip } from "./travel-client";
import type { UserHiddenRecord } from "./user-hidden-client";
import { compassQueryKeys, type WorkspaceContext } from "./compass-query-keys";
export { compassQueryKeys } from "./compass-query-keys";
export type { WorkspaceContext } from "./compass-query-keys";

const contextKey = (context: WorkspaceContext) => [context.organizationKey, context.scopeKey] as const;
const signalTombstones = new Map<string, Set<string>>();
const signalTombstoneKey = (context: WorkspaceContext, connectorKey: string) => JSON.stringify([...contextKey(context), connectorKey]);

export function tombstoneSignalThreadKeys(context: WorkspaceContext, connectorKey: string, threadKeys: readonly string[]) {
  const key = signalTombstoneKey(context, connectorKey);
  const tombstones = signalTombstones.get(key) ?? new Set<string>();
  for (const threadKey of threadKeys) tombstones.add(threadKey);
  if (tombstones.size) signalTombstones.set(key, tombstones);
}

export function clearSignalThreadTombstones(context: WorkspaceContext, connectorKey?: string) {
  if (connectorKey) {
    signalTombstones.delete(signalTombstoneKey(context, connectorKey));
    return;
  }
  const prefix = JSON.stringify(contextKey(context)).slice(0, -1);
  for (const key of signalTombstones.keys()) if (key.startsWith(prefix)) signalTombstones.delete(key);
}

export function isSignalThreadTombstoned(context: WorkspaceContext, connectorKey: string, threadKey: string) {
  return signalTombstones.get(signalTombstoneKey(context, connectorKey))?.has(threadKey) === true;
}

export function filterSignalTombstonedThreads(context: WorkspaceContext, connectorKey: string, threads: readonly EmailThread[]) {
  const tombstones = signalTombstones.get(signalTombstoneKey(context, connectorKey));
  return tombstones?.size ? threads.filter(({ key }) => !tombstones.has(key)) : [...threads];
}

export function filterSignalTombstonedOverview(context: WorkspaceContext, connectorKey: string, overview: EmailOverview): EmailOverview {
  const threads = filterSignalTombstonedThreads(context, connectorKey, overview.threads);
  return threads.length === overview.threads.length ? overview : removeSignalOverviewThreadKeys(overview, overview.threads.filter((thread) => !threads.includes(thread)).map(({ key }) => key));
}

export const galleryQueryKeys = {
  all: (context: WorkspaceContext) => ["gallery", ...contextKey(context)] as const,
  collections: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "collections"] as const,
  userHiddens: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "user-hiddens"] as const,
  overviews: (context: WorkspaceContext) => [...galleryQueryKeys.all(context), "overviews"] as const,
  overview: (context: WorkspaceContext, collectionKey?: string) => [...galleryQueryKeys.overviews(context), collectionKey ?? null] as const,
  image: (context: WorkspaceContext, collectionKey: string | undefined, imageKey: string) => [...galleryQueryKeys.all(context), "image", collectionKey ?? null, imageKey] as const,
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

export type CompassOverview = { places: Place[]; recentPlaces: RecentPlace[] };

function sortCompassPlaces(places: Place[]) {
  return places.sort((left, right) => left.name.localeCompare(right.name));
}

export function addOptimisticCompassPlace(current: CompassOverview | undefined, place: Place): CompassOverview {
  return { places: sortCompassPlaces([...(current?.places ?? []), place]), recentPlaces: current?.recentPlaces ?? [] };
}

export function removeOptimisticCompassPlace(current: CompassOverview | undefined, optimisticKey: string): CompassOverview {
  return { places: (current?.places ?? []).filter(({ key }) => key !== optimisticKey), recentPlaces: current?.recentPlaces ?? [] };
}

export function reconcileOptimisticCompassPlace(current: CompassOverview | undefined, optimisticKey: string, place: Place): CompassOverview {
  return { places: sortCompassPlaces([...(current?.places ?? []).filter(({ key }) => key !== optimisticKey && key !== place.key), place]), recentPlaces: current?.recentPlaces ?? [] };
}

export function patchCachedCompassPlace(queryClient: QueryClient, context: WorkspaceContext, place: Place) {
  queryClient.setQueryData<CompassOverview>(compassQueryKeys.overview(context), (overview) => overview ? {
    ...overview,
    places: overview.places.map((candidate) => candidate.key === place.key ? place : candidate),
  } : overview);
  queryClient.setQueryData<Trip[]>(compassQueryKeys.trips(context), (trips) => trips?.map((trip) => ({
    ...trip,
    places: trip.places.map((candidate) => candidate.key === place.key ? place : candidate),
  })));
  queryClient.setQueriesData<Place[]>({ queryKey: compassQueryKeys.placeSearches(context) }, (places) => places?.map((candidate) => candidate.key === place.key ? place : candidate));
  queryClient.setQueriesData<Trip[]>({ queryKey: compassQueryKeys.tripSearches(context) }, (trips) => trips?.map((trip) => ({ ...trip, places: trip.places.map((candidate) => candidate.key === place.key ? place : candidate) })));
}

export function removeCachedCompassPlace(queryClient: QueryClient, context: WorkspaceContext, placeKey: string) {
  queryClient.setQueryData<CompassOverview>(compassQueryKeys.overview(context), (overview) => overview ? {
    ...overview,
    places: overview.places.filter(({ key }) => key !== placeKey),
  } : overview);
  queryClient.setQueriesData<Place[]>({ queryKey: compassQueryKeys.placeSearches(context) }, (places) => places?.filter(({ key }) => key !== placeKey));
  const removeFromTrips = (trips: Trip[] | undefined) => trips?.map((trip) => ({ ...trip, places: trip.places.filter(({ key }) => key !== placeKey) }));
  queryClient.setQueryData<Trip[]>(compassQueryKeys.trips(context), removeFromTrips);
  queryClient.setQueriesData<Trip[]>({ queryKey: compassQueryKeys.tripSearches(context) }, removeFromTrips);
  queryClient.removeQueries({ queryKey: [...compassQueryKeys.places(context), placeKey, "references"] });
}

export function appendOptimisticCompassTrip(current: Trip[] | undefined, trip: Trip): Trip[] {
  return upsertCompassTrip(current, trip);
}

export function removeOptimisticCompassTrip(current: Trip[] | undefined, optimisticKey: string): Trip[] {
  return (current ?? []).filter(({ key }) => key !== optimisticKey);
}

export function reconcileOptimisticCompassTrip(current: Trip[] | undefined, optimisticKey: string, trip: Trip): Trip[] {
  const index = (current ?? []).findIndex(({ key }) => key === optimisticKey);
  const remaining = (current ?? []).filter(({ key }) => key !== optimisticKey && key !== trip.key);
  if (index < 0) return [...remaining, trip];
  remaining.splice(Math.min(index, remaining.length), 0, trip);
  return remaining;
}

export function upsertCompassTrip(current: Trip[] | undefined, trip: Trip): Trip[] {
  const trips = current ?? [];
  const index = trips.findIndex(({ key }) => key === trip.key);
  if (index < 0) return [...trips, trip];
  return trips.map((candidate, candidateIndex) => candidateIndex === index ? trip : candidate);
}

export function upsertCachedCompassTrip(queryClient: QueryClient, context: WorkspaceContext, trip: Trip) {
  queryClient.setQueryData<Trip[]>(compassQueryKeys.trips(context), (current) => upsertCompassTrip(current, trip));
  queryClient.setQueriesData<Trip[]>({ queryKey: compassQueryKeys.tripSearches(context) }, (current) => current?.some(({ key }) => key === trip.key) ? upsertCompassTrip(current, trip) : current);
}

export function removeCachedCompassTrip(queryClient: QueryClient, context: WorkspaceContext, tripKey: string) {
  queryClient.setQueryData<Trip[]>(compassQueryKeys.trips(context), (current) => removeOptimisticCompassTrip(current, tripKey));
  queryClient.setQueriesData<Trip[]>({ queryKey: compassQueryKeys.tripSearches(context) }, (current) => removeOptimisticCompassTrip(current, tripKey));
  queryClient.removeQueries({ queryKey: compassQueryKeys.tripGuides(context, tripKey), exact: true });
}

export const signalQueryKeys = {
  all: (context: WorkspaceContext) => ["signal", ...contextKey(context)] as const,
  overviews: (context: WorkspaceContext) => [...signalQueryKeys.all(context), "overviews"] as const,
  accountOverviews: (context: WorkspaceContext, connectorKey?: string) => [...signalQueryKeys.overviews(context), connectorKey ?? null] as const,
  overview: (context: WorkspaceContext, connectorKey?: string, query?: EmailOverviewQuery | EmailFilter, search?: string) => {
    if (!connectorKey && !query) return [...signalQueryKeys.accountOverviews(context), "root"] as const;
    if (typeof query === "string") return [...signalQueryKeys.accountOverviews(context, connectorKey), "legacy", query, search?.trim() || null] as const;
    const normalized = normalizeEmailOverviewQuery(query);
    return [...signalQueryKeys.accountOverviews(context, connectorKey), "inbox", normalized.readState, normalized.facets.join(","), normalized.search || null] as const;
  },
  overviewPage: (context: WorkspaceContext, connectorKey: string | undefined, query: EmailOverviewQuery | EmailFilter, cursor: string, search?: string) => [...signalQueryKeys.overview(context, connectorKey, query, search), "pages", cursor] as const,
  details: (context: WorkspaceContext) => [...signalQueryKeys.all(context), "details"] as const,
  detail: (context: WorkspaceContext, connectorKey: string | undefined, threadKey: string) => [...signalQueryKeys.details(context), connectorKey ?? null, threadKey] as const,
  drafts: (context: WorkspaceContext, connectorKey: string) => [...signalQueryKeys.all(context), "drafts", connectorKey] as const,
  draftDetails: (context: WorkspaceContext) => [...signalQueryKeys.all(context), "draft-details"] as const,
  draftDetail: (context: WorkspaceContext, connectorKey: string, draftKey: string) => [...signalQueryKeys.draftDetails(context), connectorKey, draftKey] as const,
  replyContexts: (context: WorkspaceContext) => [...signalQueryKeys.all(context), "reply-contexts"] as const,
  generated: (context: WorkspaceContext) => [...signalQueryKeys.all(context), "messages"] as const,
  translations: (context: WorkspaceContext, messageKey: string) => [...signalQueryKeys.generated(context), messageKey, "translations"] as const,
  summaries: (context: WorkspaceContext, messageKey: string) => [...signalQueryKeys.generated(context), messageKey, "summaries"] as const,
};

export type ParsedSignalOverviewQuery =
  | Readonly<{ kind: "root" }>
  | Readonly<{ kind: "legacy"; filter: EmailFilter; search: string | null }>
  | Readonly<{ kind: "inbox"; query: EmailOverviewQuery }>;
export function parseSignalOverviewQuery(queryKey: QueryKey): ParsedSignalOverviewQuery | undefined {
  const mode = queryKey[5];
  if (mode === "root") return { kind: "root" };
  if (mode === "legacy" && typeof queryKey[6] === "string") return { kind: "legacy", filter: queryKey[6] as EmailFilter, search: typeof queryKey[7] === "string" ? queryKey[7] : null };
  if (mode !== "inbox" || (queryKey[6] !== "read" && queryKey[6] !== "unread") || typeof queryKey[7] !== "string") return undefined;
  const facets = queryKey[7] ? queryKey[7].split(",").filter((facet): facet is EmailFacet => ["urgent", "important", "filtered", "favorite"].includes(facet)) : [];
  return { kind: "inbox", query: normalizeEmailOverviewQuery({ readState: queryKey[6], facets, search: typeof queryKey[8] === "string" ? queryKey[8] : undefined }) };
}

export const ascendQueryKeys = {
  all: (context: WorkspaceContext) => ["ascend", ...contextKey(context)] as const,
  overview: (context: WorkspaceContext) => [...ascendQueryKeys.all(context), "overview"] as const,
  pending: (context: WorkspaceContext) => [...ascendQueryKeys.all(context), "pending"] as const,
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

export type GalleryOverviewSnapshot = [QueryKey, GalleryOverview | undefined][];

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

export function patchSignalThread(queryClient: QueryClient, context: WorkspaceContext, connectorKey: string, thread: EmailThread) {
  if (isSignalThreadTombstoned(context, connectorKey, thread.key)) return;
  queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey) }, (overview) => overview ? {
    ...overview,
    threads: overview.threads.map((candidate) => candidate.key === thread.key ? thread : candidate),
  } : overview);
  queryClient.setQueryData<{ thread: EmailThread; messages: unknown[] }>(signalQueryKeys.detail(context, connectorKey, thread.key), (detail) => detail ? { ...detail, thread } : detail);
}

function signalThreadIsTrash(thread: EmailThread) { return thread.labels?.includes("TRASH") === true; }
export type SignalPendingThreadFields = ReadonlyMap<string, { favorite?: boolean; read?: boolean; trash?: boolean }>;

export function overlayPendingSignalThread(thread: EmailThread, pending: SignalPendingThreadFields | undefined) {
  const fields = pending?.get(thread.key);
  if (!fields) return thread;
  const trash = fields.trash;
  return {
    ...thread,
    ...(fields.favorite === undefined ? {} : { isFavorite: fields.favorite }),
    ...(fields.read === undefined ? {} : { isRead: fields.read, unread: !fields.read }),
    ...(trash === undefined ? {} : {
      labels: trash ? [...new Set([...(thread.labels ?? []), "TRASH"])] : (thread.labels ?? []).filter((label) => label !== "TRASH"),
      inInbox: !trash,
    }),
  };
}

export function overlayPendingSignalThreads(threads: readonly EmailThread[], pending: SignalPendingThreadFields | undefined) {
  return threads.map((thread) => overlayPendingSignalThread(thread, pending));
}

export type SignalPendingThreadField = "favorite" | "read" | "trash";
export type SignalRepairPendingThreadFields = ReadonlyMap<string, ReadonlySet<SignalPendingThreadField>>;

function authoritativeThreadMatchesPendingField(thread: EmailThread, field: SignalPendingThreadField, desired: { favorite?: boolean; read?: boolean; trash?: boolean }) {
  if (field === "favorite") return desired.favorite !== undefined && thread.isFavorite === desired.favorite;
  if (field === "read") return desired.read !== undefined && thread.isRead === desired.read;
  return desired.trash !== undefined && signalThreadIsTrash(thread) === desired.trash;
}

export function settleMatchingSignalRepairPendingFields(pending: SignalPendingThreadFields, repairPending: SignalRepairPendingThreadFields, updates: readonly EmailThread[]) {
  const nextPending = new Map([...pending].map(([key, fields]) => [key, { ...fields }]));
  const nextRepairPending = new Map([...repairPending].map(([key, fields]) => [key, new Set(fields)]));
  const settledThreadKeys: string[] = [];
  for (const thread of updates) {
    const desired = nextPending.get(thread.key);
    const repairFields = nextRepairPending.get(thread.key);
    if (!desired || !repairFields) continue;
    for (const field of [...repairFields]) {
      if (!authoritativeThreadMatchesPendingField(thread, field, desired)) continue;
      delete desired[field];
      repairFields.delete(field);
    }
    if (Object.keys(desired).length) nextPending.set(thread.key, desired);
    else nextPending.delete(thread.key);
    if (repairFields.size) nextRepairPending.set(thread.key, repairFields);
    else {
      nextRepairPending.delete(thread.key);
      settledThreadKeys.push(thread.key);
    }
  }
  return { pending: nextPending, repairPending: nextRepairPending, settledThreadKeys };
}
function signalThreadBelongs(thread: EmailThread, filter: EmailFilter) {
  const trash = signalThreadIsTrash(thread);
  if (filter === "trash") return trash;
  if (trash) return false;
  if (filter === "all") return true;
  if (filter === "important") return thread.inboxCategory === "Important";
  if (filter === "urgent") return thread.inboxCategory === "Urgent";
  if (filter === "filtered") return thread.inboxCategory === "Filtered";
  if (filter === "needs_action") return thread.state === "needs_action";
  if (filter === "unread") return !thread.isRead;
  return thread.isFavorite;
}
export function signalThreadBelongsToOverview(thread: EmailThread, query: EmailOverviewQuery) {
  if (signalThreadIsTrash(thread) || thread.isRead !== (query.readState === "read")) return false;
  const favoriteOnly = query.facets.includes("favorite");
  const categoryFacets = query.facets.filter((facet) => facet !== "favorite");
  return (!favoriteOnly || thread.isFavorite) && (categoryFacets.length ? categoryFacets.some((facet) => facet === thread.inboxCategory.toLowerCase()) : favoriteOnly);
}
function signalCountContribution(thread: EmailThread) {
  const trash = signalThreadIsTrash(thread);
  return {
    all: trash ? 0 : 1,
    important: !trash && thread.inboxCategory === "Important" ? 1 : 0,
    urgent: !trash && thread.inboxCategory === "Urgent" ? 1 : 0,
    needsAction: !trash && thread.state === "needs_action" ? 1 : 0,
    filtered: !trash && thread.inboxCategory === "Filtered" ? 1 : 0,
    unread: !trash && !thread.isRead ? 1 : 0,
    favorite: !trash && thread.isFavorite ? 1 : 0,
    trash: trash ? 1 : 0,
  };
}

export function reconcileSignalOverviewThreads(overview: EmailOverview, updates: readonly EmailThread[], query: EmailOverviewQuery | EmailFilter, search: string | null = null, allowInsert = true, previousThreads?: ReadonlyMap<string, EmailThread>): EmailOverview {
  let next = overview;
  for (const update of updates) {
    const current = next.threads.find(({ key }) => key === update.key);
    const belongs = typeof query === "string" ? signalThreadBelongs(update, query) : signalThreadBelongsToOverview(update, query);
    const activeSearch = typeof query === "string" ? search : query.search || null;
    const canInsert = Boolean(current) || allowInsert && activeSearch === null && belongs;
    const remaining = next.threads.filter(({ key }) => key !== update.key);
    const threads = belongs && canInsert ? [update, ...remaining].sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt) || left.key.localeCompare(right.key)) : remaining;
    const previous = current ?? previousThreads?.get(update.key);
    if (!current && threads === remaining && !previous) continue;
    const before = previous ? signalCountContribution(previous) : signalCountContribution(update);
    const after = signalCountContribution(update);
    next = { ...next, threads, counts: Object.fromEntries(Object.entries(next.counts).map(([key, count]) => [key, Math.max(0, count + (after[key as keyof typeof after] ?? 0) - (before[key as keyof typeof before] ?? 0))])) as EmailOverview["counts"] };
  }
  return next;
}

export function reconcileSignalThreads(queryClient: QueryClient, context: WorkspaceContext, connectorKey: string, updates: readonly EmailThread[], pending?: SignalPendingThreadFields) {
  updates = filterSignalTombstonedThreads(context, connectorKey, updates);
  if (!updates.length) return { previous: new Map<string, EmailThread>(), updates: [] };
  const snapshots = queryClient.getQueriesData<EmailOverview>({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey) });
  const previous = new Map<string, EmailThread>();
  for (const update of updates) {
    const detail = queryClient.getQueryData<{ thread: EmailThread }>(signalQueryKeys.detail(context, connectorKey, update.key));
    const cached = [detail?.thread, ...snapshots.flatMap(([, overview]) => overview?.threads ?? [])]
      .filter((thread): thread is EmailThread => thread?.key === update.key)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (cached) previous.set(update.key, cached);
  }
  const currentUpdates = updates.map((update) => {
    const cached = previous.get(update.key);
    return overlayPendingSignalThread(cached && cached.updatedAt > update.updatedAt ? cached : update, pending);
  });
  for (const [queryKey, overview] of snapshots) {
    if (!overview) continue;
    const hasAmbiguousBaseline = updates.some((update) => {
      if (overview.threads.some(({ key }) => key === update.key)) return false;
      const cached = previous.get(update.key);
      if (!cached || cached.updatedAt <= update.updatedAt) return false;
      const before = signalCountContribution(update);
      const after = signalCountContribution(cached);
      return Object.keys(before).some((key) => before[key as keyof typeof before] !== after[key as keyof typeof after]);
    });
    if (hasAmbiguousBaseline) {
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" });
      continue;
    }
    const parsed = parseSignalOverviewQuery(queryKey);
    if (!parsed || parsed.kind === "root") continue;
    const isPage = queryKey.at(-2) === "pages";
    queryClient.setQueryData(queryKey, reconcileSignalOverviewThreads(overview, currentUpdates, parsed.kind === "inbox" ? parsed.query : parsed.filter, parsed.kind === "legacy" ? parsed.search : null, !isPage, previous));
  }
  for (const update of currentUpdates) queryClient.setQueryData<{ thread: EmailThread; messages: (Record<string, unknown> & { labels?: string[]; isRead?: boolean; unread?: boolean })[] }>(signalQueryKeys.detail(context, connectorKey, update.key), (detail) => {
    if (!detail) return detail;
    const wasTrash = signalThreadIsTrash(detail.thread);
    const isTrash = signalThreadIsTrash(update);
    const readChanged = detail.thread.isRead !== update.isRead;
    return { ...detail, thread: update, messages: detail.messages.map((message) => ({
      ...message,
      ...(readChanged ? { isRead: update.isRead, ...(message.unread === undefined ? {} : { unread: !update.isRead }) } : {}),
      ...(wasTrash === isTrash ? {} : { labels: isTrash ? [...new Set([...(message.labels ?? []), "TRASH"])] : (message.labels ?? []).filter((label) => label !== "TRASH") }),
    })) };
  });
  return { previous, updates: currentUpdates };
}

export function reconcileSignalSelectedThreads(current: readonly EmailThread[], updates: readonly EmailThread[]) {
  const byKey = new Map(updates.map((thread) => [thread.key, thread]));
  return current.map((thread) => byKey.get(thread.key) ?? thread);
}

export function removeSignalOverviewThreadKeys(overview: EmailOverview, threadKeys: readonly string[], previousThreads: readonly EmailThread[] = []) {
  const removed = new Set(threadKeys);
  const previous = new Map(previousThreads.filter(({ key }) => removed.has(key)).map((thread) => [thread.key, thread]));
  for (const thread of overview.threads) if (removed.has(thread.key)) previous.set(thread.key, thread);
  const contribution = [...previous.values()].reduce((total, thread) => {
    const counts = signalCountContribution(thread);
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += counts[key];
    return total;
  }, { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 0 });
  return {
    ...overview,
    threads: overview.threads.filter(({ key }) => !removed.has(key)),
    counts: Object.fromEntries(Object.entries(overview.counts).map(([key, count]) => [key, Math.max(0, count - (contribution[key as keyof typeof contribution] ?? 0))])) as EmailOverview["counts"],
  };
}

export function removeSignalThreadKeys(queryClient: QueryClient, context: WorkspaceContext, connectorKey: string, threadKeys: readonly string[], previousThreads: readonly EmailThread[] = []) {
  const removed = new Set(threadKeys);
  const snapshots = queryClient.getQueriesData<EmailOverview>({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey) });
  const known = new Map(previousThreads.filter(({ key }) => removed.has(key)).map((thread) => [thread.key, thread]));
  for (const [, overview] of snapshots) for (const thread of overview?.threads ?? []) if (removed.has(thread.key)) known.set(thread.key, thread);
  for (const [queryKey, detail] of queryClient.getQueriesData<{ thread: EmailThread }>({ queryKey: signalQueryKeys.details(context) })) {
    if (queryKey[4] === connectorKey && detail && removed.has(detail.thread.key)) known.set(detail.thread.key, detail.thread);
  }
  const baselines = [...known.values()];
  for (const [queryKey, overview] of snapshots) if (overview) queryClient.setQueryData(queryKey, removeSignalOverviewThreadKeys(overview, threadKeys, baselines));
  for (const threadKey of removed) queryClient.removeQueries({ queryKey: signalQueryKeys.detail(context, connectorKey, threadKey), exact: true });
}

export function reconcileSignalTrashedThread(queryClient: QueryClient, context: WorkspaceContext, connectorKey: string, result: EmailThread) {
  reconcileSignalThreads(queryClient, context, connectorKey, [result]);
  return result;
}

export type SignalTrashCacheRemoval = {
  context: WorkspaceContext;
  connectorKey: string;
  overviews: [QueryKey, { threads: EmailThread[]; trashCount: number; optimisticVersion: number }][];
  details: [QueryKey, { detail: { thread: EmailThread; messages?: unknown[] }; version: number }][];
};

export function clearSignalTrashCaches(queryClient: QueryClient, context: WorkspaceContext, connectorKey: string): SignalTrashCacheRemoval {
  const overviews: SignalTrashCacheRemoval["overviews"] = [];
  for (const [queryKey, overview] of queryClient.getQueriesData<EmailOverview>({ queryKey: signalQueryKeys.accountOverviews(context, connectorKey) })) {
    if (!overview) continue;
    const threads = overview.threads.filter(signalThreadIsTrash);
    const optimistic = { ...overview, threads: overview.threads.filter((thread) => !signalThreadIsTrash(thread)), counts: { ...overview.counts, trash: 0 } };
    queryClient.setQueryData(queryKey, optimistic);
    overviews.push([queryKey, { threads, trashCount: overview.counts.trash, optimisticVersion: queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0 }]);
  }
  const details: SignalTrashCacheRemoval["details"] = [];
  for (const [queryKey, detail] of queryClient.getQueriesData<{ thread: EmailThread; messages?: unknown[] }>({ queryKey: signalQueryKeys.details(context) })) {
    if (queryKey[4] === connectorKey && detail && signalThreadIsTrash(detail.thread)) {
      details.push([queryKey, { detail, version: queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0 }]);
    }
  }
  return { context, connectorKey, overviews, details };
}

export function restoreSignalTrashCaches(queryClient: QueryClient, removal: SignalTrashCacheRemoval) {
  const changedAuthoritatively = removal.overviews.some(([queryKey, snapshot]) => queryClient.getQueryState(queryKey)?.dataUpdateCount !== snapshot.optimisticVersion)
    || removal.details.some(([queryKey, snapshot]) => queryClient.getQueryState(queryKey)?.dataUpdateCount !== snapshot.version);
  if (changedAuthoritatively) return false;
  for (const [queryKey, snapshot] of removal.overviews) queryClient.setQueryData<EmailOverview>(queryKey, (current) => {
    if (!current) return current;
    const existing = new Set(current.threads.map(({ key }) => key));
    const restored = snapshot.threads.filter(({ key }) => !existing.has(key) && !isSignalThreadTombstoned(removal.context, removal.connectorKey, key));
    return {
      ...current,
      threads: [...current.threads, ...restored].sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt) || left.key.localeCompare(right.key)),
      counts: { ...current.counts, trash: Math.max(current.counts.trash + restored.length, snapshot.trashCount, current.threads.filter(signalThreadIsTrash).length + restored.length) },
    };
  });
  for (const [queryKey, snapshot] of removal.details) if (!isSignalThreadTombstoned(removal.context, removal.connectorKey, snapshot.detail.thread.key)) queryClient.setQueryData(queryKey, (current: typeof snapshot.detail | undefined) => current ?? snapshot.detail);
  return true;
}

export function commitSignalTrashCaches(queryClient: QueryClient, removal: SignalTrashCacheRemoval, successfullyClearedThreadKeys: readonly string[] = []) {
  const deletedKeys = [...new Set([
    ...successfullyClearedThreadKeys,
    ...removal.overviews.flatMap(([, snapshot]) => snapshot.threads.map(({ key }) => key)),
    ...removal.details.map(([, snapshot]) => snapshot.detail.thread.key),
  ])];
  tombstoneSignalThreadKeys(removal.context, removal.connectorKey, deletedKeys);
  removeSignalThreadKeys(queryClient, removal.context, removal.connectorKey, deletedKeys);
  for (const [queryKey, snapshot] of removal.details) {
    if (queryClient.getQueryState(queryKey)?.dataUpdateCount === snapshot.version) queryClient.removeQueries({ queryKey, exact: true });
  }
}

export function upsertSignalTranslationVersion(queryClient: QueryClient, context: WorkspaceContext, messageKey: string, version: EmailTranslationVersion) {
  queryClient.setQueryData<{ messageKey: string; versions: EmailTranslationVersion[] }>(signalQueryKeys.translations(context, messageKey), (current) => ({
    messageKey,
    versions: [version, ...(current?.versions ?? []).filter(({ key }) => key !== version.key)].sort((left, right) => right.version - left.version || left.key.localeCompare(right.key)),
  }));
}

export function upsertSignalSummary(queryClient: QueryClient, context: WorkspaceContext, messageKey: string, summary: EmailSummary) {
  queryClient.setQueryData<{ messageKey: string; summaries: EmailSummary[] }>(signalQueryKeys.summaries(context, messageKey), (current) => ({
    messageKey,
    summaries: [summary, ...(current?.summaries ?? []).filter(({ key }) => key !== summary.key)].sort((left, right) => right.version - left.version || left.key.localeCompare(right.key)),
  }));
}

function sortSignalGeneratedRecords<T extends { key: string; version: number }>(records: readonly T[]) {
  return [...records].sort((left, right) => right.version - left.version || left.key.localeCompare(right.key));
}

export function removeSignalTranslationVersions(current: { messageKey: string; versions: EmailTranslationVersion[] } | undefined, keys: readonly string[]) {
  if (!current) return current;
  const removed = new Set(keys);
  return { ...current, versions: current.versions.filter(({ key }) => !removed.has(key)) };
}

export function restoreMissingSignalTranslationVersions(current: { messageKey: string; versions: EmailTranslationVersion[] } | undefined, snapshot: readonly EmailTranslationVersion[], keys: readonly string[]) {
  if (!current) return current;
  const restore = new Set(keys);
  const existing = new Set(current.versions.map(({ key }) => key));
  return { ...current, versions: sortSignalGeneratedRecords([...current.versions, ...snapshot.filter(({ key }) => restore.has(key) && !existing.has(key))]) };
}

export function removeSignalSummaries(current: { messageKey: string; summaries: EmailSummary[] } | undefined, keys: readonly string[]) {
  if (!current) return current;
  const removed = new Set(keys);
  return { ...current, summaries: current.summaries.filter(({ key }) => !removed.has(key)) };
}

export function restoreMissingSignalSummaries(current: { messageKey: string; summaries: EmailSummary[] } | undefined, snapshot: readonly EmailSummary[], keys: readonly string[]) {
  if (!current) return current;
  const restore = new Set(keys);
  const existing = new Set(current.summaries.map(({ key }) => key));
  return { ...current, summaries: sortSignalGeneratedRecords([...current.summaries, ...snapshot.filter(({ key }) => restore.has(key) && !existing.has(key))]) };
}

export function patchSignalInbox(queryClient: QueryClient, context: WorkspaceContext, inbox: EmailConnector) {
  queryClient.setQueriesData<EmailOverview>({ queryKey: signalQueryKeys.overviews(context) }, (overview) => overview ? {
    ...overview,
    accounts: overview.accounts.map((candidate) => candidate.connectorKey === inbox.connectorKey ? inbox : candidate),
    selectedAccount: overview.selectedAccount?.connectorKey === inbox.connectorKey ? inbox : overview.selectedAccount,
  } : overview);
}

export function upsertSignalTone(queryClient: QueryClient, context: WorkspaceContext, tone: EmailToneRecord) {
  queryClient.setQueryData<EmailOverview>(signalQueryKeys.overview(context), (current) => current ? {
    ...current,
    tones: current.tones.some(({ key }) => key === tone.key)
      ? current.tones.map((candidate) => candidate.key === tone.key ? tone : candidate)
      : [...current.tones, tone],
  } : current);
}

export function restoreSignalToneIfStillRemoved(current: EmailToneRecord[] | undefined, removed: EmailToneRecord) {
  if (!current || current.some(({ key }) => key === removed.key)) return current;
  return [...current, removed];
}

export function restoreSignalDraftIfStillRemoved(current: EmailOverview | undefined, removed: EmailDraft, locations: { drafts: boolean; unassignedDrafts: boolean }) {
  if (!current) return current;
  return {
    ...current,
    drafts: locations.drafts && !current.drafts.some(({ key }) => key === removed.key) ? [...current.drafts, removed] : current.drafts,
    unassignedDrafts: locations.unassignedDrafts && !current.unassignedDrafts.some(({ key }) => key === removed.key) ? [...current.unassignedDrafts, removed] : current.unassignedDrafts,
  };
}

export function upsertSignalReplyContext(queryClient: QueryClient, context: WorkspaceContext, note: EmailReplyContext) {
  queryClient.setQueryData<EmailReplyContext[]>(signalQueryKeys.replyContexts(context), (current) => {
    const notes = current ?? [];
    return notes.some(({ key }) => key === note.key)
      ? notes.map((candidate) => candidate.key === note.key ? note : candidate)
      : [...notes, note];
  });
}

export function removeSignalReplyContexts(queryClient: QueryClient, context: WorkspaceContext, noteKeys: readonly string[]) {
  const removed = new Set(noteKeys);
  queryClient.setQueryData<EmailReplyContext[]>(signalQueryKeys.replyContexts(context), (current) => current?.filter(({ key }) => !removed.has(key)));
}

export function addCachedBook(queryClient: QueryClient, context: WorkspaceContext, book: Book) {
  queryClient.setQueryData<{ books: Book[] }>(ascendQueryKeys.overview(context), (overview) => overview ? {
    books: [book, ...overview.books.filter(({ key }) => key !== book.key)],
  } : overview);
}

export function patchCachedBook(queryClient: QueryClient, context: WorkspaceContext, book: Book) {
  queryClient.setQueryData<{ books: Book[] }>(ascendQueryKeys.overview(context), (overview) => overview ? {
    books: overview.books.map((candidate) => candidate.key === book.key ? book : candidate),
  } : overview);
}

export function patchCachedBookMetadata(queryClient: QueryClient, context: WorkspaceContext, book: Book) {
  patchCachedBook(queryClient, context, book);
  queryClient.setQueryData<BookDetail>(ascendQueryKeys.detail(context, book.key), (detail) => detail ? {
    book,
    chapters: detail.chapters,
  } : detail);
}

export function removeCachedBook(queryClient: QueryClient, context: WorkspaceContext, bookKey: string) {
  queryClient.setQueryData<{ books: Book[] }>(ascendQueryKeys.overview(context), (overview) => overview ? {
    books: overview.books.filter(({ key }) => key !== bookKey),
  } : overview);
  queryClient.removeQueries({ queryKey: ascendQueryKeys.detail(context, bookKey), exact: true });
}

export function patchCachedBookDetail(queryClient: QueryClient, context: WorkspaceContext, detail: BookDetail) {
  queryClient.setQueryData<BookDetail>(ascendQueryKeys.detail(context, detail.book.key), (current) => mergeBookDetailProgress(current, detail));
  queryClient.setQueryData<{ books: Book[] }>(ascendQueryKeys.overview(context), (overview) => overview ? {
    books: overview.books.map((book) => book.key === detail.book.key ? { ...detail.book, progressPercent: Math.max(book.progressPercent, detail.book.progressPercent) } : book),
  } : overview);
}

export function mergeBookDetailProgress(current: BookDetail | undefined, incoming: BookDetail): BookDetail {
  if (!current || current.book.key !== incoming.book.key) return incoming;
  const currentChapters = new Map(current.chapters.map((chapter) => [chapter.key, chapter]));
  return {
    book: { ...incoming.book, progressPercent: Math.max(current.book.progressPercent, incoming.book.progressPercent) },
    chapters: incoming.chapters.map((chapter) => {
      const previous = currentChapters.get(chapter.key);
      return previous ? {
        ...chapter,
        progressSeconds: Math.max(previous.progressSeconds, chapter.progressSeconds),
        isCompleted: previous.isCompleted || chapter.isCompleted,
      } : chapter;
    }),
  };
}

export function patchCachedBookProgress(queryClient: QueryClient, context: WorkspaceContext, book: Book, chapter: BookChapter) {
  let mergedBook = book;
  queryClient.setQueryData<BookDetail>(ascendQueryKeys.detail(context, book.key), (current) => {
    if (!current) return current;
    const currentChapter = current.chapters.find(({ key }) => key === chapter.key);
    const mergedChapter = currentChapter ? {
      ...chapter,
      ...(currentChapter.audioUrl ? { audioUrl: currentChapter.audioUrl } : {}),
      ...(currentChapter.imageUrl ? { imageUrl: currentChapter.imageUrl } : {}),
      progressSeconds: Math.max(currentChapter.progressSeconds, chapter.progressSeconds),
      isCompleted: currentChapter.isCompleted || chapter.isCompleted,
    } : chapter;
    mergedBook = {
      ...book,
      ...(current.book.coverUrl ? { coverUrl: current.book.coverUrl } : {}),
      progressPercent: Math.max(current.book.progressPercent, book.progressPercent),
    };
    return { book: mergedBook, chapters: current.chapters.map((item) => item.key === chapter.key ? mergedChapter : item) };
  });
  queryClient.setQueryData<{ books: Book[] }>(ascendQueryKeys.overview(context), (overview) => overview ? {
    books: overview.books.map((current) => current.key === book.key ? { ...mergedBook, ...(current.coverUrl ? { coverUrl: current.coverUrl } : {}), progressPercent: Math.max(current.progressPercent, mergedBook.progressPercent) } : current),
  } : overview);
}
