export const GALLERY_EVENT_SLUGS = [
  "collection.index.changed",
  "collection.content.changed",
  "collection.access.changed",
  "collection.invites.changed",
  "collection.shares.changed",
  "image.changed",
  "upload.changed",
  "subject.changed",
  "highlight.changed",
] as const;

export type GalleryEventSlug = typeof GALLERY_EVENT_SLUGS[number];
export type GalleryRefreshFamily = "root" | "current" | "access" | "members" | "collectionInvites" | "incomingInvites" | "shares" | "subjects" | "search" | "duplicates" | "cleanup" | "upload" | "highlights";
export type GalleryRefreshPlan = ReadonlySet<GalleryRefreshFamily>;

export function isCurrentContextGeneration(expected: number, current: number) {
  return expected === current;
}

const plans: Record<GalleryEventSlug, readonly GalleryRefreshFamily[]> = {
  "collection.index.changed": ["root", "access"],
  "collection.content.changed": ["current", "search", "duplicates", "cleanup", "highlights"],
  "collection.access.changed": ["root", "access", "members", "cleanup"],
  "collection.invites.changed": ["collectionInvites", "incomingInvites"],
  "collection.shares.changed": ["shares"],
  "image.changed": ["current", "search", "duplicates", "cleanup", "subjects", "upload", "highlights"],
  "upload.changed": ["current", "search", "duplicates", "cleanup", "upload", "subjects"],
  "subject.changed": ["subjects", "search"],
  "highlight.changed": ["highlights"],
};

const recoveryPlan: readonly GalleryRefreshFamily[] = ["root", "current", "access", "members", "collectionInvites", "incomingInvites", "shares", "subjects", "search", "duplicates", "cleanup", "upload", "highlights"];

export function isGalleryEventSlug(value: string): value is GalleryEventSlug {
  return (GALLERY_EVENT_SLUGS as readonly string[]).includes(value);
}

export function galleryRefreshPlan(slug: GalleryEventSlug | "reconnect"): GalleryRefreshPlan {
  return new Set(slug === "reconnect" ? recoveryPlan : plans[slug]);
}

export function mergeGalleryRefreshPlans(...refreshPlans: GalleryRefreshPlan[]): GalleryRefreshPlan {
  return new Set(refreshPlans.flatMap((plan) => [...plan]));
}

export function reconcileKeys(current: string[], available: Iterable<string>) {
  const valid = new Set(available);
  return current.filter((key) => valid.has(key));
}

export function reconcileSelected<T extends { key: string }>(selected: T | undefined, records: T[]) {
  return selected ? records.find(({ key }) => key === selected.key) : undefined;
}

export function reconcilePaginatedKeys(current: string[], available: Iterable<string>, complete: boolean, clear = false) {
  if (clear) return [];
  return complete ? reconcileKeys(current, available) : current;
}

export function reconcilePaginatedSelected<T extends { key: string }>(selected: T | undefined, records: T[], complete: boolean) {
  if (!selected) return undefined;
  return records.find(({ key }) => key === selected.key) ?? (complete ? undefined : selected);
}

export function reconcileDestination(destinationKey: string | undefined, collections: Array<{ key: string; access?: { canContribute?: boolean }; role?: string }>, excludedKey?: string) {
  if (!destinationKey) return undefined;
  return collections.some(({ key, access, role }) => key === destinationKey && key !== excludedKey && access?.canContribute === true && role !== "viewer") ? destinationKey : undefined;
}

export function reconcileGalleryState<TMode, TCollection extends { key: string; access?: { canRead?: boolean; canContribute?: boolean }; role?: string }>(input: {
  mode: TMode;
  activeCollectionKey?: string;
  selectedImageKeys: string[];
  destinationCollectionKey?: string;
  authoritativeImagesComplete?: boolean;
  clearSelection?: boolean;
}, collections: TCollection[], availableImageKeys: Iterable<string>) {
  const activeCollection = input.activeCollectionKey ? collections.find(({ key, access }) => key === input.activeCollectionKey && access?.canRead === true) : undefined;
  return {
    mode: input.mode,
    activeCollection,
    accessLost: Boolean(input.activeCollectionKey && !activeCollection),
    selectedImageKeys: reconcilePaginatedKeys(input.selectedImageKeys, availableImageKeys, input.authoritativeImagesComplete ?? true, input.clearSelection),
    destinationCollectionKey: reconcileDestination(input.destinationCollectionKey, collections, activeCollection?.key),
  };
}

export const OWNER_ONLY_GALLERY_SHEETS = new Set(["collectionEdit", "confirmDeleteCollection", "duplicates", "confirmDeleteDuplicates", "cleanup", "confirmCleanupDelete", "visualIdentities", "confirmDeleteIdentity", "identityPicker", "identityName"]);
export const MUTATION_GALLERY_SHEETS = new Set(["imageEdit", "confirmDeleteImage", "bulkActions", "bulkDelete", "transferDestination"]);
export const CONTRIBUTOR_GALLERY_SHEETS = new Set(["actions", "destination"]);

export function reconcileGalleryPermissions(input: {
  role: string | undefined;
  activeSheet: string | undefined;
  selectedImageKeys: string[];
  mutableImageKeys: Iterable<string>;
  destinationCollectionKey?: string;
  ownerCapability?: boolean;
  detailMutable?: boolean;
  canContribute?: boolean;
}) {
  const owner = input.role === "owner";
  const canContribute = (owner || input.role === "collaborator") && input.canContribute !== false;
  const mutable = new Set(input.mutableImageKeys);
  const selectedImageKeys = canContribute ? input.selectedImageKeys.filter((key) => mutable.has(key)) : [];
  const restrictedOwnerSheet = Boolean(input.activeSheet && OWNER_ONLY_GALLERY_SHEETS.has(input.activeSheet) && !owner && !input.ownerCapability);
  const detailMutation = input.activeSheet === "imageEdit" || input.activeSheet === "confirmDeleteImage";
  const selectionMutation = Boolean(input.activeSheet?.startsWith("bulk") || input.activeSheet === "transferDestination");
  const restrictedMutationSheet = Boolean(input.activeSheet && MUTATION_GALLERY_SHEETS.has(input.activeSheet) && (!canContribute || detailMutation && input.detailMutable === false || selectionMutation && selectedImageKeys.length === 0));
  const restrictedContributorSheet = Boolean(input.activeSheet && CONTRIBUTOR_GALLERY_SHEETS.has(input.activeSheet) && input.role !== undefined && !canContribute);
  return {
    activeSheet: restrictedOwnerSheet || restrictedMutationSheet || restrictedContributorSheet ? undefined : input.activeSheet,
    selectedImageKeys,
    destinationCollectionKey: canContribute ? input.destinationCollectionKey : undefined,
    closeSheet: restrictedOwnerSheet || restrictedMutationSheet || restrictedContributorSheet,
  };
}

export function recoverAssistantSearchMode(source: string | undefined) {
  return source?.trim() ? { action: "rerun" as const, query: source.trim() } : { action: "exit" as const };
}

export function shouldRunGalleryAssistantTextSearch(result: { type: string; changes?: Array<{ workspace: string }> }) {
  return result.type !== "unsupported" && !result.changes?.some(({ workspace }) => workspace === "gallery");
}

export function recoverContextualSearchFailure(mode: "similar" | "identity") {
  return { mode, clearSimilar: mode === "similar", clearIdentity: mode === "identity", loadNormalView: true } as const;
}

export type PaginatedReplayResult<TItem, TPage> = {
  cancelled: boolean;
  items: TItem[];
  firstPage?: TPage;
  nextCursor: string | null;
  reachedEnd: boolean;
};

export async function replayPaginatedWindow<TItem, TPage>(input: {
  targetCount: number;
  fetchPage: (cursor?: string) => Promise<{ page: TPage; items: TItem[]; nextCursor: string | null }>;
  getKey: (item: TItem) => string;
  isCurrent: () => boolean;
}): Promise<PaginatedReplayResult<TItem, TPage>> {
  let cursor: string | undefined;
  let firstPage: TPage | undefined;
  let nextCursor: string | null = null;
  const items = new Map<string, TItem>();
  do {
    const result = await input.fetchPage(cursor);
    if (!input.isCurrent()) return { cancelled: true, items: [], nextCursor: null, reachedEnd: false };
    firstPage ??= result.page;
    for (const item of result.items) items.set(input.getKey(item), item);
    nextCursor = result.nextCursor;
    cursor = nextCursor ?? undefined;
  } while (nextCursor && items.size < Math.max(1, input.targetCount));
  return { cancelled: false, items: [...items.values()], firstPage, nextCursor, reachedEnd: nextCursor === null };
}

export function reconcileOptimisticUploads<TOptimistic extends { clientKey: string; imageKey?: string }, TImage extends { key: string }>(optimistic: TOptimistic[], authoritative: TImage[]) {
  const images = new Map(authoritative.map((image) => [image.key, image]));
  const promoted = optimistic.flatMap((item) => {
    const image = item.imageKey ? images.get(item.imageKey) : undefined;
    return image ? [{ item, image }] : [];
  });
  const promotedClients = new Set(promoted.map(({ item }) => item.clientKey));
  return { remaining: optimistic.filter(({ clientKey }) => !promotedClients.has(clientKey)), promoted };
}

export function reconcileUploadJobRegistry<TJob extends { uploadKey: string }, TStatus extends { key: string; status: string }>(jobs: TJob[], statuses: TStatus[]) {
  const byKey = new Map(statuses.map((status) => [status.key, status]));
  const completed: Array<{ job: TJob; status: TStatus }> = [];
  const failed: Array<{ job: TJob; status: TStatus }> = [];
  const unresolved: TJob[] = [];
  for (const job of jobs) {
    const status = byKey.get(job.uploadKey);
    if (status?.status === "completed") completed.push({ job, status });
    else if (status?.status === "failed") failed.push({ job, status });
    else unresolved.push(job);
  }
  return { unresolved, completed, failed };
}

export class GalleryRefreshCoalescer {
  private pending = new Set<GalleryRefreshFamily>();

  add(plan: GalleryRefreshPlan) {
    for (const family of plan) this.pending.add(family);
  }

  takeIfReady(busy: boolean): GalleryRefreshPlan | undefined {
    if (busy || this.pending.size === 0) return undefined;
    const result = new Set(this.pending);
    this.pending.clear();
    return result;
  }

  reset() { this.pending.clear(); }

  get hasPending() { return this.pending.size > 0; }
}
