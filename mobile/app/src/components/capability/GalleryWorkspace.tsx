import { Image } from "expo-image";
import { File } from "expo-file-system";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, useWindowDimensions, type TextInput as NativeTextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { SearchHistoryPill } from "@vorinthex/shared/ui/search-history-pill";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { CheckIcon, ChevronLeftIcon, CloseIcon, FilterIcon, FolderIcon, MailIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon, UsersIcon } from "@vorinthex/shared/ui/icons-mobile";
import { appendCursorItems, isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { GalleryCaptureModal } from "@/components/capability/GalleryCaptureModal";
import { GalleryCollectionSharing, GalleryPendingInvites } from "@/components/capability/GalleryCollectionSharing";
import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource } from "@/data/capability-icons";
import {
  askGalleryAssistant,
  createGalleryCollection,
  createGallerySubject,
  deleteGalleryCollection,
  deleteGalleryCollectionDuplicates,
  deleteGalleryImages,
  deleteGallerySubject,
  fetchGalleryOverview,
  fetchGalleryUploadStatus,
  filterMediaItems,
  findGalleryCollectionDuplicates,
  getGalleryContext,
  getGalleryMemberKey,
  groupGalleryImagesByCreatedDate,
  leaveGalleryCollection,
  listGallerySubjects,
  mergeMediaItems,
  searchGalleryImages,
  setGalleryImageFavorite,
  transferGalleryCollectionImages,
  updateGalleryCollection,
  updateGalleryImage,
  uploadGalleryImages,
  type GalleryCollection,
  type GalleryImage,
  type GalleryOverview,
  type GallerySubject,
  type PreparedGalleryUpload,
} from "@/lib/gallery-client";
import { deleteContentSearchHistory, getContentContext, type ContentSearchHistoryItem } from "@/lib/content-client";
import { contentQueryKeys, getContentHistory, promoteCachedContentHistory, removeCachedContentHistory } from "@/lib/content-query-cache";
import { galleryQueryKeys, getGalleryCollections, invalidateAssistantChanges, patchGalleryImage, removeCachedGalleryImages, restoreGalleryOverviews, setCachedGalleryCollections, snapshotGalleryOverviews, transferCachedGalleryImages } from "@/lib/workspace-query-cache";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { normalizeCapturedJpeg, type CapturedImage } from "@/lib/captured-image";
import { subscribeAppEvent } from "@/lib/app-events";
import { GalleryRefreshCoalescer, galleryRefreshPlan, isCurrentContextGeneration, reconcileGalleryPermissions, reconcileGalleryState, reconcileOptimisticUploads, reconcilePaginatedSelected, reconcileSelected, reconcileUploadJobRegistry, recoverAssistantSearchMode, recoverContextualSearchFailure, replayPaginatedWindow, type GalleryRefreshPlan } from "@/lib/gallery-convergence";

type GallerySheet = "rootActions" | "actions" | "destination" | "newCollection" | "image" | "imageActions" | "imageEdit" | "confirmDeleteImage" | "collectionMenu" | "collectionEdit" | "confirmDeleteCollection" | "confirmLeaveCollection" | "duplicates" | "confirmDeleteDuplicates" | "visualIdentities" | "confirmDeleteIdentity" | "identityPicker" | "identityName" | "identityPickerFilter" | "transferDestination" | "filter" | "searchHistory" | "bulkActions" | "bulkDelete";
type IdentityLibraryMode = "browse" | "filter";
type ImagePickerPurpose = "identity" | "cover";
type CollectionTransferMode = "copy" | "move";
type OptimisticMediaItem = PreparedGalleryUpload & { batchKey: string; collectionKey: string; createdAt: string; imageKey?: string };
type UnresolvedUploadJob = { uploadKey: string; imageKey: string; clientKey: string; collectionKey: string; batchKey?: string; file: PreparedGalleryUpload };
type GalleryGridItem =
  | { kind: "optimistic"; key: string; createdAt: string; item: OptimisticMediaItem }
  | { kind: "persisted"; key: string; createdAt: string; image: GalleryImage };
const COLLECTION_COLUMNS = 3;
const IMAGE_COLUMNS = 4;
const GRID_GAP = 5;
const COLLECTION_GAP = 10;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const deletePreparedFiles = (files: PreparedGalleryUpload[]) => {
  for (const file of files) {
    try {
      const captured = new File(file.uri);
      if (captured.exists) captured.delete();
    } catch {
      // The platform may have already evicted a camera cache file.
    }
  }
};
const CORE_PROMPTS = [
  "Find photos from rainy afternoons",
  "Show me portraits with warm light",
  "Create a collection for architecture",
] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Gallery could not complete that request.";
}

export function GalleryWorkspace() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const notify = (title: string) => showToast({ title, duration: 2_000 });
  const galleryContext = getGalleryContext();
  const contentContext = getContentContext();
  const showOnlyFavorites = useAuthStore((state) => state.user?.settings.gallery.showOnlyFavorites ?? false);
  const setGalleryShowOnlyFavorites = useAuthStore((state) => state.setGalleryShowOnlyFavorites);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [collections, setCollections] = useState<GalleryCollection[]>([]);
  const [canCreateCollections, setCanCreateCollections] = useState(false);
  const [collectionTab, setCollectionTab] = useState<"mine" | "shared">("mine");
  const [sharingOpen, setSharingOpen] = useState(false);
  const [pendingInvitesOpen, setPendingInvitesOpen] = useState(false);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [activeCollection, setActiveCollection] = useState<GalleryCollection>();
  const [showingCollectionOverview, setShowingCollectionOverview] = useState(true);
  const [subjects, setSubjects] = useState<GallerySubject[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [identityLibraryMode, setIdentityLibraryMode] = useState<IdentityLibraryMode>("browse");
  const [imagePickerPurpose, setImagePickerPurpose] = useState<ImagePickerPurpose>("identity");
  const [identityPickerCollection, setIdentityPickerCollection] = useState<GalleryCollection>();
  const [identityPickerImages, setIdentityPickerImages] = useState<GalleryImage[]>([]);
  const [identityPickerResults, setIdentityPickerResults] = useState<GalleryImage[]>();
  const [identityPickerQuery, setIdentityPickerQuery] = useState("");
  const [identityPickerName, setIdentityPickerName] = useState("");
  const [identityPickerSelected, setIdentityPickerSelected] = useState<GalleryImage>();
  const [identityPickerLoading, setIdentityPickerLoading] = useState(false);
  const [identityPickerSearching, setIdentityPickerSearching] = useState(false);
  const [identityError, setIdentityError] = useState<string>();
  const [identityPickerNextCursor, setIdentityPickerNextCursor] = useState<string | null>(null);
  const [creatingIdentityKeys, setCreatingIdentityKeys] = useState<string[]>([]);
  const [identityPendingDelete, setIdentityPendingDelete] = useState<GallerySubject>();
  const [activeSubject, setActiveSubject] = useState<GallerySubject>();
  const [activeIdentityFilter, setActiveIdentityFilter] = useState<GallerySubject>();
  const [selectedImage, setSelectedImage] = useState<GalleryImage>();
  const [selectedOptimisticItem, setSelectedOptimisticItem] = useState<OptimisticMediaItem>();
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([]);
  const [similarSource, setSimilarSource] = useState<GalleryImage>();
  const [duplicateImages, setDuplicateImages] = useState<GalleryImage[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string>();
  const [pendingFiles, setPendingFiles] = useState<PreparedGalleryUpload[]>([]);
  const [activeSheet, setActiveSheet] = useState<GallerySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [query, setQuery] = useState("");
  const [collectionSearchResults, setCollectionSearchResults] = useState<GalleryImage[]>();
  const [optimisticMediaItems, setOptimisticMediaItems] = useState<OptimisticMediaItem[]>([]);
  const [showingSearchResults, setShowingSearchResults] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionFavorite, setNewCollectionFavorite] = useState(false);
  const [editName, setEditName] = useState("");
  const [editFavorite, setEditFavorite] = useState(false);
  const [editCoverImageKey, setEditCoverImageKey] = useState<string | null>();
  const [editCoverPreviewUrl, setEditCoverPreviewUrl] = useState<string | null>();
  const [selectedImageKeys, setSelectedImageKeys] = useState<string[]>([]);
  const [transferMode, setTransferMode] = useState<CollectionTransferMode>();
  const [destinationCollectionKey, setDestinationCollectionKey] = useState<string>();
  const [aiInput, setAiInput] = useState("");
  const [aiResponse, setAiResponse] = useState<string>();
  const [assistantSearchSource, setAssistantSearchSource] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [aiInputFocused, setAiInputFocused] = useState(false);
  const [collectionSearchFocusBlocked, setCollectionSearchFocusBlocked] = useState(false);
  const [searching, setSearching] = useState(false);
  const viewRequest = useRef(0);
  const backgroundLoadRequest = useRef(0);
  const searchRequest = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchFocusReleaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const collectionSearchInput = useRef<NativeTextInput>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSearch = useRef<string | undefined>(undefined);
  const activeSheetRef = useRef<GallerySheet | undefined>(undefined);
  const sheetStack = useRef<GallerySheet[]>([]);
  const historyGeneration = useRef(0);
  const historyTarget = useRef<"gallery" | "identityPicker">("gallery");
  const identityPickerRequest = useRef(0);
  const identityFilterRequest = useRef(0);
  const subjectsRequest = useRef(0);
  const deletingIdentityKeys = useRef(new Set<string>());
  const deletedIdentityKeys = useRef(new Set<string>());
  const identityPickerSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const identityPickerHistoryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const imageSheetRequest = useRef(0);
  const selectedOptimisticItemRef = useRef<OptimisticMediaItem | undefined>(undefined);
  const favoriteRequests = useRef(new Map<string, number>());
  const favoriteWrites = useRef(new Map<string, Promise<{ image: GalleryImage }>>());
  const activeCollectionKey = useRef<string | undefined>(undefined);
  const visibleGalleryView = useRef<"root" | "collection" | "search" | "duplicates" | "contextual">("root");
  const longPressedImage = useRef<{ key: string; at: number } | undefined>(undefined);
  const cameraContextGeneration = useRef(0);
  const unresolvedUploadJobs = useRef(new Map<string, UnresolvedUploadJob>());
  const refreshCoalescer = useRef(new GalleryRefreshCoalescer());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshRunning = useRef(false);
  const refreshContextGeneration = useRef(0);
  const refreshContextKey = useRef(`${galleryContext.organizationKey}:${galleryContext.scopeKey}`);
  const busyRef = useRef(busy);
  const refreshRunner = useRef<(plan: GalleryRefreshPlan, generation: number) => Promise<void>>(async () => undefined);
  busyRef.current = busy;
  activeCollectionKey.current = activeCollection?.key;
  visibleGalleryView.current = activeCollection
    ? query.trim() ? "search" : "collection"
    : activeSubject || showingSearchResults ? "contextual" : "root";

  const contentWidth = width - spacing.md * 2;
  const collectionSize = Math.floor((contentWidth - COLLECTION_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const destinationCollectionSize = Math.floor((width - 42 - COLLECTION_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const imageSize = Math.floor((contentWidth - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);
  const sheetImageSize = Math.floor((width - 42 - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);
  const collectionRole = activeCollection?.role;
  const isCollectionOwner = collectionRole === "owner";
  const canAddImages = Boolean(activeCollection?.access.canContribute && collectionRole !== "viewer");
  const memberKeys = [...new Set([getGalleryMemberKey(), ...collections.map(({ memberKey }) => memberKey)].filter(Boolean))];
  const canMutateImage = (image: GalleryImage | undefined) => Boolean(image && (activeCollection
    ? isCollectionOwner || collectionRole === "collaborator" && image.createdByKey === activeCollection.memberKey
    : false));
  const latestActiveCollection = () => activeCollection ? collections.find(({ key }) => key === activeCollection.key) : undefined;
  const canMutateInCollection = (image: GalleryImage | undefined, collection: GalleryCollection | undefined) => Boolean(image && collection && (collection.role === "owner" || collection.role === "collaborator" && image.createdByKey === collection.memberKey));
  const captureGalleryContextGuard = () => {
    const generation = refreshContextGeneration.current;
    return { generation, isCurrent: () => isCurrentContextGeneration(generation, refreshContextGeneration.current) };
  };

  function applyCollectionSingleton(fallback: GalleryCollection[]) {
    setCachedGalleryCollections(queryClient, galleryContext, fallback);
    setCollections(fallback);
    return fallback;
  }

  async function loadCollectionSingleton(generation = refreshContextGeneration.current) {
    let loadedPermission: boolean | undefined;
    const loaded = await getGalleryCollections(queryClient, galleryContext, async () => {
      const overview = await fetchGalleryOverview(undefined, undefined, 1);
      loadedPermission = overview.canCreateCollections;
      return overview.collections;
    });
    if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return [];
    if (loadedPermission !== undefined) setCanCreateCollections(loadedPermission);
    setCollections(loaded);
    return loaded;
  }

  function updateCollectionSingleton(update: (current: GalleryCollection[]) => GalleryCollection[]) {
    setCollections((current) => {
      const next = update(current);
      setCachedGalleryCollections(queryClient, galleryContext, next);
      return next;
    });
  }

  useEffect(() => {
    const contextKey = `${galleryContext.organizationKey}:${galleryContext.scopeKey}`;
    if (refreshContextKey.current === contextKey) return;
    refreshContextKey.current = contextKey;
    refreshContextGeneration.current += 1;
    refreshCoalescer.current.reset();
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
    refreshRunning.current = false;
    viewRequest.current += 1;
    backgroundLoadRequest.current += 1;
    searchRequest.current += 1;
    identityPickerRequest.current += 1;
    subjectsRequest.current += 1;
    favoriteRequests.current.clear();
    favoriteWrites.current.clear();
    unresolvedUploadJobs.current.clear();
    deletingIdentityKeys.current.clear();
    deletedIdentityKeys.current.clear();
    closeSheet();
    setSharingOpen(false);
    setPendingInvitesOpen(false);
    setCameraOpen(false);
    setPendingFiles((current) => { deletePreparedFiles(current); return []; });
    setOptimisticMediaItems((current) => { deletePreparedFiles(current); return []; });
    setCollections([]);
    setImages([]);
    setSubjects([]);
    setCreatingIdentityKeys([]);
    setActiveCollection(undefined);
    setActiveSubject(undefined);
    setActiveIdentityFilter(undefined);
    setShowingSearchResults(false);
    setAssistantSearchSource(undefined);
    setSelectedImage(undefined);
    setSelectedImageKeys([]);
    setDestinationCollectionKey(undefined);
    setBusy(false);
    setAssistantBusy(false);
    setLoading(true);
  }, [galleryContext.organizationKey, galleryContext.scopeKey]);

  async function load(collection = activeCollection, silent = false) {
    const request = silent ? ++backgroundLoadRequest.current : ++viewRequest.current;
    const expectedView = visibleGalleryView.current;
    const isCurrent = () => silent
      ? request === backgroundLoadRequest.current && activeCollectionKey.current === collection?.key && visibleGalleryView.current === expectedView
      : request === viewRequest.current;
    if (!silent) setLoading(true);
    try {
      const overview = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collection?.key), queryFn: () => fetchGalleryOverview(collection?.key) });
      if (!isCurrent()) return false;
      applyCollectionSingleton(overview.collections);
      setCanCreateCollections(overview.canCreateCollections);
      setImages(overview.images);
      setNextCursor(overview.nextCursor);
      setCollectionSearchResults(undefined);
      if (!silent) setStatus(undefined);
      return overview;
    } catch (error) {
      if (isCurrent() && !silent) setStatus(errorMessage(error));
      return false;
    } finally {
      if (!silent && isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    if (showingSearchResults || activeSubject) return;
    const request = ++viewRequest.current;
    void queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, activeCollection?.key), queryFn: () => fetchGalleryOverview(activeCollection?.key) }).then((overview) => {
      if (request !== viewRequest.current) return;
      applyCollectionSingleton(overview.collections);
      setCanCreateCollections(overview.canCreateCollections);
      setImages(overview.images);
      setNextCursor(overview.nextCursor);
      setCollectionSearchResults(undefined);
      setStatus(undefined);
    }).catch((error: unknown) => { if (request === viewRequest.current) setStatus(errorMessage(error)); }).finally(() => { if (request === viewRequest.current) setLoading(false); });
  }, [activeCollection?.key, activeSubject?.key, showingSearchResults, galleryContext.organizationKey, galleryContext.scopeKey, queryClient]);

  function scheduleGalleryRefresh(plan: GalleryRefreshPlan) {
    refreshCoalescer.current.add(plan);
    if (refreshTimer.current || refreshRunning.current || busyRef.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = undefined;
      const next = refreshCoalescer.current.takeIfReady(busyRef.current);
      if (!next) return;
      const generation = refreshContextGeneration.current;
      refreshRunning.current = true;
      void refreshRunner.current(next, generation).finally(() => {
        if (generation !== refreshContextGeneration.current) return;
        refreshRunning.current = false;
        if (refreshCoalescer.current.hasPending) scheduleGalleryRefresh(new Set());
      });
    }, 75);
  }

  useEffect(() => subscribeAppEvent((event) => {
    scheduleGalleryRefresh(galleryRefreshPlan(event.type === "event-stream.connected" ? "reconnect" : event.slug));
  }), []);

  useEffect(() => {
    if (!busy && refreshCoalescer.current.hasPending) scheduleGalleryRefresh(new Set());
  }, [busy]);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  async function loadMoreImages() {
    if (!activeCollection || !nextCursor || loading || loadingMore || query.trim() || similarSource) return;
    const collectionKey = activeCollection.key;
    const cursor = nextCursor;
    setLoadingMore(true);
    try {
      const page = await fetchGalleryOverview(collectionKey, cursor);
      if (activeCollectionKey.current !== collectionKey) return;
      applyCollectionSingleton(page.collections);
      setCanCreateCollections(page.canCreateCollections);
      setImages((current) => appendCursorItems(current, page.images, ({ key }) => key));
      setNextCursor(page.nextCursor);
      queryClient.setQueryData<GalleryOverview>(galleryQueryKeys.overview(galleryContext, collectionKey), (current) => current ? {
        ...page,
        images: appendCursorItems(current.images, page.images, ({ key }) => key),
      } : page);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      if (activeCollectionKey.current === collectionKey) setLoadingMore(false);
    }
  }

  async function loadSubjects(silent = false) {
    const request = ++subjectsRequest.current;
    setIdentitiesLoading(true);
    try {
      const loaded = (await listGallerySubjects(true)).subjects;
      if (request === subjectsRequest.current) setSubjects((current) => {
        const pending = current.filter(({ key }) => key.startsWith("optimistic-"));
        return [...pending, ...loaded.filter(({ key }) => !deletedIdentityKeys.current.has(key) && !pending.some((identity) => identity.key === key))];
      });
      if (request === subjectsRequest.current) setIdentityError(undefined);
    } catch (error) {
      if (!silent && request === subjectsRequest.current) setStatus(errorMessage(error));
    } finally {
      if (request === subjectsRequest.current) setIdentitiesLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => { void loadSubjects(); }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (historyTimer.current) clearTimeout(historyTimer.current);
    const value = query.trim();
    if (activeSubject || !value) {
      return;
    }
    searchTimer.current = setTimeout(() => { void search(value, activeCollection); }, 300);
    historyTimer.current = setTimeout(() => { void recordGallerySearch(value, activeCollection); }, 800);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (historyTimer.current) clearTimeout(historyTimer.current);
    };
  }, [activeCollection?.key, activeSubject?.key, query]);

  useEffect(() => () => {
    if (identityPickerSearchTimer.current) clearTimeout(identityPickerSearchTimer.current);
    if (identityPickerHistoryTimer.current) clearTimeout(identityPickerHistoryTimer.current);
  }, []);

  useEffect(() => () => {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
  }, []);

  function handleCoreFocusChange(focused: boolean) {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
    setAiInputFocused(focused);
    if (focused) {
      setCollectionSearchFocusBlocked(true);
      collectionSearchInput.current?.blur();
      Keyboard.dismiss();
    } else {
      setAiResponse(undefined);
      searchFocusReleaseTimer.current = setTimeout(() => setCollectionSearchFocusBlocked(false), 350);
    }
  }

  function openSheet(sheet: GallerySheet) {
    sheetStack.current = [];
    activeSheetRef.current = sheet;
    setActiveSheet(sheet);
    setSheetOpen(true);
  }

  function pushSheet(sheet: GallerySheet) {
    const current = activeSheetRef.current;
    if (current) sheetStack.current.push(current);
    activeSheetRef.current = sheet;
    setActiveSheet(sheet);
    setSheetOpen(true);
  }

  function goBackSheet() {
    const previous = sheetStack.current.pop();
    if (!previous) {
      closeSheet();
      return;
    }
    activeSheetRef.current = previous;
    setActiveSheet(previous);
  }

  function closeSheet() {
    historyGeneration.current += 1;
    identityPickerRequest.current += 1;
    if (identityPickerSearchTimer.current) clearTimeout(identityPickerSearchTimer.current);
    if (identityPickerHistoryTimer.current) clearTimeout(identityPickerHistoryTimer.current);
    sheetStack.current = [];
    activeSheetRef.current = undefined;
    selectedOptimisticItemRef.current = undefined;
    setSelectedOptimisticItem(undefined);
    setSheetOpen(false);
    setActiveSheet(undefined);
  }

  function showCollectionsOverview() {
    viewRequest.current += 1;
    identityFilterRequest.current += 1;
    setShowingCollectionOverview(true);
    setLoading(true);
    setQuery("");
    setCollectionSearchResults(undefined);
    setSimilarSource(undefined);
    setSimilarImages([]);
    setActiveIdentityFilter(undefined);
    setNextCursor(null);
    searchRequest.current += 1;
    setSelectedImageKeys([]);
    setActiveCollection(undefined);
    setActiveSubject(undefined);
    setShowingSearchResults(false);
    setAssistantSearchSource(undefined);
  }

  async function replayOverviewWindow(collectionKey: string | undefined, targetCount: number, generation: number) {
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const replay = await replayPaginatedWindow({
      targetCount,
      getKey: ({ key }: GalleryImage) => key,
      isCurrent,
      fetchPage: async (cursor?: string) => {
        const page = cursor
          ? await fetchGalleryOverview(collectionKey, cursor)
          : await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collectionKey), queryFn: () => fetchGalleryOverview(collectionKey), staleTime: 0 });
        return { page, items: page.images, nextCursor: page.nextCursor };
      },
    });
    if (replay.cancelled || !replay.firstPage || !isCurrent()) return undefined;
    const overview = { ...replay.firstPage, images: replay.items, nextCursor: replay.nextCursor, replayReachedEnd: replay.reachedEnd };
    queryClient.setQueryData(galleryQueryKeys.overview(galleryContext, collectionKey), overview);
    return overview;
  }

  function promoteAuthoritativeUploads(authoritativeImages: GalleryImage[]) {
    const reconciliation = reconcileOptimisticUploads(optimisticMediaItems, authoritativeImages);
    if (reconciliation.promoted.length === 0) return;
    deletePreparedFiles(reconciliation.promoted.map(({ item }) => item));
    setOptimisticMediaItems((current) => reconcileOptimisticUploads(current, authoritativeImages).remaining);
    const selected = selectedOptimisticItemRef.current;
    const promotedSelected = selected ? reconciliation.promoted.find(({ item }) => item.clientKey === selected.clientKey)?.image : undefined;
    if (promotedSelected) {
      selectedOptimisticItemRef.current = undefined;
      setSelectedOptimisticItem(undefined);
      setSelectedImage(promotedSelected);
    }
  }

  function settleUploadJobs(statuses: Array<{ key: string; imageKey: string; status: string }>, generation: number) {
    if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
    const reconciliation = reconcileUploadJobRegistry([...unresolvedUploadJobs.current.values()], statuses);
    for (const { job } of [...reconciliation.completed, ...reconciliation.failed]) unresolvedUploadJobs.current.delete(job.uploadKey);
    if (reconciliation.failed.length === 0) return;
    const failedClients = new Set(reconciliation.failed.map(({ job }) => job.clientKey));
    deletePreparedFiles(reconciliation.failed.map(({ job }) => job.file));
    setOptimisticMediaItems((current) => current.filter(({ clientKey }) => !failedClients.has(clientKey)));
    const selected = selectedOptimisticItemRef.current;
    if (selected && failedClients.has(selected.clientKey)) closeSheet();
    notify("Some images could not be uploaded");
  }

  async function refreshUnresolvedUploadJobs(generation: number) {
    const uploadKeys = [...unresolvedUploadJobs.current.keys()];
    if (uploadKeys.length === 0 || !isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
    const result = await fetchGalleryUploadStatus(uploadKeys, 5_000);
    if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
    settleUploadJobs(result.jobs, generation);
  }

  async function completeUpload(files: PreparedGalleryUpload[], collectionKey: string, optimisticBatchKey?: string, generation = refreshContextGeneration.current) {
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const uploadLocation = activeCollection?.key;
    const uploadCollection = activeCollection?.key === collectionKey ? activeCollection : undefined;
    const uploadView = uploadCollection ? "collection" : "root";
    const result = await uploadGalleryImages(files, collectionKey);
    if (!isCurrent()) { deletePreparedFiles(files); return; }
    setPendingFiles([]);
    const uploadKeys = result.jobs.map(({ key }) => key);
    const jobsByKey = new Map(result.jobs.map((job) => [job.key, job]));
    for (const job of result.jobs) {
      const file = files.find(({ clientKey }) => clientKey === job.clientKey);
      if (file) unresolvedUploadJobs.current.set(job.key, { uploadKey: job.key, imageKey: job.imageKey, clientKey: job.clientKey, collectionKey, batchKey: optimisticBatchKey, file });
    }
    settleUploadJobs(result.jobs, generation);
    if (optimisticBatchKey) {
      const imageKeysByClientKey = new Map(result.jobs.map(({ clientKey, imageKey }) => [clientKey, imageKey]));
      setOptimisticMediaItems((currentItems) => currentItems.map((item) => item.batchKey === optimisticBatchKey
        ? { ...item, imageKey: imageKeysByClientKey.get(item.clientKey) }
        : item));
      if (selectedOptimisticItemRef.current?.batchKey === optimisticBatchKey) {
        const selected = selectedOptimisticItemRef.current;
        const updated = { ...selected, imageKey: imageKeysByClientKey.get(selected.clientKey) };
        selectedOptimisticItemRef.current = updated;
        setSelectedOptimisticItem(updated);
        setSelectedImage((current) => current?.key === selected.clientKey && updated.imageKey ? { ...current, key: updated.imageKey } : current);
      }
    }
    await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
    if (!isCurrent()) { deletePreparedFiles(files); return; }
    void (async () => {
      const settledKeys = new Set<string>();
      const failedKeys = new Set<string>();
      let allSettled = false;
      const refreshVisibleOverview = async () => {
        if (!isCurrent()) return { attempted: false, overview: undefined };
        if (activeCollectionKey.current === uploadLocation && visibleGalleryView.current === uploadView || !activeCollectionKey.current && visibleGalleryView.current === "root") {
          const targetCount = uploadCollection ? images.length : images.length;
          const overview = await replayOverviewWindow(uploadCollection?.key, targetCount, generation);
          if (!overview || !isCurrent()) return { attempted: false, overview: undefined };
          applyCollectionSingleton(overview.collections);
          setCanCreateCollections(overview.canCreateCollections);
          setImages(overview.images);
          setNextCursor(overview.nextCursor);
          return { attempted: true, overview };
        }
        return { attempted: false, overview: undefined };
      };
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await wait(3_000);
        if (!isCurrent()) { deletePreparedFiles(files); return; }
        try {
          const current = await fetchGalleryUploadStatus(uploadKeys, 5_000);
          if (!isCurrent()) { deletePreparedFiles(files); return; }
          settleUploadJobs(current.jobs, generation);
          const terminalJobs = current.jobs.filter(({ key, status: jobStatus }) => !settledKeys.has(key) && (jobStatus === "completed" || jobStatus === "failed"));
          if (terminalJobs.length > 0) {
            for (const job of terminalJobs) if (job.status === "failed") failedKeys.add(job.key);
            await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
            if (!isCurrent()) { deletePreparedFiles(files); return; }
            const refresh = await refreshVisibleOverview();
            if (optimisticBatchKey) {
              const visibleOverview: GalleryOverview | undefined = refresh.overview && typeof refresh.overview !== "boolean" ? refresh.overview : undefined;
              const targetOverview: GalleryOverview | undefined = uploadCollection && visibleOverview
                ? visibleOverview
                : await replayOverviewWindow(collectionKey, queryClient.getQueryData<GalleryOverview>(galleryQueryKeys.overview(galleryContext, collectionKey))?.images.length ?? files.length, generation).catch(() => undefined);
              if (!isCurrent()) { deletePreparedFiles(files); return; }
              const persistedByKey = new Map(targetOverview?.images.map((image) => [image.key, image]));
              const persistedJobs = terminalJobs.filter(({ imageKey, status: jobStatus }) => jobStatus === "failed" || (jobStatus === "completed" && persistedByKey.has(imageKey)));
              const prefetchResults = await Promise.allSettled(persistedJobs.map(({ imageKey, status: jobStatus }) => {
                const image = jobStatus === "completed" ? persistedByKey.get(imageKey) : undefined;
                return image ? Image.prefetch(image.url) : Promise.resolve(true);
              }));
              if (!isCurrent()) { deletePreparedFiles(files); return; }
              const readyJobs = persistedJobs.filter((_, index) => prefetchResults[index]?.status === "fulfilled");
              for (const job of readyJobs) settledKeys.add(job.key);
              const readyClientKeys = new Set(readyJobs.map(({ key }) => jobsByKey.get(key)?.clientKey).filter((key): key is string => Boolean(key)));
              const selected = selectedOptimisticItemRef.current;
              if (selected && readyClientKeys.has(selected.clientKey)) {
                const persisted = selected.imageKey ? persistedByKey.get(selected.imageKey) : undefined;
                selectedOptimisticItemRef.current = undefined;
                setSelectedOptimisticItem(undefined);
                if (persisted) setSelectedImage(persisted);
                else closeSheet();
              }
              setOptimisticMediaItems((currentItems) => currentItems.filter((item) => item.batchKey !== optimisticBatchKey || !readyClientKeys.has(item.clientKey)));
              deletePreparedFiles(files.filter(({ clientKey }) => readyClientKeys.has(clientKey)));
            } else for (const job of terminalJobs) settledKeys.add(job.key);
          }
          allSettled = settledKeys.size === uploadKeys.length;
          if (allSettled) break;
        } catch {}
      }
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (!isCurrent()) { deletePreparedFiles(files); return; }
      await refreshVisibleOverview();
      if (isCurrent()) await loadSubjects(true);
      if (failedKeys.size > 0) notify(failedKeys.size === uploadKeys.length ? "Upload failed" : "Some uploads failed");
    })().catch(() => undefined);
  }

  async function prepareAssets(assets: CapturedImage[], generation = refreshContextGeneration.current) {
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const initialTarget = latestActiveCollection();
    if (activeCollection && (!initialTarget?.access.canContribute || initialTarget.role === "viewer")) return;
    setBusy(true);
    closeSheet();
    setStatus(undefined);
    try {
      const files = await Promise.all(assets.slice(0, 20).map(async (asset, index) => {
        const output = await normalizeCapturedJpeg(asset, { maxSide: 2400, compress: 0.88 });
        return {
          clientKey: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          filename: `gallery-${Date.now()}-${index + 1}.jpg`,
          uri: output.uri,
          sizeBytes: output.sizeBytes,
          ...(output.latitude !== undefined && output.longitude !== undefined ? { latitude: output.latitude, longitude: output.longitude } : {}),
        };
      }));
      if (!isCurrent()) { deletePreparedFiles(files); return; }
      if (activeCollection) {
        const targetCollection = latestActiveCollection();
        if (!targetCollection?.access.canContribute || targetCollection.role === "viewer") { deletePreparedFiles(files); return; }
        clearCollectionSearch(false);
        const batchKey = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const createdAt = new Date().toISOString();
        setOptimisticMediaItems((current) => [...files.map((file) => ({ ...file, batchKey, collectionKey: targetCollection.key, createdAt })), ...current]);
        updateCollectionSingleton((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: collection.count + files.length } : collection));
        setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: current.count + files.length } : current);
        void completeUpload(files, targetCollection.key, batchKey, generation).then(() => { if (isCurrent()) notify("Upload started"); }).catch(() => {
          if (!isCurrent()) { deletePreparedFiles(files); return; }
          setOptimisticMediaItems((current) => current.filter((item) => item.batchKey !== batchKey));
          updateCollectionSingleton((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: Math.max(0, collection.count - files.length) } : collection));
          setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: Math.max(0, current.count - files.length) } : current);
          deletePreparedFiles(files);
          notify("Upload failed");
        });
        closeSheet();
      } else {
        if (!isCurrent()) { deletePreparedFiles(files); return; }
        setPendingFiles(files);
        openSheet("destination");
      }
    } catch {
      if (isCurrent()) { setPendingFiles([]); notify("Upload preparation failed"); }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function choosePhotos() {
    const generation = refreshContextGeneration.current;
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const target = latestActiveCollection();
    if (activeCollection && (!target?.access.canContribute || target.role === "viewer")) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!isCurrent()) return;
    if (!permission.granted) { closeSheet(); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 1, exif: true });
    if (!isCurrent()) return;
    if (!result.canceled) await prepareAssets(result.assets, generation);
  }

  async function takePhoto() {
    const target = latestActiveCollection();
    if (!target?.access.canContribute || target.role === "viewer") return;
    closeSheet();
    cameraContextGeneration.current = refreshContextGeneration.current;
    setCameraOpen(true);
  }

  function uploadCapturedPhotos(files: PreparedGalleryUpload[]) {
    const generation = cameraContextGeneration.current;
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const targetCollection = latestActiveCollection();
    setCameraOpen(false);
    if (!isCurrent() || !targetCollection || !targetCollection.access.canContribute || targetCollection.role === "viewer" || files.length === 0) { deletePreparedFiles(files); return; }
    clearCollectionSearch(false);
    const batchKey = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = new Date().toISOString();
    setOptimisticMediaItems((current) => [...files.map((file) => ({ ...file, batchKey, collectionKey: targetCollection.key, createdAt })), ...current]);
    updateCollectionSingleton((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: collection.count + files.length } : collection));
    setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: current.count + files.length } : current);
    void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext), refetchType: "none" });
    void completeUpload(files, targetCollection.key, batchKey, generation).then(() => { if (isCurrent()) notify("Upload started"); }).catch(() => {
      if (!isCurrent()) { deletePreparedFiles(files); return; }
      setOptimisticMediaItems((current) => current.filter((item) => item.batchKey !== batchKey));
      updateCollectionSingleton((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: Math.max(0, collection.count - files.length) } : collection));
      setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: Math.max(0, current.count - files.length) } : current);
      deletePreparedFiles(files);
      notify("Upload failed");
    });
  }

  async function uploadTo(collectionKey: string, showFeedback = true, collectionOverride?: GalleryCollection) {
    if (pendingFiles.length === 0) return false;
    const generation = refreshContextGeneration.current;
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const files = [...pendingFiles];
    const targetCollection = collectionOverride ?? collections.find(({ key }) => key === collectionKey);
    if (!targetCollection?.access.canContribute || targetCollection.role === "viewer") { deletePreparedFiles(files); setPendingFiles([]); closeSheet(); return; }
    const batchKey = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = new Date().toISOString();
    setOptimisticMediaItems((current) => [...files.map((file) => ({ ...file, batchKey, collectionKey, createdAt })), ...current]);
    if (targetCollection) updateCollectionSingleton((current) => current.map((collection) => collection.key === collectionKey ? { ...collection, count: collection.count + files.length, coverUrl: collection.coverUrl ?? files[0]?.uri ?? null } : collection));
    setBusy(true);
    closeSheet();
    try {
      await completeUpload(files, collectionKey, batchKey, generation);
      if (!isCurrent()) return false;
      if (showFeedback) notify("Upload started");
      return true;
    } catch {
      if (!isCurrent()) { deletePreparedFiles(files); return; }
      setOptimisticMediaItems((current) => current.filter((item) => item.batchKey !== batchKey));
      deletePreparedFiles(files);
      if (targetCollection) updateCollectionSingleton((current) => current.map((collection) => collection.key === collectionKey ? {
        ...collection,
        count: Math.max(0, collection.count - files.length),
        coverUrl: collection.coverUrl === files[0]?.uri ? targetCollection.coverUrl : collection.coverUrl,
      } : collection));
      if (showFeedback) notify("Upload failed");
      return false;
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function createCollectionAndUpload() {
    const generation = refreshContextGeneration.current;
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const name = newCollectionName.trim();
    if (!canCreateCollections || !name) return;
    const hasUpload = pendingFiles.length > 0;
    setBusy(true);
    try {
      const collection = await createGalleryCollection(name, newCollectionFavorite);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (!isCurrent()) return;
      updateCollectionSingleton((current) => [...current, collection]);
      setNewCollectionName("");
      setNewCollectionFavorite(false);
      if (hasUpload) {
        const uploadStarted = await uploadTo(collection.key, false, collection);
        notify(uploadStarted ? "Collection created and upload started" : "Upload failed; collection created");
      } else {
        notify("Collection created");
        closeSheet(); setBusy(false); await load();
      }
    } catch (error) {
      if (isCurrent()) { setStatus(errorMessage(error)); notify("Collection creation failed"); }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  function updateCollectionSearch(value: string) {
    searchRequest.current += 1;
    identityFilterRequest.current += 1;
    activeSearch.current = undefined;
    setSearching(Boolean(value.trim()));
    setCollectionSearchResults(undefined);
    setSimilarSource(undefined);
    setSimilarImages([]);
    setActiveIdentityFilter(undefined);
    setStatus(undefined);
    setQuery(value);
  }

  async function search(value = query.trim(), collection = activeCollection) {
    if (!value) return;
    const searchKey = `${collection?.key ?? "root"}:${value.toLocaleLowerCase()}`;
    if (activeSearch.current === searchKey) return;
    activeSearch.current = searchKey;
    const request = ++searchRequest.current;
    const immediateMatches = collection ? filterMediaItems(images, value) : [];
    setSearching(true);
    try {
      const result = await searchGalleryImages({ query: value, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: false, limit: 50 });
      const expectedView = collection ? "search" : "root";
      if (request !== searchRequest.current || activeCollectionKey.current !== collection?.key || visibleGalleryView.current !== expectedView) return;
      setSelectedImageKeys([]);
      const matches = mergeMediaItems(immediateMatches, result.images);
      setCollectionSearchResults(matches);
      setStatus(undefined);
    } catch (error) {
      const expectedView = collection ? "search" : "root";
      if (request === searchRequest.current && activeCollectionKey.current === collection?.key && visibleGalleryView.current === expectedView) setStatus(errorMessage(error));
    } finally {
      if (activeSearch.current === searchKey) activeSearch.current = undefined;
      if (request === searchRequest.current) setSearching(false);
    }
  }

  async function recordGallerySearch(value: string, collection = activeCollection) {
    try {
      await searchGalleryImages({ query: value, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: true, limit: 50 });
      await queryClient.invalidateQueries({ queryKey: contentQueryKeys.history(contentContext, undefined), exact: true, refetchType: "none" });
    } catch {
      // Search results already report failures; history persistence is best effort.
    }
  }

  function clearCollectionSearch(refresh = true) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (historyTimer.current) clearTimeout(historyTimer.current);
    searchRequest.current += 1;
    activeSearch.current = undefined;
    setQuery("");
    setCollectionSearchResults(undefined);
    setSearching(false);
    setStatus(undefined);
    if (refresh && activeCollection) {
      const collection = activeCollection;
      setTimeout(() => { void load(collection, true); }, 0);
    }
  }

  async function openSearchHistory(target: "gallery" | "identityPicker" = "gallery") {
    historyTarget.current = target;
    const generation = ++historyGeneration.current;
    const key = contentQueryKeys.history(contentContext, undefined);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []);
    setHistoryLoading(!cached || invalidated);
    setRemovingHistoryQuery(undefined);
    pushSheet("searchHistory");
    if (cached && !invalidated) return;
    try {
      const loaded = await getContentHistory(queryClient, contentContext, undefined);
      if (generation === historyGeneration.current && activeSheetRef.current === "searchHistory") setHistory(loaded);
    } catch (error) {
      if (generation === historyGeneration.current && activeSheetRef.current === "searchHistory") setStatus(errorMessage(error));
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  }

  function applyHistoryQuery(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedContentHistory(queryClient, contentContext, undefined, item);
    setHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    if (historyTarget.current === "identityPicker") returnToIdentityPicker(item.query);
    else { closeSheet(); updateCollectionSearch(item.query); }
  }

  async function removeHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingHistoryQuery) return;
    const previous = removeCachedContentHistory(queryClient, contentContext, undefined, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
      notify("Search removed");
    } catch (error) {
      queryClient.setQueryData(contentQueryKeys.history(contentContext, undefined), previous);
      setHistory(previous);
      setStatus(errorMessage(error));
      notify("Search removal failed");
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  }

  async function showImage(image: GalleryImage) {
    imageSheetRequest.current += 1;
    selectedOptimisticItemRef.current = undefined;
    setSelectedOptimisticItem(undefined);
    setSelectedImage(image);
    openSheet("image");
  }

  function showOptimisticImage(item: OptimisticMediaItem) {
    imageSheetRequest.current += 1;
    selectedOptimisticItemRef.current = item;
    setSelectedOptimisticItem(item);
    setSelectedImage({
      key: item.imageKey ?? item.clientKey,
      filename: item.filename,
      caption: "",
      imageCaptionKey: null,
      mimeType: "image/jpeg",
      sizeBytes: item.sizeBytes,
      width: 0,
      height: 0,
      isFavorite: false,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      url: item.uri,
    });
    openSheet("image");
  }

  async function findSimilar() {
    if (!selectedImage || !activeCollection) return;
    const loadingStartedAt = Date.now();
    const request = ++imageSheetRequest.current;
    const source = selectedImage;
    const collection = activeCollection;
    closeSheet();
    setSimilarSource(source);
    setSimilarImages([]);
    setSelectedImage(undefined);
    setLoading(true);
    try {
      const result = await searchGalleryImages({ imageKey: source.key, collectionKey: collection.key, limit: 50 });
      if (request !== imageSheetRequest.current || activeCollectionKey.current !== collection.key) return;
      await Promise.allSettled(result.images.map(({ url }) => Image.prefetch(url)));
      if (request !== imageSheetRequest.current || activeCollectionKey.current !== collection.key) return;
      await wait(Math.max(0, 300 - (Date.now() - loadingStartedAt)));
      if (request !== imageSheetRequest.current || activeCollectionKey.current !== collection.key) return;
      setSimilarImages(result.images);
      setStatus(undefined);
    } catch (error) {
      if (request === imageSheetRequest.current) setStatus(errorMessage(error));
    } finally {
      if (request === imageSheetRequest.current) setLoading(false);
    }
  }

  function clearSimilarImages() {
    imageSheetRequest.current += 1;
    setSimilarSource(undefined);
    setSimilarImages([]);
    setLoading(false);
    setStatus(undefined);
  }

  function openImageEdit() {
    if (!selectedImage || !canMutateImage(selectedImage)) return;
    setEditName(selectedImage.filename);
    setEditFavorite(selectedImage.isFavorite);
    pushSheet("imageEdit");
  }

  async function submitImageEdit() {
    if (!selectedImage || !canMutateInCollection(selectedImage, latestActiveCollection()) || !editName.trim()) return;
    const previous = selectedImage;
    const { isCurrent } = captureGalleryContextGuard();
    setBusy(true);
    try {
      const { image } = await updateGalleryImage(previous.key, editName.trim(), editFavorite);
      if (!isCurrent()) return;
      setSelectedImage(image);
      replaceVisibleImages([image]);
      patchGalleryImage(queryClient, galleryContext, image);
      closeSheet();
      notify("Image updated");
    } catch {
      if (isCurrent()) notify("Image update failed");
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  function openCollectionEdit() {
    if (!activeCollection || !isCollectionOwner) return;
    setEditName(activeCollection.name);
    setEditFavorite(activeCollection.isFavorite);
    setEditCoverImageKey(undefined);
    setEditCoverPreviewUrl(activeCollection.coverUrl);
    pushSheet("collectionEdit");
  }

  async function openCollectionCoverPicker() {
    if (!activeCollection || !isCollectionOwner) return;
    setImagePickerPurpose("cover");
    identityPickerRequest.current += 1;
    setIdentityPickerImages([]);
    setIdentityPickerResults(undefined);
    setIdentityPickerQuery("");
    setIdentityPickerSelected(undefined);
    setIdentityPickerNextCursor(null);
    pushSheet("identityPicker");
    await openIdentityPickerCollection(activeCollection);
  }

  function chooseCollectionCover() {
    if (!identityPickerSelected) return;
    setEditCoverImageKey(identityPickerSelected.key);
    setEditCoverPreviewUrl(identityPickerSelected.url);
    goBackSheet();
  }

  async function submitCollectionEdit() {
    const latest = latestActiveCollection();
    if (!activeCollection || latest?.role !== "owner" || !latest.access.canManage || !editName.trim()) return;
    const previous = activeCollection;
    const { isCurrent } = captureGalleryContextGuard();
    const optimistic = { ...previous, name: editName.trim(), isFavorite: editFavorite, ...(editCoverImageKey !== undefined ? { coverUrl: editCoverPreviewUrl ?? null } : {}) };
    setBusy(true);
    updateCollectionSingleton((current) => current.map((candidate) => candidate.key === previous.key ? optimistic : candidate));
    setActiveCollection(optimistic);
    try {
      const { collection } = await updateGalleryCollection(previous.key, editName.trim(), editFavorite, editCoverImageKey);
      if (!isCurrent()) return;
      updateCollectionSingleton((current) => current.map((candidate) => candidate.key === collection.key ? collection : candidate));
      setActiveCollection(collection);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (!isCurrent()) return;
      closeSheet();
      notify("Collection updated");
    } catch (error) {
      if (isCurrent()) { updateCollectionSingleton((current) => current.map((candidate) => candidate.key === previous.key ? previous : candidate)); setActiveCollection(previous); setStatus(errorMessage(error)); notify("Collection update failed"); }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function removeActiveCollection() {
    const latest = latestActiveCollection();
    if (!activeCollection || latest?.role !== "owner" || !latest.access.canManage) return;
    const collection = activeCollection;
    const { isCurrent } = captureGalleryContextGuard();
    setBusy(true);
    try {
      await deleteGalleryCollection(collection.key);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (!isCurrent()) return;
      closeSheet();
      setActiveCollection(undefined);
      setShowingCollectionOverview(true);
      updateCollectionSingleton((current) => current.filter(({ key }) => key !== collection.key));
      setImages([]);
      setStatus(`${collection.name} was deleted.`);
      notify("Collection deleted");
    } catch (error) {
      if (isCurrent()) { setStatus(errorMessage(error)); notify("Collection deletion failed"); }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function leaveActiveCollection() {
    const latest = latestActiveCollection();
    if (!activeCollection || !latest || latest.role === "owner" || !latest.access.canRead) return;
    const collection = activeCollection;
    const { isCurrent } = captureGalleryContextGuard();
    setBusy(true);
    try {
      await leaveGalleryCollection(collection.key);
      if (!isCurrent()) return;
      closeSheet();
      setActiveCollection(undefined);
      setShowingCollectionOverview(true);
      updateCollectionSingleton((current) => current.filter(({ key }) => key !== collection.key));
      setImages([]);
      setStatus(`You left ${collection.name}.`);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (!isCurrent()) return;
      notify("Collection left");
    } catch (error) { if (isCurrent()) { setStatus(errorMessage(error)); notify("Leaving collection failed"); } }
    finally { if (isCurrent()) setBusy(false); }
  }

  function replaceVisibleImages(updated: GalleryImage[]) {
    const byKey = new Map(updated.map((image) => [image.key, image]));
    const replace = (current: GalleryImage[]) => current.map((image) => byKey.get(image.key) ?? image);
    setImages(replace);
    setSimilarImages(replace);
    setCollectionSearchResults((current) => current ? replace(current) : current);
  }

  function deleteSelectedImage() {
    if (!selectedImage || !canMutateInCollection(selectedImage, latestActiveCollection())) return;
    const target = selectedImage;
    const { isCurrent } = captureGalleryContextGuard();
    const cacheSnapshot = snapshotGalleryOverviews(queryClient, galleryContext);
    const previousImages = images;
    const previousSimilarImages = similarImages;
    const previousSearchResults = collectionSearchResults;
    const previousCollections = collections;
    const previousActiveCollection = activeCollection;
    const removedFromActive = Boolean(activeCollection);
    removeCachedGalleryImages(queryClient, galleryContext, [target]);
    setImages((current) => current.filter(({ key }) => key !== target.key));
    setSimilarImages((current) => current.filter(({ key }) => key !== target.key));
    setCollectionSearchResults((current) => current?.filter(({ key }) => key !== target.key));
    updateCollectionSingleton((current) => current.map((collection) => ({ ...collection, ...(removedFromActive && collection.key === previousActiveCollection?.key ? { count: Math.max(0, collection.count - 1) } : {}), ...(collection.coverUrl === target.url ? { coverUrl: null } : {}) })));
    if (removedFromActive) {
      setActiveCollection((current) => current ? { ...current, count: Math.max(0, current.count - 1) } : current);
    }
    setSelectedImage(undefined);
    closeSheet();
    void deleteGalleryImages([target.key]).then(() => {
      if (!isCurrent()) return;
      notify("Image deleted");
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      void queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext), queryFn: () => fetchGalleryOverview() }).then((overview) => {
        if (!isCurrent()) return;
        setCanCreateCollections(overview.canCreateCollections);
        setCachedGalleryCollections(queryClient, galleryContext, overview.collections);
        setCollections(overview.collections);
        setActiveCollection((current) => current ? overview.collections.find(({ key }) => key === current.key) ?? current : current);
      }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (isCurrent()) void loadSubjects();
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      setImages(previousImages);
      setSimilarImages(previousSimilarImages);
      setCollectionSearchResults(previousSearchResults);
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(previousActiveCollection);
      setSelectedImage(target);
      notify("Image deletion failed");
    });
  }

  async function showDuplicates() {
    if (!activeCollection || !isCollectionOwner) return;
    const request = ++viewRequest.current;
    setDuplicateImages([]);
    setDuplicatesError(undefined);
    setDuplicatesLoading(true);
    openSheet("duplicates");
    try {
      const result = await findGalleryCollectionDuplicates(activeCollection.key);
      if (request !== viewRequest.current || activeSheetRef.current !== "duplicates") return;
      setDuplicateImages(result.images);
    } catch (error) {
      if (request === viewRequest.current) setDuplicatesError(errorMessage(error));
    } finally {
      if (request === viewRequest.current) setDuplicatesLoading(false);
    }
  }

  async function deleteDuplicates() {
    const latest = latestActiveCollection();
    if (!activeCollection || latest?.role !== "owner" || !latest.access.canManage || duplicateImages.length === 0) return;
    const { isCurrent } = captureGalleryContextGuard();
    setBusy(true);
    try {
      const deleted = await deleteGalleryCollectionDuplicates(activeCollection.key, duplicateImages.map(({ key }) => key));
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (!isCurrent()) return;
      updateCollectionSingleton((current) => current.map((collection) => collection.key === activeCollection.key
        ? { ...collection, count: Math.max(0, collection.count - deleted.removedImageKeys.length) }
        : collection));
      setActiveCollection((current) => current ? { ...current, count: Math.max(0, current.count - deleted.removedImageKeys.length) } : current);
      setImages((current) => current.filter(({ key }) => !deleted.removedImageKeys.includes(key)));
      setDuplicateImages([]);
      closeSheet();
      setStatus(`${deleted.removedImageKeys.length} duplicate image${deleted.removedImageKeys.length === 1 ? "" : "s"} removed from this collection. ${deleted.deletedImageKeys.length} moved to trash.`);
      notify("Duplicates deleted");
    } catch (error) {
      if (isCurrent()) { setStatus(errorMessage(error)); notify("Duplicate deletion failed"); }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function openVisualIdentities(mode: IdentityLibraryMode) {
    setIdentityLibraryMode(mode);
    setIdentityError(undefined);
    if (activeSheetRef.current) pushSheet("visualIdentities");
    else openSheet("visualIdentities");
    if (!subjects.length) await loadSubjects();
  }

  async function openIdentityPicker() {
    const generation = refreshContextGeneration.current;
    setImagePickerPurpose("identity");
    identityPickerRequest.current += 1;
    setIdentityPickerCollection(undefined);
    setIdentityPickerImages([]);
    setIdentityPickerResults(undefined);
    setIdentityPickerQuery("");
    setIdentityPickerName("");
    setIdentityPickerSelected(undefined);
    setIdentityPickerNextCursor(null);
    setIdentityPickerLoading(true);
    pushSheet("identityPicker");
    try {
      await loadCollectionSingleton(generation);
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
    } catch (error) {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current)) setStatus(errorMessage(error));
    } finally {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current)) setIdentityPickerLoading(false);
    }
  }

  async function openIdentityPickerCollection(collection: GalleryCollection) {
    const generation = refreshContextGeneration.current;
    const request = ++identityPickerRequest.current;
    setIdentityPickerCollection(collection);
    setIdentityPickerQuery("");
    setIdentityPickerResults(undefined);
    setIdentityPickerSelected(undefined);
    setIdentityPickerLoading(true);
    try {
      const overview = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collection.key), queryFn: () => fetchGalleryOverview(collection.key) });
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current) || request !== identityPickerRequest.current) return;
      setIdentityPickerImages(overview.images);
      setCanCreateCollections(overview.canCreateCollections);
      setIdentityPickerNextCursor(overview.nextCursor);
    } catch (error) {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current) && request === identityPickerRequest.current) setStatus(errorMessage(error));
    } finally {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current) && request === identityPickerRequest.current) setIdentityPickerLoading(false);
    }
  }

  function backIdentityPicker() {
    identityPickerRequest.current += 1;
    if (imagePickerPurpose === "cover") { goBackSheet(); return; }
    if (!identityPickerCollection) { goBackSheet(); return; }
    setIdentityPickerCollection(undefined);
    setIdentityPickerImages([]);
    setIdentityPickerResults(undefined);
    setIdentityPickerQuery("");
    setIdentityPickerSelected(undefined);
    setIdentityPickerNextCursor(null);
    setIdentityPickerLoading(false);
  }

  async function loadMoreIdentityPickerImages() {
    if (!identityPickerCollection || !identityPickerNextCursor || identityPickerLoading || identityPickerSearching || identityPickerQuery.trim()) return;
    const request = identityPickerRequest.current;
    const generation = refreshContextGeneration.current;
    const collection = identityPickerCollection;
    setIdentityPickerLoading(true);
    try {
      const page = await fetchGalleryOverview(collection.key, identityPickerNextCursor);
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current) || request !== identityPickerRequest.current) return;
      setIdentityPickerImages((current) => appendCursorItems(current, page.images, ({ key }) => key));
      setCanCreateCollections(page.canCreateCollections);
      setIdentityPickerNextCursor(page.nextCursor);
    } catch (error) {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current) && request === identityPickerRequest.current) setStatus(errorMessage(error));
    } finally {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current) && request === identityPickerRequest.current) setIdentityPickerLoading(false);
    }
  }

  function updateIdentityPickerSearch(value: string) {
    if (identityPickerSearchTimer.current) clearTimeout(identityPickerSearchTimer.current);
    if (identityPickerHistoryTimer.current) clearTimeout(identityPickerHistoryTimer.current);
    const normalized = value.trim();
    setIdentityPickerQuery(value);
    setIdentityPickerResults(undefined);
    setIdentityPickerSelected(undefined);
    setIdentityPickerSearching(Boolean(normalized));
    const request = ++identityPickerRequest.current;
    const generation = refreshContextGeneration.current;
    if (!normalized) return;
    const collection = identityPickerCollection;
    identityPickerSearchTimer.current = setTimeout(() => {
      void searchGalleryImages({ query: normalized, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: false, limit: 50 }).then(({ images: results }) => {
        if (isCurrentContextGeneration(generation, refreshContextGeneration.current) && request === identityPickerRequest.current) setIdentityPickerResults(results);
      }).catch((error: unknown) => { if (isCurrentContextGeneration(generation, refreshContextGeneration.current) && request === identityPickerRequest.current) setStatus(errorMessage(error)); }).finally(() => { if (isCurrentContextGeneration(generation, refreshContextGeneration.current) && request === identityPickerRequest.current) setIdentityPickerSearching(false); });
    }, 300);
    identityPickerHistoryTimer.current = setTimeout(() => {
      void searchGalleryImages({ query: normalized, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: true, limit: 1 }).then(() => isCurrentContextGeneration(generation, refreshContextGeneration.current) ? queryClient.invalidateQueries({ queryKey: contentQueryKeys.history(contentContext, undefined), exact: true, refetchType: "none" }) : undefined).catch(() => undefined);
    }, 800);
  }

  async function refreshIdentityPickerSearchSilently(value: string, collection: GalleryCollection | undefined, contextGeneration = refreshContextGeneration.current) {
    const normalized = value.trim();
    if (!normalized) return;
    const request = ++identityPickerRequest.current;
    setIdentityPickerSearching(true);
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.search(galleryContext, "text", collection?.key, normalized.toLocaleLowerCase()), queryFn: () => searchGalleryImages({ query: normalized, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: false, limit: 50 }), staleTime: 0 });
      if (contextGeneration !== refreshContextGeneration.current || request !== identityPickerRequest.current || activeSheetRef.current !== "identityPicker") return;
      setIdentityPickerResults(result.images);
      setIdentityPickerSelected((selected) => reconcilePaginatedSelected(selected, result.images, false));
    } catch (error) {
      if (contextGeneration === refreshContextGeneration.current && request === identityPickerRequest.current) setStatus(errorMessage(error));
    } finally {
      if (contextGeneration === refreshContextGeneration.current && request === identityPickerRequest.current) setIdentityPickerSearching(false);
    }
  }

  function returnToIdentityPicker(queryValue?: string) {
    sheetStack.current = ["visualIdentities"];
    activeSheetRef.current = "identityPicker";
    setActiveSheet("identityPicker");
    if (queryValue !== undefined) updateIdentityPickerSearch(queryValue);
  }

  function returnToIdentityLibrary() {
    sheetStack.current = [];
    activeSheetRef.current = "visualIdentities";
    setActiveSheet("visualIdentities");
  }

  async function createVisualIdentity() {
    const generation = refreshContextGeneration.current;
    const image = identityPickerSelected;
    const name = identityPickerName.trim();
    if (!image || !name || !canManageAnyCollection) return;
    const optimisticKey = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    setIdentityError(undefined);
    const optimistic: GallerySubject = { key: optimisticKey, name, description: "Learning visual identity...", referenceImageKey: image.key, referenceUrl: image.url, imageCount: 1, deletedAt: null, createdAt: now, updatedAt: now };
    subjectsRequest.current += 1;
    setIdentitiesLoading(false);
    setSubjects((current) => [optimistic, ...current]);
    setCreatingIdentityKeys((current) => [...current, optimisticKey]);
    returnToIdentityLibrary();
    void createGallerySubject(name, [image.key]).then(({ subject }) => {
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      setSubjects((current) => current.map((candidate) => candidate.key === optimisticKey ? subject : candidate));
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(galleryContext) });
      notify("Visual identity created");
    }).catch((error: unknown) => {
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      setSubjects((current) => current.filter(({ key }) => key !== optimisticKey));
      setIdentityError(errorMessage(error));
      notify("Visual identity creation failed");
    }).finally(() => { if (isCurrentContextGeneration(generation, refreshContextGeneration.current)) setCreatingIdentityKeys((current) => current.filter((key) => key !== optimisticKey)); });
  }

  function confirmDeleteVisualIdentity(identity: GallerySubject) {
    setIdentityPendingDelete(identity);
    pushSheet("confirmDeleteIdentity");
  }

  function deleteVisualIdentity() {
    const generation = refreshContextGeneration.current;
    const identity = identityPendingDelete;
    if (!identity || !canManageAnyCollection || deletingIdentityKeys.current.has(identity.key)) return;
    deletingIdentityKeys.current.add(identity.key);
    deletedIdentityKeys.current.add(identity.key);
    subjectsRequest.current += 1;
    setIdentitiesLoading(false);
    setSubjects((current) => current.filter(({ key }) => key !== identity.key));
    if (activeIdentityFilter?.key === identity.key) {
      identityFilterRequest.current += 1;
      setActiveIdentityFilter(undefined);
      if (activeSubject?.key === identity.key) {
        setActiveSubject(undefined);
        setShowingSearchResults(false);
        void replayOverviewWindow(undefined, images.length, generation).then((overview) => {
          if (!overview || !isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
          applyCollectionSingleton(overview.collections); setCanCreateCollections(overview.canCreateCollections); setImages(overview.images); setNextCursor(overview.nextCursor);
        });
      } else if (activeCollection) {
        setCollectionSearchResults(undefined);
        void replayOverviewWindow(activeCollection.key, images.length, generation).then((overview) => {
          if (!overview || !isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
          applyCollectionSingleton(overview.collections); setCanCreateCollections(overview.canCreateCollections); setImages(overview.images); setNextCursor(overview.nextCursor);
        });
      }
    }
    setIdentityPendingDelete(undefined);
    goBackSheet();
    void deleteGallerySubject(identity.key).then(() => {
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(galleryContext) });
      notify("Visual identity deleted");
    }).catch((error: unknown) => {
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      deletedIdentityKeys.current.delete(identity.key);
      setSubjects((current) => current.some(({ key }) => key === identity.key) ? current : [...current, identity]);
      notify("Visual identity deletion failed");
    }).finally(() => { if (isCurrentContextGeneration(generation, refreshContextGeneration.current)) deletingIdentityKeys.current.delete(identity.key); });
  }

  async function filterByVisualIdentity(identity: GallerySubject) {
    const request = ++identityFilterRequest.current;
    const collection = activeCollection;
    closeSheet();
    setLoading(true);
    setActiveIdentityFilter(identity);
    if (collection) setCollectionSearchResults(undefined);
    try {
      const result = await searchGalleryImages({ identityKey: identity.key, ...(collection ? { collectionKey: collection.key } : {}) });
      if (request !== identityFilterRequest.current || activeCollectionKey.current !== collection?.key) return;
      if (collection) {
        setCollectionSearchResults(result.images);
        setSelectedImageKeys([]);
      } else {
        setActiveSubject(identity);
        setShowingSearchResults(true);
        setImages(result.images);
      }
      setStatus(undefined);
    } catch (error) {
      if (request === identityFilterRequest.current) {
        setActiveIdentityFilter(undefined);
        setStatus(errorMessage(error));
      }
    } finally {
      if (request === identityFilterRequest.current) setLoading(false);
    }
  }

  function clearIdentityFilter() {
    identityFilterRequest.current += 1;
    setActiveIdentityFilter(undefined);
    setCollectionSearchResults(undefined);
    if (activeCollection) void load(activeCollection, true);
  }

  async function exitSubject() {
    identityFilterRequest.current += 1;
    setActiveSubject(undefined);
    setActiveIdentityFilter(undefined);
    setShowingCollectionOverview(true);
    setLoading(true);
    await load(undefined);
  }

  function toggleImageSelection(imageKey: string) {
    if (!selectedImageKeys.includes(imageKey) && selectedImageKeys.length >= 100) {
      setStatus("You can move or copy up to 100 images at once.");
      return;
    }
    setSelectedImageKeys((current) => current.includes(imageKey) ? current.filter((key) => key !== imageKey) : [...current, imageKey]);
  }

  function handleImageLongPress(imageKey: string) {
    const image = images.find(({ key }) => key === imageKey) ?? collectionSearchResults?.find(({ key }) => key === imageKey);
    if (!activeCollection || !canMutateImage(image)) return;
    const marker = { key: imageKey, at: Date.now() };
    longPressedImage.current = marker;
    setTimeout(() => { if (longPressedImage.current === marker) longPressedImage.current = undefined; }, 50);
    toggleImageSelection(imageKey);
    void Haptics.selectionAsync();
  }

  function handleImagePress(image: GalleryImage) {
    const longPress = longPressedImage.current;
    longPressedImage.current = undefined;
    if (longPress?.key === image.key && Date.now() - longPress.at < 1_000) return;
    if (selectedImageKeys.length && canMutateImage(image)) toggleImageSelection(image.key);
    else void showImage(image);
  }

  function openTransfer(mode: CollectionTransferMode) {
    if (!selectedImageKeys.length || !activeCollection) return;
    setTransferMode(mode);
    setDestinationCollectionKey(undefined);
    openSheet("transferDestination");
  }

  async function updateSelectedFavorites() {
    const latest = latestActiveCollection();
    if (!selectedImages.length || !selectedImages.every((image) => canMutateInCollection(image, latest))) return;
    const { isCurrent } = captureGalleryContextGuard();
    const nextFavorite = !selectedImages.every(({ isFavorite }) => isFavorite);
    const previous = [...selectedImages];
    const optimistic = previous.map((image) => ({ ...image, isFavorite: nextFavorite, updatedAt: new Date().toISOString() }));
    setBusy(true);
    replaceVisibleImages(optimistic);
    optimistic.forEach((image) => patchGalleryImage(queryClient, galleryContext, image));
    const outcomes = await Promise.allSettled(previous.map((image) => {
      const request = (favoriteRequests.current.get(image.key) ?? 0) + 1;
      favoriteRequests.current.set(image.key, request);
      const write = (favoriteWrites.current.get(image.key) ?? Promise.resolve()).catch(() => undefined).then(() => {
        if (!isCurrent()) throw new Error("Gallery context changed.");
        return setGalleryImageFavorite(image.key, nextFavorite);
      });
      favoriteWrites.current.set(image.key, write);
      return write.finally(() => {
        if (favoriteWrites.current.get(image.key) === write) favoriteWrites.current.delete(image.key);
      });
    }));
    if (!isCurrent()) return;
    const failed: GalleryImage[] = [];
    const saved: GalleryImage[] = [];
    outcomes.forEach((outcome, index) => {
      const original = previous[index];
      if (!original) return;
      if (outcome.status === "fulfilled") saved.push(outcome.value.image);
      else failed.push(original);
    });
    replaceVisibleImages([...saved, ...failed]);
    saved.forEach((image) => patchGalleryImage(queryClient, galleryContext, image));
    failed.forEach((image) => patchGalleryImage(queryClient, galleryContext, image));
    setSelectedImageKeys(failed.map(({ key }) => key));
    setBusy(false);
    closeSheet();
    void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
    if (failed.length) notify(failed.length === previous.length ? "Favorite update failed" : "Some favorites were not updated");
    else notify(nextFavorite ? "Images favorited" : "Images unfavorited");
  }

  function deleteSelectedImages() {
    const latest = latestActiveCollection();
    if (!selectedImages.length || !selectedImages.every((image) => canMutateInCollection(image, latest)) || busy) return;
    const { isCurrent } = captureGalleryContextGuard();
    const targets = [...selectedImages];
    const keys = targets.map(({ key }) => key);
    const cacheSnapshot = snapshotGalleryOverviews(queryClient, galleryContext);
    const previousImages = images;
    const previousSimilarImages = similarImages;
    const previousSearchResults = collectionSearchResults;
    const previousCollections = collections;
    const previousActiveCollection = activeCollection;
    removeCachedGalleryImages(queryClient, galleryContext, targets);
    setImages((current) => current.filter(({ key }) => !keys.includes(key)));
    setSimilarImages((current) => current.filter(({ key }) => !keys.includes(key)));
    setCollectionSearchResults((current) => current?.filter(({ key }) => !keys.includes(key)));
    if (activeCollection) {
      updateCollectionSingleton((current) => current.map((collection) => collection.key === activeCollection.key ? { ...collection, count: Math.max(0, collection.count - targets.length) } : collection));
      setActiveCollection((current) => current ? { ...current, count: Math.max(0, current.count - targets.length) } : current);
    }
    setBusy(true);
    void deleteGalleryImages(keys).then(() => {
      if (!isCurrent()) return;
      setSelectedImageKeys([]);
      closeSheet();
      notify(targets.length === 1 ? "Image deleted" : "Images deleted");
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      void loadSubjects();
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      setImages(previousImages);
      setSimilarImages(previousSimilarImages);
      setCollectionSearchResults(previousSearchResults);
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(previousActiveCollection);
      notify("Image deletion failed");
    }).finally(() => { if (isCurrent()) setBusy(false); });
  }

  function completeTransfer() {
    if (!activeCollection || !transferMode || !selectedImageKeys.length || !destinationCollectionKey) return;
    const sourceCollection = latestActiveCollection();
    if (!sourceCollection) return;
    const { isCurrent } = captureGalleryContextGuard();
    const mode = transferMode;
    const imageKeys = [...selectedImageKeys];
    const destinationKeys = [destinationCollectionKey];
    const destination = collections.find(({ key }) => key === destinationCollectionKey);
    if (!destination || !sourceCollection.access.canContribute || sourceCollection.role === "viewer" || !destination.access.canContribute || destination.role === "viewer") return;
    const selected = imageKeys.map((key) => images.find((image) => image.key === key) ?? collectionSearchResults?.find((image) => image.key === key) ?? (selectedImage?.key === key ? selectedImage : undefined)).filter((image): image is GalleryImage => Boolean(image));
    if (selected.length !== imageKeys.length || !selected.every((image) => canMutateInCollection(image, sourceCollection))) return;
    const cacheSnapshot = snapshotGalleryOverviews(queryClient, galleryContext);
    const createdDestinationCaches = destinationKeys.filter((key) => queryClient.getQueryData(galleryQueryKeys.overview(galleryContext, key)) === undefined);
    const previousCollections = collections;
    const previousImages = images;
    transferCachedGalleryImages(queryClient, galleryContext, { sourceCollectionKey: sourceCollection.key, destinationCollectionKeys: destinationKeys, images: selected, mode });
    const destinationOverview = queryClient.getQueryData<GalleryOverview>(galleryQueryKeys.overview(galleryContext, destination.key));
    const nextCollections = destinationOverview?.collections ?? collections.map((collection) => {
      if (mode === "move" && collection.key === sourceCollection.key) return { ...collection, count: Math.max(0, collection.count - selected.length) };
      if (destinationKeys.includes(collection.key)) return { ...collection, count: collection.count + selected.length, coverUrl: collection.coverUrl ?? selected[0]?.url ?? null };
      return collection;
    });
    const nextDestination = nextCollections.find(({ key }) => key === destination.key) ?? destination;
    setCachedGalleryCollections(queryClient, galleryContext, nextCollections);
    setCollections(nextCollections);
    setActiveCollection(nextDestination);
    setImages(destinationOverview?.images ?? selected);
    setSelectedImage(undefined);
    setSelectedImageKeys([]);
    setDestinationCollectionKey(undefined);
    setQuery("");
    setCollectionSearchResults(undefined);
    setShowingCollectionOverview(false);
    setShowingSearchResults(false);
    closeSheet();
    setStatus(`${selected.length} image${selected.length === 1 ? "" : "s"} ${mode === "move" ? "moved" : "copied"} to ${destination.name}.`);
    void transferGalleryCollectionImages({ sourceCollectionKey: sourceCollection.key, destinationCollectionKeys: destinationKeys, imageKeys, mode }).then(() => {
      if (!isCurrent()) return;
      notify(mode === "move" ? "Images moved" : "Images copied");
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      void load(nextDestination, true).then((refreshed) => { if (isCurrent() && !refreshed) setStatus("The transfer completed, but the destination could not be refreshed yet."); });
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      for (const collectionKey of createdDestinationCaches) queryClient.removeQueries({ queryKey: galleryQueryKeys.overview(galleryContext, collectionKey), exact: true });
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(sourceCollection);
      setImages(previousImages);
      setStatus(undefined);
      notify(mode === "move" ? "Image move failed" : "Image copy failed");
    });
  }

  async function askAssistant() {
    const message = aiInput.trim();
    if (!message) return;
    const request = ++viewRequest.current;
    const { isCurrent } = captureGalleryContextGuard();
    setAssistantBusy(true);
    setAiInput("");
    try {
      const assistantResult = await askGalleryAssistant(message);
      if (!isCurrent()) return;
      await invalidateAssistantChanges(queryClient, contentContext, assistantResult.changes);
      if (!isCurrent() || request !== viewRequest.current) return;
      if (assistantResult.type === "unsupported") {
        setAiResponse(assistantResult.message);
        return;
      }
      const searchResult = await searchGalleryImages({ query: message, limit: 50 });
      if (!isCurrent() || request !== viewRequest.current) return;
      setActiveCollection(undefined);
      setActiveSubject(undefined);
      setShowingSearchResults(true);
      setAssistantSearchSource(message);
      setSelectedImageKeys([]);
      setImages(searchResult.images);
      setStatus(`${searchResult.images.length} image${searchResult.images.length === 1 ? "" : "s"} found by your Gallery assistant.`);
      setAiResponse(searchResult.images.length > 0 ? `I found ${searchResult.images.length} matching image${searchResult.images.length === 1 ? "" : "s"}.` : assistantResult.message);
    } catch (error) {
      if (isCurrent() && request === viewRequest.current) setAiResponse(errorMessage(error));
    } finally {
      if (isCurrent()) setAssistantBusy(false);
    }
  }

  function resetAfterCollectionAccessLoss(rootOverview: GalleryOverview) {
    viewRequest.current += 1;
    searchRequest.current += 1;
    identityFilterRequest.current += 1;
    closeSheet();
    setSharingOpen(false);
    setPendingInvitesOpen(false);
    setCameraOpen(false);
    setPendingFiles((current) => { deletePreparedFiles(current); return []; });
    setActiveCollection(undefined);
    setActiveSubject(undefined);
    setActiveIdentityFilter(undefined);
    setShowingCollectionOverview(true);
    setShowingSearchResults(false);
    setAssistantSearchSource(undefined);
    setQuery("");
    setSimilarSource(undefined);
    setSimilarImages([]);
    setDuplicateImages([]);
    setCollectionSearchResults(undefined);
    setSelectedImage(undefined);
    setSelectedImageKeys([]);
    setDestinationCollectionKey(undefined);
    setImages(rootOverview.images);
    setNextCursor(rootOverview.nextCursor);
  }

  refreshRunner.current = async (plan, generation) => {
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    try {
      if (plan.has("upload")) await refreshUnresolvedUploadJobs(generation).catch(() => undefined);
      if (!isCurrent()) return;
      const needsIndex = plan.has("root") || plan.has("access");
      const needsOverview = plan.has("current");
      const needsSubjects = plan.has("subjects");
      if (!needsIndex && !needsOverview && !needsSubjects) return;

      let authoritativeCollections = collections;
      let currentCollection = activeCollection;
      let rootOverview: GalleryOverview | undefined;
      if (needsIndex) {
        await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.collections(galleryContext), exact: true, refetchType: "none" });
        const fetchedRoot = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext), queryFn: () => fetchGalleryOverview(), staleTime: 0 });
        if (!isCurrent()) return;
        rootOverview = fetchedRoot;
        authoritativeCollections = fetchedRoot.collections;
        applyCollectionSingleton(authoritativeCollections);
        setCanCreateCollections(fetchedRoot.canCreateCollections);
        const indexState = reconcileGalleryState({ mode: visibleGalleryView.current, activeCollectionKey: activeCollection?.key, selectedImageKeys, destinationCollectionKey, authoritativeImagesComplete: false }, authoritativeCollections, images.map(({ key }) => key));
        currentCollection = indexState.activeCollection;
        if (indexState.accessLost) {
          resetAfterCollectionAccessLoss(fetchedRoot);
          return;
        }
        if (currentCollection) setActiveCollection(currentCollection);
      }

      let refreshedImages = images;
      let currentOverview: (GalleryOverview & { replayReachedEnd?: boolean }) | undefined;
      let imagesComplete = false;
      if (needsOverview) {
        const collectionKey = currentCollection?.key ?? activeCollection?.key;
        const fetchedOverview = await replayOverviewWindow(collectionKey, images.length, generation);
        if (!fetchedOverview || !isCurrent()) return;
        currentOverview = fetchedOverview;
        authoritativeCollections = fetchedOverview.collections;
        applyCollectionSingleton(authoritativeCollections);
        setCanCreateCollections(fetchedOverview.canCreateCollections);
        currentCollection = activeCollection ? authoritativeCollections.find(({ key, access }) => key === activeCollection.key && access.canRead) : undefined;
        if (activeCollection && !currentCollection) {
          const recoveryRoot = collectionKey ? await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext), queryFn: () => fetchGalleryOverview(), staleTime: 0 }) : fetchedOverview;
          if (!isCurrent()) return;
          resetAfterCollectionAccessLoss(recoveryRoot);
          return;
        }
        if (currentCollection) setActiveCollection(currentCollection);
        imagesComplete = fetchedOverview.replayReachedEnd === true;
        refreshedImages = fetchedOverview.images;
        promoteAuthoritativeUploads(fetchedOverview.images);
        setNextCursor(fetchedOverview.nextCursor);
      }

      const mutableImageKeys = new Set<string>();
      const permissionImages = mergeMediaItems(images, mergeMediaItems(collectionSearchResults ?? [], similarImages));
      if (currentCollection?.role === "owner") for (const key of selectedImageKeys) mutableImageKeys.add(key);
      for (const image of permissionImages) if (currentCollection && (currentCollection.role === "owner" || currentCollection.role === "collaborator" && image.createdByKey === currentCollection.memberKey)) mutableImageKeys.add(image.key);
      const detailMutable = Boolean(selectedImage && currentCollection && (currentCollection.role === "owner" || currentCollection.role === "collaborator" && selectedImage.createdByKey === currentCollection.memberKey));
      const permissions = reconcileGalleryPermissions({ role: currentCollection?.role, canContribute: currentCollection?.access.canContribute, activeSheet: activeSheetRef.current, selectedImageKeys, mutableImageKeys, destinationCollectionKey, ownerCapability: !currentCollection && authoritativeCollections.some(({ role, access }) => role === "owner" && access.canManage), detailMutable });
      if (permissions.closeSheet) closeSheet();
      if (activeCollection && (!currentCollection?.access.canContribute || currentCollection.role === "viewer")) {
        setCameraOpen(false);
        setPendingFiles((current) => { deletePreparedFiles(current); return []; });
      }
      setSelectedImageKeys(permissions.selectedImageKeys);
      setDestinationCollectionKey(reconcileGalleryState({ mode: visibleGalleryView.current, activeCollectionKey: currentCollection?.key, selectedImageKeys: [], destinationCollectionKey: permissions.destinationCollectionKey, authoritativeImagesComplete: false }, authoritativeCollections, []).destinationCollectionKey);

      let refreshedSubjects = subjects;
      if (needsSubjects) {
        const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.subjects(galleryContext), queryFn: () => listGallerySubjects(true), staleTime: 0 });
        if (!isCurrent()) return;
        refreshedSubjects = result.subjects;
        setSubjects(refreshedSubjects);
      }
      const refreshedIdentity = activeIdentityFilter ? reconcileSelected(activeIdentityFilter, refreshedSubjects) : undefined;
      const refreshedSubject = activeSubject ? reconcileSelected(activeSubject, refreshedSubjects) : undefined;
      setActiveIdentityFilter(refreshedIdentity);
      setActiveSubject(refreshedSubject);
      if (activeSubject && !refreshedSubject) {
        const normalOverview = await replayOverviewWindow(activeCollection?.key, images.length, generation);
        if (!normalOverview || !isCurrent()) return;
        applyCollectionSingleton(normalOverview.collections);
        setCanCreateCollections(normalOverview.canCreateCollections);
        setShowingSearchResults(false);
        setShowingCollectionOverview(true);
        setAssistantSearchSource(undefined);
        setImages(normalOverview.images);
        setNextCursor(normalOverview.nextCursor);
        setCollectionSearchResults(undefined);
        setStatus("That visual identity is no longer available.");
        return;
      }
      const contextualReplayReachedEnd = currentOverview?.replayReachedEnd === true;

      if (plan.has("search") && similarSource && currentCollection) {
        try {
          const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.search(galleryContext, "similar", currentCollection.key, similarSource.key), queryFn: () => searchGalleryImages({ imageKey: similarSource.key, collectionKey: currentCollection.key, limit: 50 }), staleTime: 0 });
          if (!isCurrent()) return;
          refreshedImages = result.images;
          imagesComplete = contextualReplayReachedEnd;
          setSimilarImages(result.images);
        } catch {
          const recovery = recoverContextualSearchFailure("similar");
          if (!isCurrent() || !recovery.loadNormalView) return;
          setSimilarSource(undefined);
          setSimilarImages([]);
          refreshedImages = currentOverview?.images ?? [];
          imagesComplete = contextualReplayReachedEnd;
          setImages(refreshedImages);
          setStatus("The similar-image source is no longer available.");
        }
      } else if (plan.has("search") && refreshedIdentity) {
        try {
          const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.search(galleryContext, "identity", currentCollection?.key, refreshedIdentity.key), queryFn: () => searchGalleryImages({ identityKey: refreshedIdentity.key, ...(currentCollection ? { collectionKey: currentCollection.key } : {}) }), staleTime: 0 });
          if (!isCurrent()) return;
          refreshedImages = result.images;
          imagesComplete = contextualReplayReachedEnd;
          if (currentCollection) setCollectionSearchResults(result.images);
          else setImages(result.images);
        } catch {
          const recovery = recoverContextualSearchFailure("identity");
          if (!isCurrent() || !recovery.loadNormalView) return;
          setActiveIdentityFilter(undefined);
          setActiveSubject(undefined);
          setShowingSearchResults(false);
          const normalOverview = currentOverview ?? await replayOverviewWindow(currentCollection?.key, images.length, generation);
          if (!normalOverview || !isCurrent()) return;
          refreshedImages = normalOverview.images;
          imagesComplete = normalOverview.replayReachedEnd === true;
          setImages(normalOverview.images);
          setCollectionSearchResults(undefined);
          setNextCursor(normalOverview.nextCursor);
          setStatus("That visual identity is no longer available.");
        }
      } else if (plan.has("search") && query.trim()) {
        const value = query.trim();
        const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.search(galleryContext, "text", currentCollection?.key, value.toLocaleLowerCase()), queryFn: () => searchGalleryImages({ query: value, ...(currentCollection ? { collectionKey: currentCollection.key } : {}), recordHistory: false, limit: 50 }), staleTime: 0 });
        if (!isCurrent()) return;
        refreshedImages = result.images;
        imagesComplete = contextualReplayReachedEnd;
        if (currentCollection) setCollectionSearchResults(result.images);
        else setImages(result.images);
      } else if (plan.has("search") && showingSearchResults && !activeSubject) {
        const recovery = recoverAssistantSearchMode(assistantSearchSource);
        if (recovery.action === "rerun") {
          const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.search(galleryContext, "text", undefined, recovery.query.toLocaleLowerCase()), queryFn: () => searchGalleryImages({ query: recovery.query, recordHistory: false, limit: 50 }), staleTime: 0 });
          if (!isCurrent()) return;
          refreshedImages = result.images;
          imagesComplete = contextualReplayReachedEnd;
          setImages(result.images);
          setStatus(`${result.images.length} image${result.images.length === 1 ? "" : "s"} found by your Gallery assistant.`);
        } else {
          setShowingSearchResults(false);
          setAssistantSearchSource(undefined);
          setImages(currentOverview?.images ?? rootOverview?.images ?? []);
          setStatus(undefined);
        }
      } else if (needsOverview && (!showingSearchResults || currentCollection)) {
        setImages(refreshedImages);
        setCollectionSearchResults(undefined);
      }

      if (activeSheetRef.current === "duplicates" && currentCollection && plan.has("duplicates")) {
        const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.duplicates(galleryContext, currentCollection.key), queryFn: () => findGalleryCollectionDuplicates(currentCollection.key), staleTime: 0 });
        if (!isCurrent()) return;
        setDuplicateImages(result.images);
      }

      if (needsOverview && activeSheetRef.current === "identityPicker" && identityPickerCollection) {
        const pickerCollection = authoritativeCollections.find((collection) => collection.key === identityPickerCollection.key && collection.access.canRead);
        if (!pickerCollection) backIdentityPicker();
        else {
          setIdentityPickerCollection(pickerCollection);
          const pickerOverview = pickerCollection.key === currentCollection?.key && currentOverview && currentOverview.images.length >= identityPickerImages.length
            ? currentOverview
            : await replayOverviewWindow(pickerCollection.key, identityPickerImages.length, generation);
          if (!pickerOverview) return;
          if (!isCurrent()) return;
          setIdentityPickerImages(pickerOverview.images);
          setIdentityPickerNextCursor(pickerOverview.nextCursor);
          if (identityPickerQuery.trim()) await refreshIdentityPickerSearchSilently(identityPickerQuery, pickerCollection, generation);
          else setIdentityPickerSelected((selected) => reconcilePaginatedSelected(selected, pickerOverview.images, pickerOverview.replayReachedEnd === true));
        }
      }

      if (!isCurrent() || !needsOverview) return;
      const availableKeys = refreshedImages.map(({ key }) => key);
      setSelectedImageKeys((current) => reconcileGalleryState({ mode: visibleGalleryView.current, activeCollectionKey: currentCollection?.key, selectedImageKeys: current, authoritativeImagesComplete: imagesComplete }, authoritativeCollections, availableKeys).selectedImageKeys);
      setDestinationCollectionKey((current) => reconcileGalleryState({ mode: visibleGalleryView.current, activeCollectionKey: currentCollection?.key, selectedImageKeys: [], destinationCollectionKey: current, authoritativeImagesComplete: false }, authoritativeCollections, availableKeys).destinationCollectionKey);
      setSelectedImage((current) => {
        const rebound = reconcilePaginatedSelected(current, refreshedImages, imagesComplete);
        if (current && !rebound && (activeSheetRef.current === "image" || activeSheetRef.current === "imageActions" || activeSheetRef.current === "imageEdit" || activeSheetRef.current === "confirmDeleteImage")) closeSheet();
        return rebound;
      });
    } catch {
      // A later stream event or reconnect retries authoritative convergence.
    }
  };

  const activeSubjects = subjects.filter(({ deletedAt }) => deletedAt === null);
  const sheetTitle = activeSheet === "rootActions" ? "New in Gallery"
    : activeSheet === "actions" ? `Add to ${activeCollection?.name ?? "Gallery"}`
    : activeSheet === "destination" ? "Choose destination"
      : activeSheet === "newCollection" ? "New collection"
        : activeSheet === "image" ? selectedImage?.filename ?? selectedOptimisticItem?.filename ?? "Image"
          : activeSheet === "imageActions" ? "Image actions"
            : activeSheet === "confirmDeleteImage" ? "Delete image?"
        : activeSheet === "collectionMenu" ? "Collection actions"
          : activeSheet === "collectionEdit" ? "Edit collection"
             : activeSheet === "confirmDeleteCollection" ? "Delete collection?"
              : activeSheet === "confirmLeaveCollection" ? "Leave collection?"
              : activeSheet === "imageEdit" ? "Edit image"
              : activeSheet === "duplicates" ? "Duplicates"
                : activeSheet === "confirmDeleteDuplicates" ? "Delete duplicates?"
                  : activeSheet === "visualIdentities" ? "Visual identities"
                    : activeSheet === "confirmDeleteIdentity" ? "Delete visual identity?"
                       : activeSheet === "identityPicker" ? imagePickerPurpose === "cover" ? "Choose collection cover" : "Create visual identity"
                        : activeSheet === "identityName" ? "Name visual identity"
                          : activeSheet === "identityPickerFilter" ? "Filter images"
                          : activeSheet === "filter" ? "Filter images"
                            : activeSheet === "searchHistory" ? "Search history"
                              : activeSheet === "bulkActions" ? "Selected image actions"
                                : activeSheet === "bulkDelete" ? "Delete selected images?"
                                  : activeSheet === "transferDestination" ? `${transferMode === "move" ? "Move" : "Copy"} to collection`
                                    : "Gallery";
  const collectionSearchActive = Boolean(activeCollection && query.trim());
  const immediateSearchResults = collectionSearchActive ? filterMediaItems(images, query) : images;
  const unfilteredVisibleImages = similarSource ? similarImages : activeIdentityFilter && activeCollection ? collectionSearchResults ?? [] : collectionSearchActive && collectionSearchResults ? collectionSearchResults : immediateSearchResults;
  const optimisticImageKeys = new Set(optimisticMediaItems.map(({ imageKey }) => imageKey).filter((key): key is string => Boolean(key)));
  const reconciledVisibleImages = unfilteredVisibleImages.filter(({ key }) => !optimisticImageKeys.has(key));
  const visibleImages = showOnlyFavorites ? reconciledVisibleImages.filter(({ isFavorite }) => isFavorite) : reconciledVisibleImages;
  const visibleOptimisticItems = activeCollection && !collectionSearchActive && !similarSource && !showOnlyFavorites
    ? optimisticMediaItems.filter(({ collectionKey }) => collectionKey === activeCollection.key)
    : [];
  const visibleImageGroups = groupGalleryImagesByCreatedDate<GalleryGridItem>([
    ...visibleOptimisticItems.map((item) => ({ kind: "optimistic", key: item.clientKey, createdAt: item.createdAt, item } as const)),
    ...visibleImages.map((image) => ({ kind: "persisted", key: image.key, createdAt: image.createdAt, image } as const)),
  ]);
  const emptyGridMessage = activeSubject
      ? `No images are currently identified as ${activeSubject.name}.`
      : collectionSearchActive || showingSearchResults
        ? "No images matched this search."
        : activeCollection
          ? "No images yet."
          : "Your visual memory starts with the first image.";
  const contextualView = Boolean(activeCollection || activeSubject || showingSearchResults);
  const normalCollectionView = Boolean(activeCollection && !activeSubject);
  const visibleCollections = collections.filter((collection) => collectionTab === "mine" ? collection.role === "owner" : collection.role !== "owner");
  const writableCollections = collections.filter(({ access, role }) => access.canContribute && role !== "viewer");
  const canManageAnyCollection = collections.some(({ access, role }) => access.canManage && role === "owner");
  const identityPickerVisibleCollections = collections.filter(({ isFavorite }) => !showOnlyFavorites || isFavorite);
  const identityPickerVisibleImages = (identityPickerResults ?? identityPickerImages).filter(({ isFavorite }) => !showOnlyFavorites || isFavorite);
  const selectableImages = mergeMediaItems(images, mergeMediaItems(collectionSearchResults ?? [], similarImages));
  if (selectedImage && !selectableImages.some(({ key }) => key === selectedImage.key)) selectableImages.push(selectedImage);
  const selectedImages = selectedImageKeys.map((key) => selectableImages.find((image) => image.key === key)).filter((image): image is GalleryImage => Boolean(image));
  const allSelectedFavorite = selectedImages.length > 0 && selectedImages.every(({ isFavorite }) => isFavorite);
  const bulkToolbar = selectedImageKeys.length ? <Tabs style={styles.bulkToolbar}>
    <View style={styles.bulkToolbarSelection}>
      <Button accessibilityLabel="Clear image selection" contentMode="raw" onPress={() => setSelectedImageKeys([])} size="xs" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button>
      <Text style={styles.bulkSelectionText}>{selectedImageKeys.length} selected</Text>
    </View>
    <Button accessibilityLabel="Selected image actions" contentMode="raw" onPress={() => openSheet("bulkActions")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
  </Tabs> : null;
  const sheetFooter = activeSheet === "newCollection" ? <View style={styles.compactSheetActions}>
      <Button disabled={busy || !canCreateCollections || !newCollectionName.trim()} loading={busy} onPress={() => void createCollectionAndUpload()} size="lg" variant="primary">{pendingFiles.length ? "Create and upload" : "Create collection"}</Button>
      <Button disabled={busy} onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "imageEdit" ? <View style={styles.compactSheetActions}>
      <Button disabled={busy || !editName.trim()} loading={busy} onPress={() => void submitImageEdit()} size="lg" variant="primary">Save</Button>
      <Button disabled={busy} onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "collectionEdit" ? <View style={styles.compactSheetActions}>
      <Button disabled={busy || !editName.trim()} loading={busy} onPress={() => void submitCollectionEdit()} size="lg" variant="primary">Save</Button>
      <Button disabled={busy} onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View>
    : activeSheet === "duplicates" ? <View style={styles.compactSheetActions}>
      <Button disabled={duplicatesLoading || duplicateImages.length === 0} onPress={() => pushSheet("confirmDeleteDuplicates")} size="lg" variant="primary">Delete duplicates</Button>
      <Button disabled={duplicatesLoading} onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "visualIdentities" ? <View style={styles.compactSheetActions}>
      {identityLibraryMode === "browse" ? <Button disabled={identitiesLoading} onPress={() => void openIdentityPicker()} size="lg" variant="primary">Create new</Button> : null}
      <Button onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "identityPicker" ? <View style={styles.compactSheetActions}>
      <Button disabled={!identityPickerSelected} onPress={() => imagePickerPurpose === "cover" ? chooseCollectionCover() : pushSheet("identityName")} size="lg" variant="primary">{imagePickerPurpose === "cover" ? "Choose" : "Next"}</Button>
      <Button onPress={imagePickerPurpose === "cover" ? goBackSheet : closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "identityName" ? <View style={styles.compactSheetActions}>
      <Button disabled={!identityPickerSelected || !identityPickerName.trim()} onPress={() => void createVisualIdentity()} size="lg" variant="primary">Create</Button>
      <Button onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "transferDestination" ? <View style={styles.sheetFooter}>
    <Button disabled={!destinationCollectionKey} onPress={completeTransfer} size="md" style={styles.sheetFooterAction} variant="primary">{transferMode === "move" ? "Move" : "Copy"} {selectedImageKeys.length} image{selectedImageKeys.length === 1 ? "" : "s"}</Button>
    <Button onPress={closeSheet} size="md" style={styles.sheetFooterAction} variant="secondary">Close</Button>
  </View> : activeSheet === "searchHistory" ? <Button disabled={historyLoading} onPress={closeSheet} size="lg" variant="secondary">Close</Button> : undefined;

  return (
    <KeyboardAvoidingView behavior={aiInputFocused ? "height" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher active="gallery" />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: spacing.md }]} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMoreImages(); }} scrollEventThrottle={120} showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {!contextualView && (showingCollectionOverview || loading) ? (
          <View style={styles.galleryRoot}>
            <View style={styles.collectionTitleRow}>
              <WorkspaceAppSwitcher active="gallery" trigger="back" />
              <Text numberOfLines={1} style={styles.collectionTitle}>Gallery</Text>
              <View style={styles.collectionTitleActions}><Button accessibilityLabel="Pending Gallery invites" contentMode="raw" disabled={loading} onPress={() => { closeSheet(); setPendingInvitesOpen(true); }} size="xs" variant="icon"><MailIcon size="sm" /></Button>{canCreateCollections ? <Button accessibilityLabel="Create in Gallery" contentMode="raw" disabled={loading} onPress={() => openSheet("rootActions")} size="xs" variant="icon"><PlusIcon size="sm" /></Button> : null}</View>
            </View>
            {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
            <Tabs accessibilityLabel="Collection ownership" style={styles.collectionTabs}>
              <Button accessibilityState={{ selected: collectionTab === "mine" }} onPress={() => setCollectionTab("mine")} size="sm" style={styles.collectionTab} variant={collectionTab === "mine" ? "primary" : "ghost"}>My collections</Button>
              <Button accessibilityState={{ selected: collectionTab === "shared" }} onPress={() => setCollectionTab("shared")} size="sm" style={styles.collectionTab} variant={collectionTab === "shared" ? "primary" : "ghost"}>Shared collections</Button>
            </Tabs>
            <View style={styles.collectionGrid}>
              {loading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: collectionSize, height: collectionSize }]} />) : visibleCollections.map((collection) => (
                <View key={collection.key} style={[styles.collectionCard, { width: collectionSize, height: collectionSize }]}>
                  {collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={styles.collectionCover} /> : null}
                  <Button accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => { viewRequest.current += 1; setShowingCollectionOverview(false); setLoading(true); setQuery(""); setSelectedImageKeys([]); setActiveSubject(undefined); setShowingSearchResults(false); setActiveCollection(collection); }} size="xl" style={[styles.collectionMain, collection.coverUrl && styles.coveredCollectionMain]} variant="ghost">
                    {collection.coverUrl ? null : <FolderIcon size="lg" />}
                    <Text numberOfLines={1} style={[styles.collectionName, collection.coverUrl && styles.coveredCollectionName]}>{collection.name}</Text>
                  </Button>
                </View>
              ))}
              {!loading && visibleCollections.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyText}>{collectionTab === "shared" ? "No collections have been shared with you." : "No collections here yet."}</Text>{collectionTab === "mine" && canCreateCollections ? <Button accessibilityLabel="Create collection" contentMode="raw" onPress={() => { setPendingFiles([]); setNewCollectionName(""); setNewCollectionFavorite(false); openSheet("newCollection"); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
            </View>
          </View>
        ) : null}

        {activeCollection ? <View style={styles.collectionView}>
          <View style={styles.collectionTitleRow}>
            <Button accessibilityLabel="Back to Gallery collections" contentMode="raw" hitSlop={5} onPress={showCollectionsOverview} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
            <Text numberOfLines={1} style={styles.collectionTitle}>{activeCollection.name}</Text>
            <View style={styles.collectionTitleActions}>
              <Button accessibilityLabel={`Manage ${activeCollection.name}`} contentMode="raw" hitSlop={5} onPress={() => openSheet("collectionMenu")} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
              {canAddImages ? <Button accessibilityLabel={`Add images to ${activeCollection.name}`} contentMode="raw" disabled={busy} hitSlop={5} onPress={() => openSheet("actions")} size="sm" variant="icon"><PlusIcon size="sm" /></Button> : null}
            </View>
          </View>
          <View style={styles.sharingRow}><Button accessibilityLabel={`Sharing and access for ${activeCollection.name}`} contentMode="raw" onPress={() => { closeSheet(); setSharingOpen(true); }} size="sm" variant="icon"><UsersIcon size="sm" /></Button></View>
          {normalCollectionView ? <View style={styles.rootActions}>
            <View style={styles.collectionSearch}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel={`Search images in ${activeCollection.name}`} editable={!collectionSearchFocusBlocked} onChangeText={updateCollectionSearch} onFocus={() => { if (collectionSearchFocusBlocked) { collectionSearchInput.current?.blur(); Keyboard.dismiss(); } }} onSubmitEditing={() => { if (searchTimer.current) clearTimeout(searchTimer.current); void search(); }} placeholder="Search..." ref={collectionSearchInput} returnKeyType="search" style={styles.rootSearchInput} value={query} />
              {query.trim() ? <Button accessibilityLabel="Clear image search" contentMode="raw" hitSlop={8} onPress={() => clearCollectionSearch()} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
            </View>
            <Button accessibilityLabel={`Filter ${activeCollection.name}`} contentMode="raw" onPress={() => openSheet("filter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={showOnlyFavorites ? "accent" : "default"} /></Button>
          </View> : null}
          {bulkToolbar}
          {similarSource ? <View style={styles.similarPill}>
            <Image source={similarSource.url} contentFit="cover" style={styles.similarPillImage} />
            <Text numberOfLines={1} style={styles.similarPillText}>Similar to {similarSource.filename}</Text>
            <Button accessibilityLabel="Close similar image filter" contentMode="raw" onPress={clearSimilarImages} size="xs" variant="icon"><CloseIcon size="sm" /></Button>
          </View> : null}
          {activeIdentityFilter ? <View style={styles.similarPill}>
            <Image source={activeIdentityFilter.referenceUrl} contentFit="cover" style={styles.similarPillImage} />
            <Text numberOfLines={1} style={styles.similarPillText}>{activeIdentityFilter.name}</Text>
            <Button accessibilityLabel="Close visual identity filter" contentMode="raw" onPress={clearIdentityFilter} size="xs" variant="icon"><CloseIcon size="sm" /></Button>
          </View> : null}
          {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
           {loading || searching && visibleImages.length === 0 ? <View accessibilityLabel={searching ? "Searching images" : "Loading images"} accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: imageSize, height: imageSize }]} />)}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 && normalCollectionView ? <View style={styles.emptyState}><Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : similarSource ? "No similar images were found in this collection." : emptyGridMessage}</Text>{collectionSearchActive || showOnlyFavorites || similarSource || !canAddImages ? null : <Button accessibilityLabel={`Upload images to ${activeCollection.name}`} contentMode="raw" onPress={() => void choosePhotos()} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button>}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 ? <Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : emptyGridMessage}</Text> : (
            <View style={styles.imageSections}>
              {visibleImageGroups.map((group) => <View key={group.label} style={styles.dateGroup}>
                <Text style={styles.dateHeading}>{group.label}</Text>
                <View style={styles.grid}>{group.images.map((entry) => entry.kind === "optimistic" ? (
                  <Button key={entry.key} accessibilityLabel={entry.item.filename} contentMode="raw" onPress={() => showOptimisticImage(entry.item)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost">
                    <View style={styles.imageFrame}>
                      <Image source={entry.item.uri} contentFit="cover" style={styles.image} />
                    </View>
                  </Button>
                ) : (
                  <Button key={entry.key} accessibilityLabel={entry.image.caption || entry.image.filename} accessibilityState={{ selected: selectedImageKeys.includes(entry.image.key) }} contentMode="raw" onLongPress={canMutateImage(entry.image) ? () => handleImageLongPress(entry.image.key) : undefined} onPress={() => handleImagePress(entry.image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost">
                    <View style={[styles.imageFrame, selectedImageKeys.includes(entry.image.key) && styles.imageFrameSelected]}>
                      <Image source={entry.image.url} contentFit="cover" style={styles.image} transition={150} />
                      {selectedImageKeys.includes(entry.image.key) ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
                    </View>
                  </Button>
                ))}</View>
              </View>)}
              {loadingMore ? <View style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={`more-${index}`} style={[styles.imageSkeleton, { width: imageSize, height: imageSize }]} />)}</View> : null}
            </View>
          )}
        </View> : contextualView ? <View style={styles.collectionView}>
          <View style={styles.collectionTitleRow}>
            <Button accessibilityLabel="Back to Gallery collections" contentMode="raw" hitSlop={5} onPress={() => { if (activeSubject) void exitSubject(); else showCollectionsOverview(); }} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
            <Text numberOfLines={1} style={styles.collectionTitle}>{activeSubject?.name ?? "Search results"}</Text>
            <Text style={styles.count}>{images.length}</Text>
          </View>
          {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
           {visibleImages.length ? <View style={styles.grid}>{visibleImages.map((image) => <Button key={image.key} accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => handleImagePress(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost"><View style={styles.imageFrame}><Image source={image.url} contentFit="cover" style={styles.image} transition={150} /></View></Button>)}</View> : <View style={styles.emptyState}><Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : emptyGridMessage}</Text></View>}
        </View> : null}
      </ScrollView>

      <CoreComposer
        accessibilityLabel="Ask Core about your Gallery"
        disabled={assistantBusy}
        editable={!assistantBusy}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        loading={assistantBusy}
        message={aiResponse ? <Text numberOfLines={3} style={styles.aiResponse}>{aiResponse}</Text> : null}
        onChangeText={setAiInput}
        onFocusChange={handleCoreFocusChange}
        onSubmit={() => void askAssistant()}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" variant="inverse" />}
        value={aiInput}
      />

      <BottomSheet
        footer={<Button onPress={closeSheet} size="lg" variant="secondary">Close</Button>}
        mutation
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        open={!sharingOpen && !pendingInvitesOpen && sheetOpen && (activeSheet === "image" || activeSheet === "imageActions") && Boolean(selectedImage || selectedOptimisticItem)}
        title={selectedImage?.filename ?? selectedOptimisticItem?.filename ?? "Image"}
      >
        {selectedImage || selectedOptimisticItem ? <View style={styles.detail}>
          <View style={styles.detailMenuRow}>
            {selectedImage ? <Button accessibilityLabel="Open image actions" contentMode="raw" onPress={() => pushSheet("imageActions")} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}
          </View>
          <View style={styles.detailImageFrame}><Image source={selectedImage?.url ?? selectedOptimisticItem?.uri} contentFit="contain" style={styles.detailImage} /></View>
        </View> : null}
      </BottomSheet>

      <BottomSheet
        description={activeSheet === "destination" ? `${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"} ready to upload.` : activeSheet === "transferDestination" ? "Choose one destination collection." : undefined}
        dismissible={!busy}
        footer={sheetFooter}
        hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions"}
        mutation={activeSheet === "imageEdit" || activeSheet === "newCollection" || activeSheet === "collectionEdit" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory"}
        onOpenChange={(open) => { if (!open) { if (activeSheetRef.current === "imageActions") goBackSheet(); else closeSheet(); } }}
        open={!sharingOpen && !pendingInvitesOpen && sheetOpen && activeSheet !== "image"}
        tall={activeSheet === "transferDestination" || activeSheet === "destination" || activeSheet === "searchHistory"}
        title={sheetTitle}
      >
        <ScrollView contentContainerStyle={[styles.sheetContent, activeSheet === "identityName" && styles.fullSheetContent]} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (activeSheet === "identityPicker" && isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMoreIdentityPickerImages(); }} scrollEventThrottle={120} showsVerticalScrollIndicator={false} style={[styles.sheetScroll, activeSheet === "identityName" && styles.fullSheetScroll, { maxHeight: activeSheet === "transferDestination" || activeSheet === "duplicates" || activeSheet === "imageEdit" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" ? undefined : height * 0.6 }]}>
        {activeSheet === "rootActions" ? <>
          {canCreateCollections ? <BottomSheetItem onPress={() => { setPendingFiles([]); setNewCollectionName(""); setNewCollectionFavorite(false); pushSheet("newCollection"); }} size="lg" style={styles.sheetAction} variant="secondary">Create collection</BottomSheetItem> : null}
          {canManageAnyCollection ? <BottomSheetItem onPress={() => void openVisualIdentities("browse")} size="lg" style={styles.sheetAction} variant="secondary">Create visual identity</BottomSheetItem> : null}
        </> : null}
        {activeSheet === "actions" ? <>
          <BottomSheetItem disabled={busy} loading={busy} onPress={() => void choosePhotos()} size="lg" style={styles.sheetAction} variant="secondary">Upload images</BottomSheetItem>
          <BottomSheetItem disabled={busy} loading={busy} onPress={() => void takePhoto()} size="lg" style={styles.sheetAction} variant="secondary">Capture images</BottomSheetItem>
          {isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={() => void openVisualIdentities("browse")} size="lg" style={styles.sheetAction} variant="secondary">Create visual identity</BottomSheetItem> : null}
        </> : null}
        {activeSheet === "destination" ? <>
          <View style={styles.destinationGrid}>{writableCollections.map((collection) => <View key={collection.key} style={[styles.destinationCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}>
            {collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={styles.collectionCover} /> : null}
            <Button accessibilityLabel={`Upload to ${collection.name}`} contentMode="raw" disabled={busy} onPress={() => void uploadTo(collection.key)} shape="rounded" size="xl" style={[styles.collectionMain, collection.coverUrl && styles.coveredCollectionMain]} variant="ghost">
              {collection.coverUrl ? null : <FolderIcon size="lg" />}
              <Text numberOfLines={1} style={[styles.collectionName, collection.coverUrl && styles.coveredCollectionName]}>{collection.name}</Text>
            </Button>
          </View>)}</View>
          {canCreateCollections ? <BottomSheetItem contentMode="raw" onPress={() => { setNewCollectionName(""); setNewCollectionFavorite(false); openSheet("newCollection"); }} size="lg" variant="ghost"><View style={styles.sheetItem}><PlusIcon size="md" /><Text style={styles.sheetText}>New collection</Text></View></BottomSheetItem> : null}
        </> : null}
        {activeSheet === "newCollection" ? <View style={styles.form}>
          <TextInput autoFocus accessibilityLabel="Collection name" editable={!busy} onChangeText={setNewCollectionName} placeholder="Collection name" returnKeyType="done" style={styles.formInput} value={newCollectionName} />
          <View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Favorite collection" checked={newCollectionFavorite} onCheckedChange={setNewCollectionFavorite} /><Text style={styles.favoriteSwitchLabel}>Favorite</Text></View>
        </View> : null}
        {activeSheet === "collectionMenu" ? <>
          {isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={openCollectionEdit} size="lg" style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem> : null}
          {collectionRole !== "viewer" ? <BottomSheetItem disabled={busy} onPress={() => { closeSheet(); setStatus("Long press one of your images to begin selecting, then tap to add more."); }} size="lg" style={styles.sheetAction} variant="secondary">Select images</BottomSheetItem> : null}
          {isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={() => void showDuplicates()} size="lg" style={styles.sheetAction} variant="secondary">Find duplicates</BottomSheetItem> : null}
          {isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={() => void openVisualIdentities("browse")} size="lg" style={styles.sheetAction} variant="secondary">Visual identities</BottomSheetItem> : null}
          {isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={() => pushSheet("confirmDeleteCollection")} size="lg" style={styles.sheetAction} variant="secondary">Delete collection</BottomSheetItem> : <BottomSheetItem disabled={busy} onPress={() => pushSheet("confirmLeaveCollection")} size="lg" style={styles.sheetAction} variant="secondary">Leave</BottomSheetItem>}
        </> : null}
        {activeSheet === "imageActions" && selectedImage ? <View style={styles.actionMenu}>
          {canMutateImage(selectedImage) ? <BottomSheetItem onPress={openImageEdit} style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem> : null}
          {activeCollection ? <BottomSheetItem onPress={() => void findSimilar()} style={styles.sheetAction} variant="secondary">Find similar image</BottomSheetItem> : null}
          {canMutateImage(selectedImage) ? <BottomSheetItem onPress={() => pushSheet("confirmDeleteImage")} style={styles.sheetAction} variant="secondary">Delete image</BottomSheetItem> : null}
        </View> : null}
        {activeSheet === "imageEdit" && selectedImage ? <View style={styles.form}>
          <TextInput accessibilityLabel="Image name" editable={!busy} maxLength={255} onChangeText={setEditName} placeholder="Image name" style={styles.formInput} value={editName} />
          <View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Favorite image" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteSwitchLabel}>Favorite</Text></View>
        </View> : null}
        {activeSheet === "collectionEdit" && activeCollection ? <View style={styles.form}>
          <TextInput accessibilityLabel="Collection name" editable={!busy} maxLength={120} onChangeText={setEditName} placeholder="Collection name" style={styles.formInput} value={editName} />
          <View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Favorite collection" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteSwitchLabel}>Favorite</Text></View>
          <View style={styles.collectionCoverField}>
            <Text style={styles.sheetSubtitle}>Cover</Text>
            <Button accessibilityLabel={editCoverPreviewUrl ? "Change collection cover" : "Choose collection cover"} contentMode="raw" disabled={busy} onPress={() => void openCollectionCoverPicker()} shape="rounded" size="xl" style={styles.collectionCoverButton} variant="secondary">
              {editCoverPreviewUrl ? <Image contentFit="cover" source={editCoverPreviewUrl} style={styles.collectionCover} /> : <FolderIcon size="lg" />}
            </Button>
            {editCoverPreviewUrl ? <Button accessibilityLabel="Clear collection cover" disabled={busy} onPress={() => { setEditCoverImageKey(null); setEditCoverPreviewUrl(null); }} size="sm" variant="secondary">Clear cover</Button> : null}
          </View>
        </View> : null}
        {activeSheet === "confirmDeleteImage" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={deleteSelectedImage} size="lg" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "confirmDeleteCollection" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={() => void removeActiveCollection()} size="lg" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "confirmLeaveCollection" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={() => void leaveActiveCollection()} size="lg" variant="primary">Confirm</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "duplicates" ? <View style={styles.duplicatePanel}>
          {duplicatesLoading ? <View accessibilityLabel="Loading duplicate images" accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View>
            : duplicateImages.length ? <View style={styles.grid}>{duplicateImages.map((image) => <View key={image.key} style={[styles.duplicateCard, { width: sheetImageSize, height: sheetImageSize }]}><Button accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => void showImage(image)} size="xl" style={styles.duplicateImageButton} variant="ghost"><View style={styles.imageFrame}><Image source={image.url} contentFit="cover" style={styles.image} /></View></Button><Button accessibilityLabel={`Keep ${image.filename}`} contentMode="raw" onPress={() => setDuplicateImages((current) => current.filter(({ key }) => key !== image.key))} size="xs" style={styles.thumbnailRemove} variant="icon"><CloseIcon size="sm" /></Button></View>)}</View>
              : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>{duplicatesError ?? "No duplicate images found in this collection."}</Text></View>}
        </View> : null}
        {activeSheet === "filter" ? <View style={styles.filterPanel}>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel={showOnlyFavorites ? "Show all Gallery images" : "Show only favorite Gallery images"} checked={showOnlyFavorites} onCheckedChange={(checked) => { setGalleryShowOnlyFavorites(checked); notify("Filter updated"); closeSheet(); }} />
            <Text style={styles.favoriteSwitchLabel}>{showOnlyFavorites ? "Showing only favorites" : "Showing all"}</Text>
          </View>
          <Button onPress={() => void openVisualIdentities("filter")} size="lg" variant="secondary">Visual identities</Button>
          <Button onPress={() => void openSearchHistory()} size="lg" variant="secondary">Search history</Button>
        </View> : null}
        {activeSheet === "identityPickerFilter" ? <View style={styles.filterPanel}>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel={showOnlyFavorites ? "Show all picker images" : "Show only favorite picker images"} checked={showOnlyFavorites} onCheckedChange={(checked) => { setGalleryShowOnlyFavorites(checked); notify("Filter updated"); }} />
            <Text style={styles.favoriteSwitchLabel}>{showOnlyFavorites ? "Showing only favorites" : "Showing all"}</Text>
          </View>
          <Button onPress={() => void openSearchHistory("identityPicker")} size="lg" variant="secondary">Search history</Button>
        </View> : null}
        {activeSheet === "visualIdentities" ? <View style={styles.identityLibrary}>
          {identityError ? <View accessibilityLiveRegion="polite" style={styles.inlineError}><Text style={styles.inlineErrorText}>{identityError}</Text></View> : null}
          {identitiesLoading || creatingIdentityKeys.length > 0 ? <View accessibilityLabel="Loading visual identities" accessibilityRole="progressbar" style={styles.collectionGrid}>{Array.from({ length: COLLECTION_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: destinationCollectionSize, height: destinationCollectionSize }]} />)}</View>
            : activeSubjects.length ? <View style={styles.collectionGrid}>{activeSubjects.map((identity) => <View key={identity.key} style={[styles.collectionCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}>
              <Image source={identity.referenceUrl} contentFit="cover" style={styles.collectionCover} />
              <Button accessibilityLabel={`${identity.name}, ${identity.imageCount} matching images`} contentMode="raw" disabled={creatingIdentityKeys.includes(identity.key)} onPress={() => void filterByVisualIdentity(identity)} size="xl" style={[styles.collectionMain, styles.coveredCollectionMain]} variant="ghost">
                <Text numberOfLines={1} style={[styles.collectionName, styles.coveredCollectionName]}>{identity.name}</Text>
              </Button>
              {!creatingIdentityKeys.includes(identity.key) ? <Button accessibilityLabel={`Delete visual identity ${identity.name}`} contentMode="raw" onPress={() => confirmDeleteVisualIdentity(identity)} size="xs" style={styles.thumbnailRemove} variant="icon"><CloseIcon size="sm" /></Button> : null}
            </View>)}</View> : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>No visual identities yet.</Text></View>}
        </View> : null}
        {activeSheet === "confirmDeleteIdentity" ? <View style={styles.compactSheetActions}>
          <Button disabled={!identityPendingDelete} onPress={deleteVisualIdentity} size="lg" variant="primary">Delete</Button>
          <Button onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "identityPicker" ? <View style={styles.identityPicker}>
          <Text style={styles.sheetSubtitle}>{imagePickerPurpose === "cover" ? `Choose an existing image from ${activeCollection?.name ?? "this collection"}.` : "Choose an image to create a visual identity from."}</Text>
          {identityPickerCollection ? <View style={styles.destinationLocationLane}><Button accessibilityLabel="Back to collections" contentMode="raw" onPress={backIdentityPicker} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.destinationLocationTitle}>{identityPickerCollection.name}</Text></View> : null}
          <View style={styles.rootActions}>
            <View style={styles.collectionSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search images for visual identity" onChangeText={updateIdentityPickerSearch} placeholder="Search images..." style={styles.rootSearchInput} value={identityPickerQuery} />{identityPickerQuery.trim() ? <Button accessibilityLabel="Clear image search" contentMode="raw" onPress={() => updateIdentityPickerSearch("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}</View>
            <Button accessibilityLabel="Filter visual identity image picker" contentMode="raw" onPress={() => pushSheet("identityPickerFilter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={showOnlyFavorites ? "accent" : "default"} /></Button>
          </View>
          {!identityPickerCollection && !identityPickerQuery.trim() ? <View style={[styles.collectionGrid, !identityPickerLoading && identityPickerVisibleCollections.length === 0 && styles.sheetEmptyContent]}>
            {identityPickerLoading ? Array.from({ length: COLLECTION_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: destinationCollectionSize, height: destinationCollectionSize }]} />) : identityPickerVisibleCollections.map((collection) => <View key={collection.key} style={[styles.collectionCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}>{collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={styles.collectionCover} /> : null}<Button accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => void openIdentityPickerCollection(collection)} size="xl" style={[styles.collectionMain, collection.coverUrl && styles.coveredCollectionMain]} variant="ghost">{collection.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.collectionName, collection.coverUrl && styles.coveredCollectionName]}>{collection.name}</Text></Button></View>)}
            {!identityPickerLoading && identityPickerVisibleCollections.length === 0 ? <Text style={styles.emptyText}>No collections found.</Text> : null}
          </View> : null}
          {identityPickerCollection || identityPickerQuery.trim() ? identityPickerSearching || identityPickerLoading && identityPickerVisibleImages.length === 0 ? <View accessibilityLabel="Loading images" accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View> : identityPickerVisibleImages.length ? <View style={styles.grid}>{identityPickerVisibleImages.map((image) => { const selected = identityPickerSelected?.key === image.key; return <Button key={image.key} accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.filename}`} accessibilityState={{ selected }} contentMode="raw" onPress={() => setIdentityPickerSelected(selected ? undefined : image)} size="xl" style={[styles.imageButton, { width: sheetImageSize, height: sheetImageSize }]} variant="ghost"><View style={[styles.imageFrame, selected && styles.imageFrameSelected]}><Image source={image.url} contentFit="cover" style={styles.image} />{selected ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>; })}{identityPickerLoading ? Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={`picker-more-${index}`} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />) : null}</View> : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>No images found.</Text></View> : null}
        </View> : null}
        {activeSheet === "identityName" && identityPickerSelected ? <View style={styles.identityNameForm}>
          <TextInput autoFocus accessibilityLabel="Visual identity name" maxLength={120} onChangeText={setIdentityPickerName} placeholder="Name" value={identityPickerName} />
          <Button accessibilityLabel="Choose a different visual identity image" contentMode="raw" onPress={goBackSheet} shape="rounded" size="xl" style={styles.identityImageButton} variant="secondary">
            <Image contentFit="cover" source={identityPickerSelected.url} style={styles.identityImage} />
          </Button>
        </View> : null}
        {activeSheet === "searchHistory" ? <ScrollView contentContainerStyle={[styles.searchHistoryList, !historyLoading && history.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false}>
          {historyLoading ? <View accessibilityLabel="Loading search history" accessibilityRole="progressbar" style={styles.searchHistorySkeletons}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.historySkeleton]} />)}</View> : null}
          {!historyLoading && history.length === 0 ? <Text style={styles.emptyText}>No searches saved yet.</Text> : null}
          {!historyLoading ? history.map((item) => <SearchHistoryPill count={item.usageCount} disabled={Boolean(removingHistoryQuery)} key={item.normalizedQuery} onPress={() => applyHistoryQuery(item)} onRemove={() => void removeHistoryQuery(item)} query={item.query} removing={removingHistoryQuery === item.normalizedQuery} />) : null}
        </ScrollView> : null}
        {activeSheet === "bulkActions" ? <View style={styles.actionMenu}>
          <Button disabled={busy} loading={busy} onPress={() => void updateSelectedFavorites()} size="lg" variant="secondary">{allSelectedFavorite ? "Unfavorite" : "Favorite"}</Button>
          <Button disabled={busy || !activeCollection} onPress={() => openTransfer("move")} size="lg" variant="secondary">Move to collection</Button>
          <Button disabled={busy || !activeCollection} onPress={() => openTransfer("copy")} size="lg" variant="secondary">Copy to collection</Button>
          <Button disabled={busy} onPress={() => pushSheet("bulkDelete")} size="lg" variant="secondary">Delete</Button>
        </View> : null}
        {activeSheet === "bulkDelete" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={deleteSelectedImages} size="lg" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "transferDestination" ? <View style={styles.destinationBrowser}>
          <View style={styles.destinationLocationLane}><Text numberOfLines={1} style={styles.destinationLocationTitle}>Gallery</Text></View>
          <View style={[styles.destinationGrid, writableCollections.filter(({ key }) => key !== activeCollection?.key).length === 0 && styles.sheetEmptyContent]}>{writableCollections.filter(({ key }) => key !== activeCollection?.key).map((collection) => {
            const selected = destinationCollectionKey === collection.key;
            return <View key={collection.key} style={[styles.destinationCard, selected && styles.destinationCardSelected, { width: destinationCollectionSize, height: destinationCollectionSize }]}>
              {collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={styles.collectionCover} /> : null}
              <Button accessibilityLabel={`${selected ? "Remove" : "Select"} ${collection.name}`} accessibilityState={{ selected }} contentMode="raw" onPress={() => setDestinationCollectionKey(selected ? undefined : collection.key)} shape="rounded" size="xl" style={[styles.collectionMain, collection.coverUrl && styles.coveredCollectionMain]} variant="ghost">
                {collection.coverUrl ? null : <FolderIcon size="lg" />}
                <Text numberOfLines={1} style={[styles.collectionName, collection.coverUrl && styles.coveredCollectionName]}>{collection.name}</Text>
                {selected ? <View style={styles.destinationBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
              </Button>
            </View>;
          })}
          {writableCollections.filter(({ key }) => key !== activeCollection?.key).length === 0 ? <Text style={styles.emptyText}>No writable destination collections are available.</Text> : null}
          </View>
        </View> : null}
        {activeSheet === "confirmDeleteDuplicates" ? <View style={styles.form}>
          <Button disabled={busy || duplicateImages.length === 0} loading={busy} onPress={() => void deleteDuplicates()} size="lg" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        </ScrollView>
      </BottomSheet>
      {activeCollection ? <GalleryCollectionSharing collection={activeCollection} context={galleryContext} memberKeys={memberKeys} onClose={() => setSharingOpen(false)} open={sharingOpen} /> : null}
      {!activeCollection ? <GalleryPendingInvites context={galleryContext} memberKeys={memberKeys} onAccepted={() => { void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(galleryContext) }); void load(undefined, true); }} onClose={() => setPendingInvitesOpen(false)} open={pendingInvitesOpen} /> : null}
      {cameraOpen ? <GalleryCaptureModal onClose={() => setCameraOpen(false)} onSubmit={uploadCapturedPhotos} /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, justifyContent: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  galleryRoot: { flexGrow: 1, gap: spacing.md },
  rootActions: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8 },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  searchHistoryButton: { width: 44, height: 44 },
  statusCard: { marginBottom: spacing.sm, paddingHorizontal: 13, paddingVertical: 10, borderLeftWidth: 2, borderLeftColor: palette.silver700, borderRadius: radii.md, backgroundColor: palette.panel },
  status: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  collectionView: { flexGrow: 1, gap: spacing.md },
  collectionTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  collectionTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  collectionTitleActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  collectionTabs: { padding: 4, flexDirection: "row", borderWidth: 1, backgroundColor: palette.panel },
  collectionTab: { flex: 1 },
  sharingRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  collectionSearch: { minHeight: 44, flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  bulkToolbar: { minHeight: 40, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  similarPill: { alignSelf: "flex-start", maxWidth: "100%", minHeight: 38, padding: 4, paddingLeft: 5, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, backgroundColor: palette.panel },
  similarPillImage: { width: 28, height: 28, borderRadius: 14, backgroundColor: palette.panelRaised },
  similarPillText: { maxWidth: 210, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  count: { color: palette.silver700, fontFamily: fonts.medium, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  imageSections: { gap: spacing.md },
  dateGroup: { gap: spacing.xs },
  dateHeading: { color: palette.muted, fontFamily: fonts.medium, fontSize: 11 },
  collectionGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: COLLECTION_GAP },
  collectionCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  collectionSkeleton: { backgroundColor: palette.hairlineBright, opacity: 0.72 },
  collectionCover: StyleSheet.absoluteFill,
  collectionMain: { width: "100%", height: "100%", flexDirection: "column", justifyContent: "center", gap: 10, paddingHorizontal: 8 },
  coveredCollectionMain: { justifyContent: "flex-end", paddingBottom: 10, backgroundColor: "rgba(0, 0, 0, 0.16)" },
  collectionName: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  coveredCollectionName: { paddingHorizontal: 5, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: "rgba(0, 0, 0, 0.68)", color: "#FFFFFF" },
  imageButton: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: "transparent" },
  duplicateCard: { position: "relative" },
  duplicateImageButton: { width: "100%", height: "100%", paddingHorizontal: 0, paddingVertical: 0, backgroundColor: "transparent" },
  thumbnailRemove: { position: "absolute", right: 2, top: 2 },
  imageSkeleton: { borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  imageFrame: { width: "100%", height: "100%", overflow: "hidden", borderWidth: 1, borderColor: "transparent", borderRadius: radii.md, backgroundColor: palette.panelRaised },
  imageFrameSelected: { borderColor: palette.silver50, borderWidth: 2 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  image: { width: "100%", height: "100%" },
  emptyState: { flex: 1, width: "100%", minHeight: 360, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
  emptyPlusButton: { width: 44, height: 44 },
  aiResponse: { paddingHorizontal: 14, paddingVertical: 9, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, borderRadius: radii.md, backgroundColor: palette.panel },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { gap: 4, paddingBottom: 4 },
  fullSheetScroll: { flex: 1 },
  fullSheetContent: { flexGrow: 1 },
  sheetText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
  sheetSubtitle: { marginTop: 3, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  actionMenu: { gap: 8 },
  duplicatePanel: { flexGrow: 1, minHeight: 320 },
  duplicateEmpty: { minHeight: 320, alignItems: "center", justifyContent: "center" },
  identityLibrary: { flexGrow: 1, minHeight: 360 },
  identityPicker: { flexGrow: 1, minHeight: 480, gap: spacing.sm },
  identityNameForm: { flexGrow: 1, gap: spacing.lg },
  identityImageButton: { width: 88, height: 88, alignSelf: "flex-start", paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  identityImage: StyleSheet.absoluteFill,
  sheetAction: { justifyContent: "center" },
  destinationBrowser: { flex: 1, minHeight: 0, gap: spacing.sm },
  destinationLocationLane: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  destinationLocationTitle: { flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  destinationGrid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: COLLECTION_GAP, paddingVertical: 4 },
  destinationCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  destinationCardSelected: { borderColor: palette.silver50, borderWidth: 2 },
  destinationBadge: { position: "absolute", top: 6, right: 6, width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: palette.silver50 },
  sheetFooter: { gap: 8 },
  sheetFooterAction: { width: "100%" },
  compactSheetActions: { width: "100%", gap: spacing.sm, padding: 2 },
  filterPanel: { gap: 6 },
  favoriteSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  searchHistoryList: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  sheetEmptyContent: { flexGrow: 1, alignContent: "center", alignItems: "center", justifyContent: "center" },
  searchHistorySkeletons: { gap: spacing.xs },
  historySkeleton: { width: "100%", height: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  subjectList: { gap: 10 },
  listLabel: { marginTop: 8, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  subjectRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10 },
  subjectRowImage: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.panelRaised },
  subjectRowMain: { flex: 1, alignItems: "flex-start" },
  referenceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  referenceOption: { width: 58, height: 58, paddingHorizontal: 0, paddingVertical: 0 },
  referenceOptionMuted: { opacity: 0.42 },
  form: { gap: 14 },
  formInput: { minHeight: 42, fontSize: 14 },
  collectionCoverField: { gap: spacing.xs },
  collectionCoverButton: { width: 96, height: 96, overflow: "hidden", paddingHorizontal: 0, paddingVertical: 0 },
  detail: { flex: 1, gap: 8 },
  detailMenuRow: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  detailImageFrame: { flex: 1, width: "100%", overflow: "hidden", borderRadius: radii.lg, backgroundColor: palette.voidBlack },
  detailImage: { width: "100%", height: "100%", borderRadius: radii.lg },
  detailActions: { flexDirection: "row", gap: 8 },
  detailActionsCompact: { flexDirection: "column" },
  detailAction: { flex: 1 },
  detailActionCompact: { flex: 0, width: "100%" },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(176, 74, 74, 0.45)", backgroundColor: "rgba(176, 74, 74, 0.1)" },
  inlineErrorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
});
