import { Image } from "expo-image";
import { File } from "expo-file-system";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { FlatList, Keyboard, ScrollView, StyleSheet, Text, View, useWindowDimensions, type TextInput as NativeTextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { PullToRefresh } from "@vorinthex/shared/ui/pull-to-refresh";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { BrainIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, FilterIcon, FolderIcon, MemberIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { appendCursorItems, isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { GalleryCaptureModal } from "@/components/capability/GalleryCaptureModal";
import { GalleryCollectionSharing } from "@/components/capability/GalleryCollectionSharing";
import { GalleryHighlights } from "@/components/capability/GalleryHighlights";
import { GalleryMemories } from "@/components/capability/GalleryMemories";
import { GalleryImageGeneration } from "@/components/capability/GalleryImageGeneration";
import { ChromeIcon } from "@/components/ChromeIcon";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { assistantIconSource, contentPresentationIconSource } from "@/data/capability-icons";
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
  findGalleryCollectionDuplicates,
  getGalleryContext,
  getGalleryMemberKey,
  groupGalleryImagesByCreatedDate,
  generateGalleryImages,
  isGalleryClientErrorCode,
  isGalleryCollectionOwned,
  isManagedGalleryCollection,
  isManagedGalleryImage,
  leaveGalleryCollection,
  listGallerySubjects,
  mergeMediaItems,
  partitionFavoriteGalleryImages,
  reconcileGalleryDuplicateDeletion,
  reconcileGalleryImageDeletion,
  searchGalleryCollections,
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
import { filterByHiddenView, hideUserSource, isUserHidden, listUserHiddens, revealUserSource, type HiddenViewFilters, type UserHiddenRecord, type UserHiddenSource } from "@/lib/user-hidden-client";
import { deleteContentSearchHistory, getContentContext, type ContentSearchHistoryItem } from "@/lib/content-client";
import { contentQueryKeys } from "@/lib/content-query-cache";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { compassQueryKeys, galleryQueryKeys, getGalleryCollections, invalidateAssistantChanges, patchGalleryImage, patchGalleryUserHiddens, removeCachedGalleryImages, restoreGalleryOverviews, setCachedGalleryCollections, snapshotGalleryOverviews, transferCachedGalleryImages } from "@/lib/workspace-query-cache";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { normalizeCapturedPng, type CapturedImage } from "@/lib/captured-image";
import { subscribeAppEvent } from "@/lib/app-events";
import { GalleryRefreshCoalescer, galleryRefreshPlan, isCurrentContextGeneration, reconcileGalleryPermissions, reconcileGalleryState, reconcileOptimisticUploads, reconcilePaginatedSelected, reconcileSelected, reconcileUploadJobRegistry, recoverAssistantSearchMode, recoverContextualSearchFailure, replayPaginatedWindow, shouldRunGalleryAssistantTextSearch, type GalleryRefreshFamily, type GalleryRefreshPlan } from "@/lib/gallery-convergence";
import { addGalleryGenerationPlaceholder, galleryGenerationHistoryQueryKey, prependGeneratedGalleryImages, prependGeneratedGalleryImagesToCache, removeGalleryGenerationPlaceholder, type GalleryGenerationPlaceholder } from "@/lib/gallery-generation-cache";

type GallerySheet = "rootActions" | "actions" | "destination" | "newCollection" | "image" | "imageActions" | "imageEdit" | "confirmDeleteImage" | "collectionMenu" | "collectionEdit" | "confirmDeleteCollection" | "confirmLeaveCollection" | "similar" | "duplicates" | "confirmDeleteDuplicates" | "cleanupMenu" | "cleanup" | "confirmCleanupDelete" | "visualIdentities" | "confirmDeleteIdentity" | "identityPicker" | "identityName" | "identityPickerFilter" | "transferDestination" | "filter" | "searchHistory" | "bulkActions" | "bulkDelete";
type ImagePickerPurpose = "identity" | "cover";
type CollectionTransferMode = "copy" | "move";
type OptimisticMediaItem = PreparedGalleryUpload & { batchKey: string; collectionKey: string; createdAt: string; imageKey?: string };
type UnresolvedUploadJob = { uploadKey: string; imageKey: string; clientKey: string; collectionKey: string; batchKey?: string; file: PreparedGalleryUpload };
type GalleryGridItem =
  | { kind: "optimistic"; key: string; createdAt: string; item: OptimisticMediaItem }
  | { kind: "generation"; key: string; createdAt: string; requestKey: string }
  | { kind: "persisted"; key: string; createdAt: string; image: GalleryImage };
type CleanupPage = { images: GalleryImage[]; nextCursor: string | null };
const COLLECTION_COLUMNS = 3;
const IMAGE_COLUMNS = 4;
const GRID_GAP = 5;
const COLLECTION_GAP = 10;
const CLEANUP_THRESHOLDS = [10, 25, 50, 75, 90] as const;
const DELETE_IMAGE_CHUNK_SIZE = 100;
const collectionMembershipRole = (collection: GalleryCollection) => isGalleryCollectionOwned(collection) ? "owner" : collection.role === "owner" ? collection.access.canContribute ? "collaborator" : "viewer" : collection.role;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const collectionHasCover = (collection: GalleryCollection) => Boolean(collection.presentation || collection.coverUrl);
function CollectionCover({ collection }: { collection: GalleryCollection }) {
  if (collection.presentation) return <Image accessibilityLabel={`${collection.name} app collection`} contentFit="contain" source={contentPresentationIconSource[collection.presentation]} style={styles.managedCollectionLogo} />;
  return collection.coverUrl ? <Image contentFit="cover" source={collection.coverUrl} style={styles.collectionCover} /> : null;
}
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

export function GalleryWorkspace({ initialCollectionKey, initialImageKey, returnSignalConnectorKey, returnSignalMessageKey, returnSignalThreadKey, returnTripKey, returnTripName }: { initialCollectionKey?: string; initialImageKey?: string; returnSignalConnectorKey?: string; returnSignalMessageKey?: string; returnSignalThreadKey?: string; returnTripKey?: string; returnTripName?: string } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const notify = (title: string) => showToast({ title, duration: 2_000 });
  const galleryContext = getGalleryContext();
  const contentContext = getContentContext();
  const invalidateCompassTrips = () => queryClient.invalidateQueries({ queryKey: compassQueryKeys.trips(galleryContext), exact: true });
  const userHiddensQuery = useQuery({ queryKey: galleryQueryKeys.userHiddens(galleryContext), queryFn: listUserHiddens, staleTime: 0 });
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [collections, setCollections] = useState<GalleryCollection[]>([]);
  const [viewFilters, setViewFilters] = useState<HiddenViewFilters>({ favoritesOnly: false, showHidden: false });
  const [userHiddens, setUserHiddens] = useState<UserHiddenRecord[]>([]);
  const [canCreateCollections, setCanCreateCollections] = useState(false);
  const [collectionTab, setCollectionTab] = useState<"mine" | "shared">("mine");
  const [imageOrigin, setImageOrigin] = useState<"uploaded" | "generated">("uploaded");
  const [sharingOpen, setSharingOpen] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationPlaceholders, setGenerationPlaceholders] = useState<GalleryGenerationPlaceholder[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [activeCollection, setActiveCollection] = useState<GalleryCollection>();
  const initialCollectionOpened = useRef<string | undefined>(undefined);
  const initialImageOpened = useRef<string | undefined>(undefined);
  const initialImageRequest = useRef(0);
  const initialImageLoading = useRef<string | undefined>(undefined);
  const [showingCollectionOverview, setShowingCollectionOverview] = useState(true);
  const [subjects, setSubjects] = useState<GallerySubject[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
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
  const [imageViewerSize, setImageViewerSize] = useState({ width: 0, height: 0 });
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([]);
  const [similarSource, setSimilarSource] = useState<GalleryImage>();
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState<string>();
  const [duplicateImages, setDuplicateImages] = useState<GalleryImage[]>([]);
  const [duplicateSelectedImageKeys, setDuplicateSelectedImageKeys] = useState<string[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string>();
  const [cleanupThreshold, setCleanupThreshold] = useState<(typeof CLEANUP_THRESHOLDS)[number]>(50);
  const [cleanupImages, setCleanupImages] = useState<GalleryImage[]>([]);
  const [cleanupSelectedImageKeys, setCleanupSelectedImageKeys] = useState<string[]>([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupLoadingMore, setCleanupLoadingMore] = useState(false);
  const [cleanupError, setCleanupError] = useState<string>();
  const [pendingFiles, setPendingFiles] = useState<PreparedGalleryUpload[]>([]);
  const [activeSheet, setActiveSheet] = useState<GallerySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [query, setQuery] = useState("");
  const [rootSearchQuery, setRootSearchQuery] = useState("");
  const [rootSearchResults, setRootSearchResults] = useState<GalleryCollection[]>();
  const [rootSearching, setRootSearching] = useState(false);
  const [collectionSearchResults, setCollectionSearchResults] = useState<GalleryImage[]>();
  const [optimisticMediaItems, setOptimisticMediaItems] = useState<OptimisticMediaItem[]>([]);
  const [showingSearchResults, setShowingSearchResults] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
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
  const [collectionSearchFocusBlocked, setCollectionSearchFocusBlocked] = useState(false);
  const [searching, setSearching] = useState(false);
  const [userRefreshing, setUserRefreshing] = useState(false);
  const viewRequest = useRef(0);
  const backgroundLoadRequest = useRef(0);
  const searchRequest = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const favoritePageRequest = useRef<string | undefined>(undefined);
  const searchFocusReleaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const collectionSearchInput = useRef<NativeTextInput>(null);
  const rootSearchInput = useRef<NativeTextInput>(null);
  const rootSearchRequest = useRef<AbortController | undefined>(undefined);
  const activeSearch = useRef<string | undefined>(undefined);
  const activeSheetRef = useRef<GallerySheet | undefined>(undefined);
  const sheetStack = useRef<GallerySheet[]>([]);
  const historyGeneration = useRef(0);
  const historyTarget = useRef<"gallery" | "root" | "identityPicker">("gallery");
  const identityPickerRequest = useRef(0);
  const identityFilterRequest = useRef(0);
  const subjectsRequest = useRef(0);
  const deletingIdentityKeys = useRef(new Set<string>());
  const deletedIdentityKeys = useRef(new Set<string>());
  const identityPickerSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const identityPickerHistoryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const imageSheetRequest = useRef(0);
  const similarRequest = useRef(0);
  const duplicatesRequest = useRef(0);
  const cleanupRequest = useRef(0);
  const cleanupCollectionKeyRef = useRef<string | undefined>(undefined);
  const cleanupThresholdRef = useRef<(typeof CLEANUP_THRESHOLDS)[number]>(50);
  const cleanupCursorRef = useRef<string | null>(null);
  const cleanupLoadingRef = useRef(false);
  const cleanupLoadingMoreRef = useRef(false);
  const selectedOptimisticItemRef = useRef<OptimisticMediaItem | undefined>(undefined);
  const favoriteRequests = useRef(new Map<string, number>());
  const favoriteWrites = useRef(new Map<string, Promise<{ image: GalleryImage }>>());
  const activeCollectionKey = useRef<string | undefined>(undefined);
  const activeImageOrigin = useRef(imageOrigin);
  const visibleGalleryView = useRef<"root" | "collection" | "search" | "duplicates" | "contextual">("root");
  const longPressedImage = useRef<{ key: string; at: number } | undefined>(undefined);
  const cameraContextGeneration = useRef(0);
  const unresolvedUploadJobs = useRef(new Map<string, UnresolvedUploadJob>());
  const refreshCoalescer = useRef(new GalleryRefreshCoalescer());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshRunning = useRef(false);
  const collectionDeletionRefresh = useRef<Promise<void>>(Promise.resolve());
  const refreshContextGeneration = useRef(0);
  const refreshContextKey = useRef(`${galleryContext.organizationKey}:${galleryContext.scopeKey}`);
  const busyRef = useRef(busy);
  const refreshRunner = useRef<(plan: GalleryRefreshPlan, generation: number, isViewCurrent?: () => boolean) => Promise<void>>(async () => undefined);
  const refreshViewKey = useRef("");
  busyRef.current = busy;
  activeCollectionKey.current = activeCollection?.key;
  activeImageOrigin.current = imageOrigin;
  visibleGalleryView.current = activeCollection
    ? query.trim() ? "search" : "collection"
    : activeSubject || showingSearchResults ? "contextual" : "root";
  refreshViewKey.current = JSON.stringify([activeCollection?.key, imageOrigin, visibleGalleryView.current, collectionTab, query.trim(), rootSearchQuery.trim(), activeSubject?.key, activeIdentityFilter?.key]);

  const contentWidth = width - spacing.md * 2;
  const collectionSize = Math.floor((contentWidth - COLLECTION_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const destinationCollectionSize = Math.floor((width - 42 - COLLECTION_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const imageSize = Math.floor((contentWidth - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);
  const sheetImageSize = Math.floor((width - 42 - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);
  const collectionRole = activeCollection ? collectionMembershipRole(activeCollection) : undefined;
  const managedCollection = isManagedGalleryCollection(activeCollection);
  const isCollectionOwner = Boolean(activeCollection && isGalleryCollectionOwned(activeCollection));
  const canAddImages = Boolean(activeCollection?.access?.canContribute && collectionRole !== "viewer");
  const memberKeys = [...new Set([getGalleryMemberKey(), ...collections.map(({ memberKey }) => memberKey)].filter(Boolean))];
  const canMutateImage = (image: GalleryImage | undefined) => Boolean(image && !managedCollection && !isManagedGalleryImage(image) && (activeCollection
    ? isCollectionOwner || collectionRole === "collaborator" && image.createdByKey === activeCollection.memberKey
    : false));
  const latestActiveCollection = () => activeCollection ? collections.find(({ key }) => key === activeCollection.key) : undefined;
  const canMutateInCollection = (image: GalleryImage | undefined, collection: GalleryCollection | undefined) => Boolean(image && collection && !isManagedGalleryCollection(collection) && !isManagedGalleryImage(image) && (isGalleryCollectionOwned(collection) || collectionMembershipRole(collection) === "collaborator" && image.createdByKey === collection.memberKey));
  const showOnlyFavorites = viewFilters.favoritesOnly;
  const showHidden = viewFilters.showHidden;
  const filtersActive = showOnlyFavorites || showHidden;
  const hidden = (source: UserHiddenSource, sourceKey: string) => isUserHidden(userHiddens, source, sourceKey);
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

  function refreshCollectionSingletonAfterImageDeletion(generation: number) {
    const refresh = collectionDeletionRefresh.current.catch(() => undefined).then(async () => {
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.collections(galleryContext), exact: true, refetchType: "none" });
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      const loaded = await loadCollectionSingleton(generation);
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      setActiveCollection((current) => current ? loaded.find(({ key }) => key === current.key) ?? current : current);
    });
    collectionDeletionRefresh.current = refresh;
    return refresh;
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
    initialCollectionOpened.current = undefined;
    initialImageOpened.current = undefined;
    initialImageRequest.current += 1;
    initialImageLoading.current = undefined;
    refreshCoalescer.current.reset();
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = undefined;
    refreshRunning.current = false;
    viewRequest.current += 1;
    backgroundLoadRequest.current += 1;
    searchRequest.current += 1;
    identityPickerRequest.current += 1;
    subjectsRequest.current += 1;
    similarRequest.current += 1;
    duplicatesRequest.current += 1;
    cleanupRequest.current += 1;
    cleanupCollectionKeyRef.current = undefined;
    cleanupCursorRef.current = null;
    cleanupLoadingRef.current = false;
    cleanupLoadingMoreRef.current = false;
    favoriteRequests.current.clear();
    favoriteWrites.current.clear();
    unresolvedUploadJobs.current.clear();
    deletingIdentityKeys.current.clear();
    deletedIdentityKeys.current.clear();
    closeSheet();
    setSharingOpen(false);
    setHighlightsOpen(false);
    setMemoriesOpen(false);
    setGenerationOpen(false);
    setGenerationPlaceholders([]);
    setCameraOpen(false);
    setPendingFiles((current) => { deletePreparedFiles(current); return []; });
    setOptimisticMediaItems((current) => { deletePreparedFiles(current); return []; });
    setCollections([]);
    setRootSearchQuery("");
    setRootSearchResults(undefined);
    setRootSearching(false);
    rootSearchRequest.current?.abort();
    setViewFilters({ favoritesOnly: false, showHidden: false });
    setUserHiddens([]);
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
    setDuplicateImages([]);
    setDuplicateSelectedImageKeys([]);
    setCleanupImages([]);
    setCleanupSelectedImageKeys([]);
    setCleanupLoading(false);
    setCleanupLoadingMore(false);
    setCleanupError(undefined);
    setDestinationCollectionKey(undefined);
    setBusy(false);
    setAssistantBusy(false);
    setLoading(true);
  }, [galleryContext.organizationKey, galleryContext.scopeKey]);

  useEffect(() => { if (userHiddensQuery.data) setUserHiddens(userHiddensQuery.data); }, [userHiddensQuery.data]);

  useEffect(() => {
    if (!initialCollectionKey || initialCollectionOpened.current === initialCollectionKey) return;
    const collection = collections.find(({ key }) => key === initialCollectionKey);
    if (!collection) return;
    initialCollectionOpened.current = initialCollectionKey;
    viewRequest.current += 1;
    setShowingCollectionOverview(false);
    setImageOrigin("uploaded");
    setQuery("");
    setSelectedImageKeys([]);
    setActiveSubject(undefined);
    setShowingSearchResults(false);
    setActiveCollection(collection);
  }, [collections, initialCollectionKey]);

  useEffect(() => {
    if (!initialImageKey || initialImageOpened.current === initialImageKey || activeCollection?.key !== initialCollectionKey) return;
    const routeKey = `${initialCollectionKey ?? "root"}:${initialImageKey}`;
    const openInitialImage = (image: GalleryImage) => {
      initialImageOpened.current = initialImageKey;
      setImages((current) => appendCursorItems(current, [image], ({ key }) => key));
      setSelectedImage(image);
      openSheet("image");
    };
    const loaded = images.find(({ key }) => key === initialImageKey);
    if (loaded) {
      openInitialImage(loaded);
      return;
    }
    if (initialImageLoading.current === routeKey) return;
    initialImageLoading.current = routeKey;
    const request = ++initialImageRequest.current;
    const generation = refreshContextGeneration.current;
    void queryClient.fetchQuery({
      queryKey: galleryQueryKeys.image(galleryContext, initialCollectionKey, initialImageKey),
      queryFn: () => searchGalleryImages({ imageKey: initialImageKey, ...(initialCollectionKey ? { collectionKey: initialCollectionKey } : {}) }),
      staleTime: 0,
    }).then(({ images: results }) => {
      if (request !== initialImageRequest.current || generation !== refreshContextGeneration.current) return;
      const image = results.find(({ key }) => key === initialImageKey);
      if (image) openInitialImage(image);
      else setStatus("This image is no longer available.");
    }).catch((error: unknown) => {
      if (request === initialImageRequest.current && generation === refreshContextGeneration.current) setStatus(errorMessage(error));
    }).finally(() => {
      if (request === initialImageRequest.current) initialImageLoading.current = undefined;
    });
  }, [activeCollection?.key, images, initialCollectionKey, initialImageKey, queryClient]);

  const returnToTripAssets = returnTripKey ? () => router.replace({ pathname: "/capability/[slug]", params: { slug: "compass", tripKey: returnTripKey, openTripAssets: "1" } }) : undefined;
  const returnToSignalAttachments = returnSignalConnectorKey && returnSignalThreadKey && returnSignalMessageKey ? () => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: returnSignalConnectorKey, signalReturn: "root", signalThreadKey: returnSignalThreadKey, signalMessageKey: returnSignalMessageKey, openSignalAttachments: "1" } }) : undefined;

  function setHiddenOptimistically(source: "collection" | "image", sourceKey: string, shouldHide: boolean, label: "Collection" | "Image") {
    const previous = userHiddens;
    const optimistic: UserHiddenRecord = { key: `optimistic-${source}-${sourceKey}`, userKey: "optimistic", source, sourceKey, createdAt: new Date().toISOString() };
    const next = shouldHide
      ? [...previous.filter((record) => record.source !== source || record.sourceKey !== sourceKey), optimistic]
      : previous.filter((record) => record.source !== source || record.sourceKey !== sourceKey);
    setUserHiddens(next);
    patchGalleryUserHiddens(queryClient, galleryContext, () => next);
    closeSheet();
    notify(`${label} ${shouldHide ? "hidden" : "revealed"}`);
    void (shouldHide ? hideUserSource(source, sourceKey) : revealUserSource(source, sourceKey)).then((result) => {
      if (shouldHide && result) {
        setUserHiddens((current) => current.map((record) => record.key === optimistic.key ? result : record));
        patchGalleryUserHiddens(queryClient, galleryContext, (current) => current.map((record) => record.key === optimistic.key ? result : record));
      }
    }).catch(() => {
      setUserHiddens(previous);
      patchGalleryUserHiddens(queryClient, galleryContext, () => previous);
      notify(`${label} ${shouldHide ? "hide" : "reveal"} failed`);
    }).finally(() => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: galleryQueryKeys.userHiddens(galleryContext), exact: true }),
        queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext), refetchType: "none" }),
        queryClient.invalidateQueries({ queryKey: galleryQueryKeys.collections(galleryContext), exact: true, refetchType: "none" }),
      ]);
    });
  }

  async function load(collection = activeCollection, silent = false, origin = imageOrigin) {
    const request = silent ? ++backgroundLoadRequest.current : ++viewRequest.current;
    const expectedView = visibleGalleryView.current;
    const isCurrent = () => silent
      ? request === backgroundLoadRequest.current && activeCollectionKey.current === collection?.key && (!collection || activeImageOrigin.current === origin) && visibleGalleryView.current === expectedView
      : request === viewRequest.current && (!collection || activeImageOrigin.current === origin);
    if (!silent) setLoading(true);
    try {
      const overview = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collection?.key, collection ? origin : undefined), queryFn: () => fetchGalleryOverview(collection?.key, undefined, 100, undefined, undefined, collection ? origin : undefined) });
      if (!isCurrent()) return false;
      applyCollectionSingleton(overview.collections);
      setCanCreateCollections(overview.canCreateCollections);
      setImages(overview.images);
      if (collection && origin === "uploaded") promoteAuthoritativeUploads(overview.images);
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

  function showImageOrigin(next: "uploaded" | "generated") {
    if (next === imageOrigin) return;
    viewRequest.current += 1;
    backgroundLoadRequest.current += 1;
    searchRequest.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    activeSearch.current = undefined;
    setQuery("");
    setCollectionSearchResults(undefined);
    setSelectedImageKeys([]);
    setNextCursor(null);
    setStatus(undefined);
    setLoading(true);
    setImageOrigin(next);
  }

  useEffect(() => {
    if (showingSearchResults || activeSubject) return;
    const request = ++viewRequest.current;
    const origin = imageOrigin;
    void queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, activeCollection?.key, activeCollection ? origin : undefined), queryFn: () => fetchGalleryOverview(activeCollection?.key, undefined, 100, undefined, undefined, activeCollection ? origin : undefined) }).then((overview) => {
      if (request !== viewRequest.current || activeCollection && activeImageOrigin.current !== origin) return;
      applyCollectionSingleton(overview.collections);
      setCanCreateCollections(overview.canCreateCollections);
      setImages(overview.images);
      if (activeCollection && origin === "uploaded") promoteAuthoritativeUploads(overview.images);
      setNextCursor(overview.nextCursor);
      setCollectionSearchResults(undefined);
      setStatus(undefined);
    }).catch((error: unknown) => { if (request === viewRequest.current && (!activeCollection || activeImageOrigin.current === origin)) setStatus(errorMessage(error)); }).finally(() => { if (request === viewRequest.current && (!activeCollection || activeImageOrigin.current === origin)) setLoading(false); });
  }, [activeCollection?.key, activeSubject?.key, showingSearchResults, galleryContext.organizationKey, galleryContext.scopeKey, imageOrigin, queryClient]);

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

  function invalidateCleanupLoad(clearImages = true) {
    const collectionKey = cleanupCollectionKeyRef.current;
    const invalidation = collectionKey
      ? queryClient.invalidateQueries({ queryKey: galleryQueryKeys.cleanups(galleryContext, collectionKey), refetchType: "none" })
      : Promise.resolve();
    cleanupRequest.current += 1;
    cleanupCursorRef.current = null;
    cleanupLoadingRef.current = false;
    cleanupLoadingMoreRef.current = false;
    setCleanupLoading(false);
    setCleanupLoadingMore(false);
    if (clearImages) {
      setCleanupImages([]);
      setCleanupSelectedImageKeys([]);
    }
    return invalidation;
  }

  useEffect(() => subscribeAppEvent((event) => {
    if (event.type === "inbox.changed") return;
    const plan = galleryRefreshPlan(event.type === "event-stream.connected" ? "reconnect" : event.slug);
    if (!busyRef.current && (plan.has("access") || plan.has("cleanup")) && (activeSheetRef.current === "cleanup" || activeSheetRef.current === "confirmCleanupDelete")) invalidateCleanupLoad();
    scheduleGalleryRefresh(plan);
  }), []);

  useEffect(() => {
    if (!busy && refreshCoalescer.current.hasPending) scheduleGalleryRefresh(new Set());
  }, [busy]);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  async function loadMoreImages() {
    if (!activeCollection || !nextCursor || loading || loadingMore || query.trim()) return;
    const collectionKey = activeCollection.key;
    const origin = imageOrigin;
    const cursor = nextCursor;
    setLoadingMore(true);
    try {
      const page = await fetchGalleryOverview(collectionKey, cursor, 100, undefined, undefined, origin);
      if (activeCollectionKey.current !== collectionKey || activeImageOrigin.current !== origin) return;
      applyCollectionSingleton(page.collections);
      setCanCreateCollections(page.canCreateCollections);
      setImages((current) => appendCursorItems(current, page.images, ({ key }) => key));
      setNextCursor(page.nextCursor);
      queryClient.setQueryData<GalleryOverview>(galleryQueryKeys.overview(galleryContext, collectionKey, origin), (current) => current ? {
        ...page,
        images: appendCursorItems(current.images, page.images, ({ key }) => key),
      } : page);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      if (activeCollectionKey.current === collectionKey && activeImageOrigin.current === origin) setLoadingMore(false);
    }
  }

  async function generateImages(input: Parameters<typeof generateGalleryImages>[0], requestKey: string) {
    const generation = refreshContextGeneration.current;
    const placeholder = { collectionKey: input.collectionKey, count: input.count, createdAt: new Date().toISOString(), requestKey };
    setGenerationPlaceholders((current) => addGalleryGenerationPlaceholder(current, placeholder));
    if (activeCollectionKey.current === input.collectionKey) showImageOrigin("generated");
    try {
      const generated = await generateGalleryImages(input, requestKey);
      if (!isCurrentContextGeneration(generation, refreshContextGeneration.current)) return;
      setGenerationPlaceholders((current) => removeGalleryGenerationPlaceholder(current, requestKey));
      prependGeneratedGalleryImagesToCache(queryClient, galleryContext, input.collectionKey, generated);
      if (activeCollectionKey.current === input.collectionKey) {
        viewRequest.current += 1;
        setImageOrigin("generated");
        setImages((current) => activeImageOrigin.current === "generated" ? prependGeneratedGalleryImages(current, generated) : generated);
        setNextCursor(null);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overview(galleryContext, input.collectionKey, "generated"), exact: true }),
        queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overview(galleryContext), exact: true, refetchType: "none" }),
        queryClient.invalidateQueries({ queryKey: galleryQueryKeys.collections(galleryContext), exact: true, refetchType: "none" }),
        queryClient.invalidateQueries({ queryKey: galleryGenerationHistoryQueryKey(galleryContext), exact: true, refetchType: "none" }),
      ]);
      if (activeCollectionKey.current === input.collectionKey) void load(activeCollection, true, "generated");
    } catch (error) {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current)) {
        const message = errorMessage(error);
        setStatus(message);
        notify(message);
      }
    } finally {
      if (isCurrentContextGeneration(generation, refreshContextGeneration.current)) setGenerationPlaceholders((current) => removeGalleryGenerationPlaceholder(current, requestKey));
    }
  }
  const loadMoreFavoriteImages = useEffectEvent(loadMoreImages);
  useEffect(() => {
    if (!showOnlyFavorites || loading) {
      favoritePageRequest.current = undefined;
      return;
    }
    if (!activeCollection || !nextCursor || loadingMore || query.trim() || activeSubject || showingSearchResults) return;
    const request = `${activeCollection.key}:${nextCursor}`;
    if (favoritePageRequest.current === request) return;
    favoritePageRequest.current = request;
    void loadMoreFavoriteImages();
  }, [activeCollection?.key, activeSubject?.key, loading, loadingMore, nextCursor, query, showOnlyFavorites, showingSearchResults]);

  async function loadSubjects(silent = false) {
    const request = ++subjectsRequest.current;
    setIdentitiesLoading(true);
    try {
      const loaded = (await listGallerySubjects()).subjects;
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
    const value = query.trim();
    if (activeSubject || !value) {
      return;
    }
    searchTimer.current = setTimeout(() => { void search(value, activeCollection); }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [activeCollection?.key, activeSubject?.key, query]);

  useEffect(() => {
    const normalized = rootSearchQuery.trim();
    rootSearchRequest.current?.abort();
    if (!normalized) {
      setRootSearching(false);
      setRootSearchResults(undefined);
      return;
    }
    setRootSearchResults(undefined);
    const controller = new AbortController();
    rootSearchRequest.current = controller;
    const timeout = setTimeout(() => {
      setRootSearching(true);
      setStatus(undefined);
      void searchGalleryCollections(normalized, false, controller.signal).then(({ collections: matches }) => {
        if (!controller.signal.aborted) setRootSearchResults(matches);
      }).catch((cause) => {
        if (!controller.signal.aborted) setStatus(errorMessage(cause));
      }).finally(() => {
        if (!controller.signal.aborted) setRootSearching(false);
      });
    }, 300);
    const historyTimeout = setTimeout(() => {
      void searchGalleryCollections(normalized, true, controller.signal).catch(() => undefined);
    }, 800);
    return () => {
      clearTimeout(timeout);
      clearTimeout(historyTimeout);
      controller.abort();
    };
  }, [rootSearchQuery]);

  useEffect(() => () => {
    if (identityPickerSearchTimer.current) clearTimeout(identityPickerSearchTimer.current);
    if (identityPickerHistoryTimer.current) clearTimeout(identityPickerHistoryTimer.current);
  }, []);

  useEffect(() => () => {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
  }, []);

  function handleCoreFocusChange(focused: boolean) {
    if (searchFocusReleaseTimer.current) clearTimeout(searchFocusReleaseTimer.current);
    if (focused) {
      setCollectionSearchFocusBlocked(true);
      collectionSearchInput.current?.blur();
      rootSearchInput.current?.blur();
      Keyboard.dismiss();
    } else {
      setAiResponse(undefined);
      searchFocusReleaseTimer.current = setTimeout(() => setCollectionSearchFocusBlocked(false), 350);
    }
  }

  function openSheet(sheet: GallerySheet) {
    rootSearchInput.current?.blur();
    collectionSearchInput.current?.blur();
    Keyboard.dismiss();
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
    if (activeSheetRef.current === "similar") {
      similarRequest.current += 1;
      setSimilarSource(undefined);
      setSimilarImages([]);
      setSimilarLoading(false);
      setSimilarError(undefined);
    }
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

  async function replayOverviewWindow(collectionKey: string | undefined, targetCount: number, generation: number, origin = collectionKey === activeCollectionKey.current ? activeImageOrigin.current : undefined) {
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const replay = await replayPaginatedWindow({
      targetCount,
      getKey: ({ key }: GalleryImage) => key,
      isCurrent,
      fetchPage: async (cursor?: string) => {
        const page = cursor
          ? await fetchGalleryOverview(collectionKey, cursor, 100, undefined, undefined, origin)
          : await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collectionKey, origin), queryFn: () => fetchGalleryOverview(collectionKey, undefined, 100, undefined, undefined, origin), staleTime: 0 });
        return { page, items: page.images, nextCursor: page.nextCursor };
      },
    });
    if (replay.cancelled || !replay.firstPage || !isCurrent()) return undefined;
    const overview = { ...replay.firstPage, images: replay.items, nextCursor: replay.nextCursor, replayReachedEnd: replay.reachedEnd };
    queryClient.setQueryData(galleryQueryKeys.overview(galleryContext, collectionKey, origin), overview);
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
    if (activeCollection && (!initialTarget?.access?.canContribute || initialTarget.role === "viewer")) return;
    setBusy(true);
    closeSheet();
    setStatus(undefined);
    try {
      const files = await Promise.all(assets.slice(0, 20).map(async (asset, index) => {
        const output = await normalizeCapturedPng(asset, { maxSide: 2400, compress: 0.88 });
        return {
          clientKey: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          filename: `gallery-${Date.now()}-${index + 1}.png`,
          uri: output.uri,
          sizeBytes: output.sizeBytes,
          ...(output.latitude !== undefined && output.longitude !== undefined ? { latitude: output.latitude, longitude: output.longitude } : {}),
        };
      }));
      if (!isCurrent()) { deletePreparedFiles(files); return; }
      if (activeCollection) {
        const targetCollection = latestActiveCollection();
        if (!targetCollection?.access?.canContribute || targetCollection.role === "viewer") { deletePreparedFiles(files); return; }
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
    if (activeCollection && (!target?.access?.canContribute || target.role === "viewer")) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!isCurrent()) return;
    if (!permission.granted) { closeSheet(); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 1, exif: true });
    if (!isCurrent()) return;
    if (!result.canceled) await prepareAssets(result.assets, generation);
  }

  async function takePhoto() {
    const target = latestActiveCollection();
    if (!target?.access?.canContribute || target.role === "viewer") return;
    closeSheet();
    cameraContextGeneration.current = refreshContextGeneration.current;
    setCameraOpen(true);
  }

  function uploadCapturedPhotos(files: PreparedGalleryUpload[]) {
    const generation = cameraContextGeneration.current;
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current);
    const targetCollection = latestActiveCollection();
    setCameraOpen(false);
    if (!isCurrent() || !targetCollection || !targetCollection.access?.canContribute || targetCollection.role === "viewer" || files.length === 0) { deletePreparedFiles(files); return; }
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
    if (!targetCollection?.access?.canContribute || targetCollection.role === "viewer") { deletePreparedFiles(files); setPendingFiles([]); closeSheet(); return; }
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
      const collection = await createGalleryCollection(name, false);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch((error: unknown) => { if (isCurrent()) setStatus(errorMessage(error)); });
      if (!isCurrent()) return;
      updateCollectionSingleton((current) => [...current, collection]);
      setNewCollectionName("");
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
    const origin = collection ? imageOrigin : undefined;
    const searchKey = `${collection?.key ?? "root"}:${origin ?? "all"}:${value.toLocaleLowerCase()}`;
    if (activeSearch.current === searchKey) return;
    activeSearch.current = searchKey;
    const request = ++searchRequest.current;
    setSearching(true);
    try {
      const result = await searchGalleryImages({ query: value, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: true, limit: 50 });
      const expectedView = collection ? "search" : "root";
      if (request !== searchRequest.current || activeCollectionKey.current !== collection?.key || visibleGalleryView.current !== expectedView) return;
      setSelectedImageKeys([]);
      setCollectionSearchResults(origin ? result.images.filter((image) => image.origin === origin) : result.images);
      setStatus(undefined);
    } catch {
      const expectedView = collection ? "search" : "root";
      if (request === searchRequest.current && activeCollectionKey.current === collection?.key && visibleGalleryView.current === expectedView) {
        setCollectionSearchResults([]);
        setStatus(undefined);
      }
    } finally {
      if (activeSearch.current === searchKey) activeSearch.current = undefined;
      if (request === searchRequest.current) setSearching(false);
    }
  }

  function clearCollectionSearch(refresh = true) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
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

  async function openSearchHistory(target: "gallery" | "root" | "identityPicker" = "gallery") {
    historyTarget.current = target;
    const generation = ++historyGeneration.current;
    const key = userSearchHistoryQueryKey(contentContext.userKey);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []);
    setHistoryLoading(!cached || invalidated);
    setRemovingHistoryQuery(undefined);
    setStatus(undefined);
    pushSheet("searchHistory");
    if (cached && !invalidated) return;
    try {
      const loaded = await getUserSearchHistory(queryClient, contentContext);
      if (generation === historyGeneration.current && activeSheetRef.current === "searchHistory") setHistory(loaded);
    } catch (error) {
      if (generation === historyGeneration.current && activeSheetRef.current === "searchHistory") setStatus(errorMessage(error));
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  }

  function applyHistoryQuery(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedUserSearchHistory(queryClient, contentContext, item);
    setHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    if (historyTarget.current === "identityPicker") returnToIdentityPicker(item.query);
    else if (historyTarget.current === "root") { closeSheet(); setRootSearchQuery(item.query); }
    else { closeSheet(); updateCollectionSearch(item.query); }
  }

  async function removeHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingHistoryQuery) return;
    const previous = removeCachedUserSearchHistory(queryClient, contentContext, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (error) {
      queryClient.setQueryData(userSearchHistoryQueryKey(contentContext.userKey), previous);
      setHistory(previous);
      setStatus(errorMessage(error));
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
      mimeType: "image/png",
      sizeBytes: item.sizeBytes,
      width: 0,
      height: 0,
      city: null,
      country: null,
      countryCode: null,
      latitude: null,
      longitude: null,
      locationSource: null,
      origin: "uploaded",
      mutationPolicy: "user",
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
    const source = selectedImage;
    const collection = activeCollection;
    const queryKey = galleryQueryKeys.search(galleryContext, "similar", collection.key, source.key);
    const { isCurrent: isCurrentContext } = captureGalleryContextGuard();
    const request = ++similarRequest.current;
    const isCurrent = () => isCurrentContext() && request === similarRequest.current && activeSheetRef.current === "similar" && activeCollectionKey.current === collection.key;
    closeSheet();
    setSimilarSource(source);
    setSimilarImages([]);
    setSimilarError(undefined);
    setSimilarLoading(true);
    setSelectedImage(undefined);
    openSheet("similar");
    try {
      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" }).catch(() => undefined);
      const result = await searchGalleryImages({ imageKey: source.key, collectionKey: collection.key, limit: 50 });
      if (!isCurrent()) return;
      await Promise.allSettled(result.images.map(({ url }) => Image.prefetch(url)));
      if (!isCurrent()) return;
      await wait(Math.max(0, 300 - (Date.now() - loadingStartedAt)));
      if (!isCurrent()) return;
      queryClient.setQueryData(queryKey, result);
      setSimilarImages(result.images);
    } catch (error) {
      if (isCurrent()) setSimilarError(errorMessage(error));
    } finally {
      if (isCurrent()) setSimilarLoading(false);
    }
  }

  function showSimilarImage(image: GalleryImage) {
    similarRequest.current += 1;
    setSimilarSource(undefined);
    setSimilarImages([]);
    setSimilarLoading(false);
    setSimilarError(undefined);
    showImage(image);
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
    if (!activeCollection || !latest || !isGalleryCollectionOwned(latest) || !latest.access?.canManage || !editName.trim()) return;
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
    if (!activeCollection || !latest || !isGalleryCollectionOwned(latest) || !latest.access?.canManage) return;
    if (latest.isFavorite) {
      closeSheet();
      notify("Can't delete favorite collection");
      return;
    }
    const collection = activeCollection;
    const { isCurrent } = captureGalleryContextGuard();
    setBusy(true);
    try {
      await deleteGalleryCollection(collection.key);
      void invalidateCompassTrips();
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch(() => { if (isCurrent()) setStatus("Collection refresh failed."); });
      if (!isCurrent()) return;
      closeSheet();
      identityFilterRequest.current += 1;
      setActiveIdentityFilter(undefined);
      setSimilarSource(undefined);
      setSimilarImages([]);
      setActiveCollection(undefined);
      setShowingCollectionOverview(true);
      updateCollectionSingleton((current) => current.filter(({ key }) => key !== collection.key));
      setImages([]);
      setStatus(`${collection.name} was deleted.`);
      notify("Collection deleted");
    } catch (error) {
      if (isCurrent()) {
        const favoriteConflict = isGalleryClientErrorCode(error, "GALLERY_COLLECTION_FAVORITE");
        if (favoriteConflict) closeSheet();
        setStatus(favoriteConflict ? undefined : "Collection deletion failed.");
        notify(favoriteConflict ? "Can't delete favorite collection" : "Collection deletion failed");
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function leaveActiveCollection() {
    const latest = latestActiveCollection();
    if (!activeCollection || !latest || isGalleryCollectionOwned(latest) || !latest.access?.canRead) return;
    const collection = activeCollection;
    const { isCurrent } = captureGalleryContextGuard();
    setBusy(true);
    try {
      await leaveGalleryCollection(collection.key);
      if (!isCurrent()) return;
      closeSheet();
      identityFilterRequest.current += 1;
      setActiveIdentityFilter(undefined);
      setSimilarSource(undefined);
      setSimilarImages([]);
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

  function applyAuthoritativeFavoriteImages(favorites: GalleryImage[]) {
    if (favorites.length === 0) return;
    const byKey = new Map(favorites.map((image) => [image.key, image]));
    const patch = (current: GalleryImage[]) => current.map((image) => byKey.get(image.key) ?? image);
    favorites.forEach((image) => patchGalleryImage(queryClient, galleryContext, image));
    const patchResult = (current: { images: GalleryImage[] } | undefined) => current ? { ...current, images: patch(current.images) } : current;
    queryClient.setQueriesData({ queryKey: [...galleryQueryKeys.all(galleryContext), "search"] }, patchResult);
    queryClient.setQueriesData({ queryKey: [...galleryQueryKeys.all(galleryContext), "duplicates"] }, patchResult);
    setImages(patch);
    setSimilarImages(patch);
    setCollectionSearchResults((current) => current ? patch(current) : current);
    setCleanupImages(patch);
    setDuplicateImages(patch);
    setIdentityPickerImages(patch);
    setIdentityPickerResults((current) => current ? patch(current) : current);
    setSelectedImage((current) => current ? byKey.get(current.key) ?? current : current);
    setIdentityPickerSelected((current) => current ? byKey.get(current.key) ?? current : current);
  }

  function deleteSelectedImage() {
    if (!selectedImage || !canMutateInCollection(selectedImage, latestActiveCollection()) || busyRef.current) return;
    const target = selectedImage;
    if (target.isFavorite) {
      closeSheet();
      notify("Can't delete favorite image");
      return;
    }
    const { generation, isCurrent } = captureGalleryContextGuard();
    const cacheSnapshot = snapshotGalleryOverviews(queryClient, galleryContext);
    const previousImages = images;
    const previousSimilarImages = similarImages;
    const previousSearchResults = collectionSearchResults;
    const previousCollections = collections;
    const previousActiveCollection = activeCollection;
    const previousViewRequest = viewRequest.current;
    const previousSearchRequest = searchRequest.current;
    const removedFromActive = Boolean(activeCollection);
    busyRef.current = true;
    setBusy(true);
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
    const restore = () => {
      if (activeCollectionKey.current !== previousActiveCollection?.key || viewRequest.current !== previousViewRequest || searchRequest.current !== previousSearchRequest) {
        void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
        void refreshCollectionSingletonAfterImageDeletion(generation).catch(() => undefined);
        return;
      }
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      setImages(previousImages);
      setSimilarImages(previousSimilarImages);
      setCollectionSearchResults(previousSearchResults);
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(previousActiveCollection);
      setSelectedImage(target);
    };
    void deleteGalleryImages([target.key]).then((result) => {
      if (!isCurrent()) return;
      const reconciled = reconcileGalleryImageDeletion([target], result);
      if (reconciled.favoriteImages.length) {
        restore();
        applyAuthoritativeFavoriteImages(reconciled.favoriteImages);
        notify("Can't delete favorite image");
        return;
      }
      if (reconciled.deletedImages.length !== 1) {
        restore();
        notify("Image deletion failed");
        return;
      }
      void invalidateCompassTrips();
      notify("Image deleted");
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      void refreshCollectionSingletonAfterImageDeletion(generation).catch(() => { if (isCurrent()) setStatus("Gallery refresh failed."); });
      if (isCurrent()) void loadSubjects();
    }).catch(() => {
      if (!isCurrent()) return;
      restore();
      notify("Image deletion failed");
    }).finally(() => {
      if (!isCurrent()) return;
      busyRef.current = false;
      setBusy(false);
    });
  }

  async function showDuplicates() {
    if (!activeCollection || !isCollectionOwner) return;
    const collectionKey = activeCollection.key;
    const queryKey = galleryQueryKeys.duplicates(galleryContext, collectionKey);
    const { isCurrent: isCurrentContext } = captureGalleryContextGuard();
    const request = ++duplicatesRequest.current;
    const isCurrent = () => isCurrentContext() && request === duplicatesRequest.current && activeSheetRef.current === "duplicates" && activeCollectionKey.current === collectionKey;
    setDuplicateImages([]);
    setDuplicateSelectedImageKeys([]);
    setDuplicatesError(undefined);
    setDuplicatesLoading(true);
    openSheet("duplicates");
    try {
      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" }).catch(() => undefined);
      const result = await findGalleryCollectionDuplicates(collectionKey);
      if (!isCurrent()) return;
      queryClient.setQueryData(queryKey, result);
      setDuplicateImages(result.images);
      setDuplicateSelectedImageKeys(result.images.map(({ key }) => key));
    } catch (error) {
      if (isCurrent()) setDuplicatesError(errorMessage(error));
    } finally {
      if (isCurrent()) setDuplicatesLoading(false);
    }
  }

  async function deleteDuplicates() {
    const latest = latestActiveCollection();
    if (!activeCollection || !latest || !isGalleryCollectionOwned(latest) || !latest.access?.canManage || duplicateSelectedImageKeys.length === 0) return;
    const selectedKeys = new Set(duplicateSelectedImageKeys);
    const targets = duplicateImages.filter(({ key }) => selectedKeys.has(key));
    const { favoriteImages: localFavorites, eligibleImages } = partitionFavoriteGalleryImages(targets);
    if (eligibleImages.length === 0) {
      goBackSheet();
      notify(`Can't delete ${localFavorites.length} favorite item${localFavorites.length === 1 ? "" : "s"}`);
      return;
    }
    const { isCurrent } = captureGalleryContextGuard();
    const collectionKey = activeCollection.key;
    const queryKey = galleryQueryKeys.duplicates(galleryContext, collectionKey);
    setBusy(true);
    try {
      const deleted = await deleteGalleryCollectionDuplicates(collectionKey, eligibleImages.map(({ key }) => key));
      if (deleted.deletedImageKeys.length) void invalidateCompassTrips();
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) }).catch(() => { if (isCurrent()) setStatus("Gallery refresh failed."); });
      if (!isCurrent()) return;
      const reconciled = reconcileGalleryDuplicateDeletion(eligibleImages, deleted);
      const removedKeys = new Set(reconciled.removedImages.map(({ key }) => key));
      const favoriteCount = localFavorites.length + reconciled.favoriteImages.length;
      const deletedCount = deleted.deletedImageKeys.filter((key) => removedKeys.has(key)).length;
      const favoriteByKey = new Map(reconciled.favoriteImages.map((image) => [image.key, image]));
      const remainingDuplicates = duplicateImages.filter(({ key }) => !removedKeys.has(key)).map((image) => favoriteByKey.get(image.key) ?? image);
      applyAuthoritativeFavoriteImages(reconciled.favoriteImages);
      updateCollectionSingleton((current) => current.map((collection) => collection.key === collectionKey
        ? { ...collection, count: Math.max(0, collection.count - reconciled.removedImages.length) }
        : collection));
      setActiveCollection((current) => current ? { ...current, count: Math.max(0, current.count - reconciled.removedImages.length) } : current);
      setImages((current) => current.filter(({ key }) => !removedKeys.has(key)));
      setDuplicateImages(remainingDuplicates);
      setDuplicateSelectedImageKeys((current) => current.filter((key) => !removedKeys.has(key)));
      queryClient.setQueryData(queryKey, { images: remainingDuplicates });
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      if (favoriteCount || reconciled.unknownImages.length) goBackSheet(); else closeSheet();
      setStatus(reconciled.unknownImages.length
        ? "Some images were not deleted."
        : `${reconciled.removedImages.length} duplicate image${reconciled.removedImages.length === 1 ? "" : "s"} removed from this collection. ${deletedCount} moved to trash.`);
      notify(reconciled.unknownImages.length
        ? "Some images were not deleted"
        : favoriteCount ? `Can't delete ${favoriteCount} favorite item${favoriteCount === 1 ? "" : "s"}` : "Duplicates deleted");
    } catch {
      if (isCurrent()) {
        setStatus("Duplicate deletion failed.");
        notify("Duplicate deletion failed");
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  const isCurrentCleanupRequest = (request: number, generation: number, collectionKey: string, threshold: (typeof CLEANUP_THRESHOLDS)[number]) => request === cleanupRequest.current
    && generation === refreshContextGeneration.current
    && activeSheetRef.current === "cleanup"
    && cleanupCollectionKeyRef.current === collectionKey
    && activeCollectionKey.current === collectionKey
    && cleanupThresholdRef.current === threshold;

  async function fetchMutableCleanupPage(collection: GalleryCollection, threshold: (typeof CLEANUP_THRESHOLDS)[number], initialCursor?: string): Promise<CleanupPage> {
    let cursor = initialCursor;
    const traversedCursors = new Set<string | undefined>();
    while (!traversedCursors.has(cursor)) {
      traversedCursors.add(cursor);
      const page = await fetchGalleryOverview(collection.key, cursor, 100, threshold);
      const mutableImages = page.images.filter((image) => canMutateInCollection(image, collection));
      if (mutableImages.length > 0 || !page.nextCursor) return { images: mutableImages, nextCursor: page.nextCursor };
      cursor = page.nextCursor;
    }
    return { images: [] as GalleryImage[], nextCursor: null };
  }

  async function loadCleanupImages(threshold: (typeof CLEANUP_THRESHOLDS)[number], collectionOverride?: GalleryCollection) {
    const collection = collectionOverride ?? latestActiveCollection();
    if (!collection || !isGalleryCollectionOwned(collection) || cleanupCollectionKeyRef.current !== collection.key) return;
    const request = ++cleanupRequest.current;
    const generation = refreshContextGeneration.current;
    cleanupThresholdRef.current = threshold;
    cleanupCursorRef.current = null;
    cleanupLoadingRef.current = true;
    cleanupLoadingMoreRef.current = false;
    setCleanupThreshold(threshold);
    setCleanupError(undefined);
    setCleanupLoadingMore(false);
    const queryKey = galleryQueryKeys.cleanup(galleryContext, collection.key, threshold);
    const cached = queryClient.getQueryData<CleanupPage>(queryKey);
    if (cached && queryClient.getQueryState(queryKey)?.isInvalidated !== true) {
      cleanupCursorRef.current = cached.nextCursor;
      cleanupLoadingRef.current = false;
      setCleanupImages(cached.images);
      setCleanupSelectedImageKeys(cached.images.map(({ key }) => key));
      setCleanupLoading(false);
      return;
    }
    setCleanupImages([]);
    setCleanupSelectedImageKeys([]);
    setCleanupLoading(true);
    try {
      const result = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => fetchMutableCleanupPage(collection, threshold),
        staleTime: Infinity,
      });
      if (!isCurrentCleanupRequest(request, generation, collection.key, threshold)) return;
      cleanupCursorRef.current = result.nextCursor;
      setCleanupImages(result.images);
      setCleanupSelectedImageKeys(result.images.map(({ key }) => key));
    } catch (error) {
      if (isCurrentCleanupRequest(request, generation, collection.key, threshold)) setCleanupError(errorMessage(error));
    } finally {
      if (request === cleanupRequest.current && generation === refreshContextGeneration.current) {
        cleanupLoadingRef.current = false;
        setCleanupLoading(false);
      }
    }
  }

  async function showCleanup() {
    const collection = latestActiveCollection();
    if (!collection || !isGalleryCollectionOwned(collection)) return;
    cleanupCollectionKeyRef.current = collection.key;
    const invalidation = invalidateCleanupLoad();
    openSheet("cleanup");
    await invalidation;
    if (activeSheetRef.current === "cleanup" && cleanupCollectionKeyRef.current === collection.key) await loadCleanupImages(cleanupThresholdRef.current, collection);
  }

  async function loadMoreCleanupImages() {
    const collectionKey = cleanupCollectionKeyRef.current;
    const collection = collections.find(({ key }) => key === collectionKey);
    const cursor = cleanupCursorRef.current;
    const threshold = cleanupThresholdRef.current;
    if (!collection || !isGalleryCollectionOwned(collection) || !cursor || cleanupLoadingRef.current || cleanupLoadingMoreRef.current || activeSheetRef.current !== "cleanup") return;
    const request = cleanupRequest.current;
    const generation = refreshContextGeneration.current;
    cleanupLoadingMoreRef.current = true;
    setCleanupLoadingMore(true);
    try {
      const result = await fetchMutableCleanupPage(collection, threshold, cursor);
      if (!isCurrentCleanupRequest(request, generation, collection.key, threshold)) return;
      const queryKey = galleryQueryKeys.cleanup(galleryContext, collection.key, threshold);
      const cached = queryClient.getQueryData<CleanupPage>(queryKey);
      const next = {
        images: appendCursorItems(cached?.images ?? [], result.images, ({ key }) => key),
        nextCursor: result.nextCursor,
      };
      queryClient.setQueryData(queryKey, next);
      cleanupCursorRef.current = next.nextCursor;
      setCleanupImages(next.images);
      setCleanupSelectedImageKeys((current) => [...new Set([...current, ...result.images.map(({ key }) => key)])]);
    } catch (error) {
      if (request === cleanupRequest.current && generation === refreshContextGeneration.current && activeSheetRef.current === "cleanup") setCleanupError(errorMessage(error));
    } finally {
      if (request === cleanupRequest.current && generation === refreshContextGeneration.current) {
        cleanupLoadingMoreRef.current = false;
        setCleanupLoadingMore(false);
      }
    }
  }

  function toggleDeletionSelection(imageKey: string, setSelected: (updater: (current: string[]) => string[]) => void) {
    setSelected((current) => current.includes(imageKey) ? current.filter((key) => key !== imageKey) : [...current, imageKey]);
  }

  function applyDeletedGalleryImages(targets: GalleryImage[], sourceCollectionKey: string) {
    if (targets.length === 0) return;
    const removedKeys = new Set(targets.map(({ key }) => key));
    const removedUrls = new Set(targets.map(({ url }) => url));
    removeCachedGalleryImages(queryClient, galleryContext, targets);
    setImages((current) => current.filter(({ key }) => !removedKeys.has(key)));
    setSimilarImages((current) => current.filter(({ key }) => !removedKeys.has(key)));
    setCollectionSearchResults((current) => current?.filter(({ key }) => !removedKeys.has(key)));
    setSelectedImageKeys((current) => current.filter((key) => !removedKeys.has(key)));
    setSelectedImage((current) => current && removedKeys.has(current.key) ? undefined : current);
    updateCollectionSingleton((current) => current.map((collection) => collection.key === sourceCollectionKey ? { ...collection, count: Math.max(0, collection.count - targets.length), coverUrl: collection.coverUrl && removedUrls.has(collection.coverUrl) ? null : collection.coverUrl } : collection));
    setActiveCollection((current) => current && current.key === sourceCollectionKey ? { ...current, count: Math.max(0, current.count - targets.length), coverUrl: current.coverUrl && removedUrls.has(current.coverUrl) ? null : current.coverUrl } : current);
  }

  function applyDeletedCleanupImages(targets: GalleryImage[], sourceCollectionKey: string) {
    const removedKeys = new Set(targets.map(({ key }) => key));
    queryClient.setQueriesData<CleanupPage>({ queryKey: galleryQueryKeys.cleanups(galleryContext, sourceCollectionKey) }, (page) => page ? {
      ...page,
      images: page.images.filter(({ key }) => !removedKeys.has(key)),
    } : page);
    setCleanupImages((current) => current.filter(({ key }) => !removedKeys.has(key)));
    setCleanupSelectedImageKeys((current) => current.filter((key) => !removedKeys.has(key)));
    applyDeletedGalleryImages(targets, sourceCollectionKey);
  }

  async function deleteCleanupImages() {
    const sourceCollectionKey = cleanupCollectionKeyRef.current;
    const collection = collections.find(({ key }) => key === sourceCollectionKey);
    const selectedKeys = new Set(cleanupSelectedImageKeys);
    const targets = cleanupImages.filter(({ key }) => selectedKeys.has(key));
    if (!sourceCollectionKey || !collection || !isGalleryCollectionOwned(collection) || targets.length === 0 || busy || !targets.every((image) => canMutateInCollection(image, collection))) return;
    const { favoriteImages: localFavorites, eligibleImages } = partitionFavoriteGalleryImages(targets);
    if (eligibleImages.length === 0) {
      goBackSheet();
      notify(`Can't delete ${localFavorites.length} favorite item${localFavorites.length === 1 ? "" : "s"}`);
      return;
    }
    const { generation, isCurrent } = captureGalleryContextGuard();
    const deletedKeys = new Set<string>();
    const serverFavoriteKeys = new Set<string>();
    const unknownKeys = new Set<string>();
    setBusy(true);
    setCleanupError(undefined);
    try {
      for (let index = 0; index < targets.length; index += DELETE_IMAGE_CHUNK_SIZE) {
        const chunk = targets.slice(index, index + DELETE_IMAGE_CHUNK_SIZE);
        const { eligibleImages: eligibleChunk } = partitionFavoriteGalleryImages(chunk);
        if (eligibleChunk.length === 0) continue;
        const result = await deleteGalleryImages(eligibleChunk.map(({ key }) => key));
        if (!isCurrent()) return;
        const reconciled = reconcileGalleryImageDeletion(eligibleChunk, result);
        applyAuthoritativeFavoriteImages(reconciled.favoriteImages);
        for (const { key } of reconciled.deletedImages) deletedKeys.add(key);
        for (const { key } of reconciled.favoriteImages) serverFavoriteKeys.add(key);
        for (const { key } of reconciled.unknownImages) unknownKeys.add(key);
      }
      const deletedTargets = eligibleImages.filter(({ key }) => deletedKeys.has(key));
      applyDeletedCleanupImages(deletedTargets, sourceCollectionKey);
      if (deletedTargets.length) void invalidateCompassTrips();
      const favoriteCount = localFavorites.length + serverFavoriteKeys.size;
      if (favoriteCount || unknownKeys.size) {
        goBackSheet();
      } else {
        cleanupCollectionKeyRef.current = undefined;
        invalidateCleanupLoad();
        closeSheet();
      }
      setCleanupError(unknownKeys.size ? "Some images could not be deleted." : undefined);
      setStatus(unknownKeys.size ? "Some images could not be deleted." : `${deletedTargets.length} image${deletedTargets.length === 1 ? "" : "s"} deleted.`);
      notify(unknownKeys.size
        ? "Some images were not deleted"
        : favoriteCount ? `Can't delete ${favoriteCount} favorite item${favoriteCount === 1 ? "" : "s"}` : deletedTargets.length === 1 ? "Image deleted" : "Images deleted");
      if (deletedTargets.length) {
        void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
        void refreshCollectionSingletonAfterImageDeletion(generation).catch(() => { if (isCurrent()) setStatus("Gallery refresh failed."); });
        void loadSubjects();
      }
    } catch {
      if (!isCurrent()) return;
      const deletedTargets = eligibleImages.filter(({ key }) => deletedKeys.has(key));
      applyDeletedCleanupImages(deletedTargets, sourceCollectionKey);
      setCleanupError("Some images could not be deleted.");
      if (deletedTargets.length && activeSheetRef.current === "confirmCleanupDelete") goBackSheet();
      setStatus("Some images could not be deleted.");
      notify(deletedTargets.length ? "Some images were not deleted" : "Image deletion failed");
      if (deletedTargets.length) {
        void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
        void refreshCollectionSingletonAfterImageDeletion(generation).catch(() => { if (isCurrent()) setStatus("Gallery refresh failed."); });
        void loadSubjects();
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  async function openVisualIdentities() {
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
      void searchGalleryImages({ query: normalized, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: true, limit: 1 }).catch(() => undefined);
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
    const optimistic: GallerySubject = { key: optimisticKey, name, description: "Learning visual identity...", referenceImageKey: image.key, referenceUrl: image.url, imageCount: 1, createdAt: now, updatedAt: now };
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
    imageSheetRequest.current += 1;
    setSimilarSource(undefined);
    setSimilarImages([]);
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
    const targets = [...selectedImages];
    const { favoriteImages: localFavorites, eligibleImages } = partitionFavoriteGalleryImages(targets);
    if (eligibleImages.length === 0) {
      closeSheet();
      notify(`Can't delete ${localFavorites.length} favorite item${localFavorites.length === 1 ? "" : "s"}`);
      return;
    }
    const { generation, isCurrent } = captureGalleryContextGuard();
    const keys = eligibleImages.map(({ key }) => key);
    const cacheSnapshot = snapshotGalleryOverviews(queryClient, galleryContext);
    const previousImages = images;
    const previousSimilarImages = similarImages;
    const previousSearchResults = collectionSearchResults;
    const previousCollections = collections;
    const previousActiveCollection = activeCollection;
    removeCachedGalleryImages(queryClient, galleryContext, eligibleImages);
    setImages((current) => current.filter(({ key }) => !keys.includes(key)));
    setSimilarImages((current) => current.filter(({ key }) => !keys.includes(key)));
    setCollectionSearchResults((current) => current?.filter(({ key }) => !keys.includes(key)));
    if (activeCollection) {
      updateCollectionSingleton((current) => current.map((collection) => collection.key === activeCollection.key ? { ...collection, count: Math.max(0, collection.count - eligibleImages.length) } : collection));
      setActiveCollection((current) => current ? { ...current, count: Math.max(0, current.count - eligibleImages.length) } : current);
    }
    setBusy(true);
    void deleteGalleryImages(keys).then((result) => {
      if (!isCurrent()) return;
      const reconciled = reconcileGalleryImageDeletion(eligibleImages, result);
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      setImages(previousImages);
      setSimilarImages(previousSimilarImages);
      setCollectionSearchResults(previousSearchResults);
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(previousActiveCollection);
      applyDeletedGalleryImages(reconciled.deletedImages, previousActiveCollection?.key ?? "");
      applyAuthoritativeFavoriteImages(reconciled.favoriteImages);
      const deletedKeys = new Set(reconciled.deletedImages.map(({ key }) => key));
      setSelectedImageKeys(targets.filter(({ key }) => !deletedKeys.has(key)).map(({ key }) => key));
      closeSheet();
      const favoriteCount = localFavorites.length + reconciled.favoriteImages.length;
      if (reconciled.unknownImages.length) setStatus("Some images were not deleted.");
      notify(reconciled.unknownImages.length
        ? "Some images were not deleted"
        : favoriteCount ? `Can't delete ${favoriteCount} favorite item${favoriteCount === 1 ? "" : "s"}` : reconciled.deletedImages.length === 1 ? "Image deleted" : "Images deleted");
      if (reconciled.deletedImages.length) {
        void invalidateCompassTrips();
        void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
        void refreshCollectionSingletonAfterImageDeletion(generation).catch(() => { if (isCurrent()) setStatus("Gallery refresh failed."); });
        void loadSubjects();
      }
    }).catch(() => {
      if (!isCurrent()) return;
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      setImages(previousImages);
      setSimilarImages(previousSimilarImages);
      setCollectionSearchResults(previousSearchResults);
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(previousActiveCollection);
      setStatus("Image deletion failed.");
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
    if (!destination || !sourceCollection.access?.canContribute || sourceCollection.role === "viewer" || !destination.access?.canContribute || destination.role === "viewer") return;
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
      if (!shouldRunGalleryAssistantTextSearch(assistantResult)) {
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
    setDuplicateSelectedImageKeys([]);
    setCollectionSearchResults(undefined);
    setSelectedImage(undefined);
    setSelectedImageKeys([]);
    setDestinationCollectionKey(undefined);
    setImages(rootOverview.images);
    setNextCursor(rootOverview.nextCursor);
  }

  refreshRunner.current = async (plan, generation, isViewCurrent = () => true) => {
    const isCurrent = () => isCurrentContextGeneration(generation, refreshContextGeneration.current) && isViewCurrent();
    const cleanupWasOpen = activeSheetRef.current === "cleanup" || activeSheetRef.current === "confirmCleanupDelete";
    if (cleanupWasOpen && (plan.has("access") || plan.has("cleanup"))) invalidateCleanupLoad();
    try {
      if (plan.has("upload")) await refreshUnresolvedUploadJobs(generation).catch(() => undefined);
      if (!isCurrent()) return;
      const needsIndex = plan.has("root") || plan.has("access");
      const needsOverview = plan.has("current");
      const needsSubjects = plan.has("subjects");
      const needsCleanup = cleanupWasOpen && (plan.has("access") || plan.has("cleanup"));
      if (!needsIndex && !needsOverview && !needsSubjects && !needsCleanup) return;

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
        currentCollection = activeCollection ? authoritativeCollections.find(({ key, access }) => key === activeCollection.key && access?.canRead) : undefined;
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
      if (currentCollection && isGalleryCollectionOwned(currentCollection)) for (const key of selectedImageKeys) mutableImageKeys.add(key);
      for (const image of permissionImages) if (currentCollection && (isGalleryCollectionOwned(currentCollection) || collectionMembershipRole(currentCollection) === "collaborator" && image.createdByKey === currentCollection.memberKey)) mutableImageKeys.add(image.key);
      const detailMutable = Boolean(selectedImage && currentCollection && (isGalleryCollectionOwned(currentCollection) || collectionMembershipRole(currentCollection) === "collaborator" && selectedImage.createdByKey === currentCollection.memberKey));
      const permissions = reconcileGalleryPermissions({ role: currentCollection ? collectionMembershipRole(currentCollection) : undefined, canContribute: currentCollection?.access?.canContribute, activeSheet: activeSheetRef.current, selectedImageKeys, mutableImageKeys, destinationCollectionKey, ownerCapability: !currentCollection && authoritativeCollections.some((collection) => isGalleryCollectionOwned(collection) && collection.access?.canManage), detailMutable });
      if (permissions.closeSheet) closeSheet();
      if (needsCleanup && !permissions.closeSheet && currentCollection && isGalleryCollectionOwned(currentCollection) && currentCollection.key === cleanupCollectionKeyRef.current) {
        if (activeSheetRef.current === "confirmCleanupDelete") goBackSheet();
        await loadCleanupImages(cleanupThresholdRef.current, currentCollection);
        if (!isCurrent()) return;
      }
      if (activeCollection && (!currentCollection?.access?.canContribute || currentCollection.role === "viewer")) {
        setCameraOpen(false);
        setPendingFiles((current) => { deletePreparedFiles(current); return []; });
      }
      setSelectedImageKeys(permissions.selectedImageKeys);
      setDestinationCollectionKey(reconcileGalleryState({ mode: visibleGalleryView.current, activeCollectionKey: currentCollection?.key, selectedImageKeys: [], destinationCollectionKey: permissions.destinationCollectionKey, authoritativeImagesComplete: false }, authoritativeCollections, []).destinationCollectionKey);

      let refreshedSubjects = subjects;
      if (needsSubjects) {
        const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.subjects(galleryContext), queryFn: () => listGallerySubjects(), staleTime: 0 });
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

      if (plan.has("search") && refreshedIdentity) {
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
        const request = ++duplicatesRequest.current;
        const collectionKey = currentCollection.key;
        const queryKey = galleryQueryKeys.duplicates(galleryContext, collectionKey);
        try {
          const result = await findGalleryCollectionDuplicates(collectionKey);
          if (!isCurrent() || request !== duplicatesRequest.current || activeSheetRef.current !== "duplicates" || activeCollectionKey.current !== collectionKey) return;
          queryClient.setQueryData(queryKey, result);
          setDuplicateImages(result.images);
          setDuplicateSelectedImageKeys(result.images.map(({ key }) => key));
          setDuplicatesError(undefined);
        } catch (error) {
          if (isCurrent() && request === duplicatesRequest.current && activeSheetRef.current === "duplicates" && activeCollectionKey.current === collectionKey) setDuplicatesError(errorMessage(error));
        } finally {
          if (isCurrent() && request === duplicatesRequest.current && activeSheetRef.current === "duplicates" && activeCollectionKey.current === collectionKey) setDuplicatesLoading(false);
        }
      }

      if (activeSheetRef.current === "similar" && currentCollection && similarSource && plan.has("search")) {
        const request = ++similarRequest.current;
        const collectionKey = currentCollection.key;
        const sourceKey = similarSource.key;
        const queryKey = galleryQueryKeys.search(galleryContext, "similar", collectionKey, sourceKey);
        try {
          const result = await searchGalleryImages({ imageKey: sourceKey, collectionKey, limit: 50 });
          if (!isCurrent() || request !== similarRequest.current || activeSheetRef.current !== "similar" || activeCollectionKey.current !== collectionKey) return;
          queryClient.setQueryData(queryKey, result);
          setSimilarImages(result.images);
          setSimilarError(undefined);
        } catch (error) {
          if (isCurrent() && request === similarRequest.current && activeSheetRef.current === "similar" && activeCollectionKey.current === collectionKey) setSimilarError(errorMessage(error));
        } finally {
          if (isCurrent() && request === similarRequest.current && activeSheetRef.current === "similar" && activeCollectionKey.current === collectionKey) setSimilarLoading(false);
        }
      }

      if (needsOverview && activeSheetRef.current === "identityPicker" && identityPickerCollection) {
        const pickerCollection = authoritativeCollections.find((collection) => collection.key === identityPickerCollection.key && collection.access?.canRead);
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

  async function refreshGallery() {
    if (userRefreshing) return;
    const generation = refreshContextGeneration.current;
    const viewKey = refreshViewKey.current;
    const viewGeneration = viewRequest.current;
    const searchGeneration = searchRequest.current;
    const plan = new Set<GalleryRefreshFamily>(["root", "current"]);
    if (query.trim() || showingSearchResults || activeSubject || activeIdentityFilter) plan.add("search");
    if (activeSubject || activeIdentityFilter) plan.add("subjects");
    setUserRefreshing(true);
    try {
      await refreshRunner.current(plan, generation, () => refreshViewKey.current === viewKey && viewRequest.current === viewGeneration && searchRequest.current === searchGeneration);
    } finally {
      setUserRefreshing(false);
    }
  }

  const activeSubjects = subjects;
  const duplicateSelectedCount = duplicateSelectedImageKeys.length;
  const cleanupSelectedCount = cleanupSelectedImageKeys.length;
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
              : activeSheet === "similar" ? "Similar images"
              : activeSheet === "duplicates" ? "Duplicates"
                : activeSheet === "confirmDeleteDuplicates" ? `Delete ${duplicateSelectedCount === 1 ? "duplicate" : `${duplicateSelectedCount} duplicates`}?`
                     : activeSheet === "cleanupMenu" ? "Collection intelligence"
                    : activeSheet === "cleanup" ? "Clean up"
                        : activeSheet === "confirmCleanupDelete" ? `Delete ${cleanupSelectedCount === 1 ? "image" : `${cleanupSelectedCount} images`}?`
                  : activeSheet === "visualIdentities" ? "Visual identities"
                    : activeSheet === "confirmDeleteIdentity" ? "Delete visual identity?"
                       : activeSheet === "identityPicker" ? imagePickerPurpose === "cover" ? "Choose collection cover" : "Create visual identity"
                        : activeSheet === "identityName" ? "Name visual identity"
                          : activeSheet === "identityPickerFilter" ? "Filter images"
                          : activeSheet === "filter" ? "Filter images"
                            : activeSheet === "searchHistory" ? "Search history"
                              : activeSheet === "bulkActions" ? "Selected image actions"
                                 : activeSheet === "bulkDelete" ? `Delete ${selectedImageKeys.length === 1 ? "image" : `${selectedImageKeys.length} images`}?`
                                  : activeSheet === "transferDestination" ? `${transferMode === "move" ? "Move" : "Copy"} to collection`
                                    : "Gallery";
  const collectionSearchActive = Boolean(activeCollection && query.trim());
  const unfilteredVisibleImages = activeIdentityFilter && activeCollection ? collectionSearchResults ?? [] : collectionSearchActive ? collectionSearchResults ?? [] : images;
  const optimisticImageKeys = new Set(optimisticMediaItems.map(({ imageKey }) => imageKey).filter((key): key is string => Boolean(key)));
  const reconciledVisibleImages = mergeMediaItems([], unfilteredVisibleImages).filter(({ key }) => !optimisticImageKeys.has(key));
  const visibleImages = filterByHiddenView(reconciledVisibleImages, userHiddens, "image", viewFilters);
  const collectionViewerImages = activeCollection && selectedImage && !selectedOptimisticItem
    ? visibleImages.some(({ key }) => key === selectedImage.key) ? visibleImages : [selectedImage]
    : selectedImage ? [selectedImage] : [];
  const collectionViewerIndex = selectedImage ? collectionViewerImages.findIndex(({ key }) => key === selectedImage.key) : -1;
  const focusCollectionImage = (offset: number) => {
    if (collectionViewerImages.length < 2 || collectionViewerIndex < 0) return;
    setSelectedImage(collectionViewerImages[(collectionViewerIndex + offset + collectionViewerImages.length) % collectionViewerImages.length]!);
  };
  const visibleOptimisticItems = activeCollection && imageOrigin === "uploaded" && !collectionSearchActive && !showOnlyFavorites
    ? optimisticMediaItems.filter(({ collectionKey }) => collectionKey === activeCollection.key)
    : [];
  const visibleGenerationPlaceholders = imageOrigin === "generated" ? generationPlaceholders.filter(({ collectionKey }) => collectionKey === activeCollection?.key) : [];
  const visibleImageGroups = groupGalleryImagesByCreatedDate<GalleryGridItem>([
    ...visibleGenerationPlaceholders.flatMap((placeholder) => Array.from({ length: placeholder.count }, (_, index) => ({ kind: "generation", key: `${placeholder.requestKey}:${index}`, createdAt: placeholder.createdAt, requestKey: placeholder.requestKey } as const))),
    ...visibleOptimisticItems.map((item) => ({ kind: "optimistic", key: item.clientKey, createdAt: item.createdAt, item } as const)),
    ...visibleImages.map((image) => ({ kind: "persisted", key: image.key, createdAt: image.createdAt, image } as const)),
  ]);
  const emptyGridMessage = activeSubject
      ? `No images are currently identified as ${activeSubject.name}.`
      : collectionSearchActive || showingSearchResults
        ? "No images matched this search."
        : activeCollection
          ? imageOrigin === "generated" ? "No generated images yet." : "No uploaded images yet."
          : "Your visual memory starts with the first image.";
  const contextualView = Boolean(activeCollection || activeSubject || showingSearchResults);
  const normalCollectionView = Boolean(activeCollection && !activeSubject);
  const rootCollectionSource = rootSearchQuery.trim() ? rootSearchResults ?? [] : collections;
  const visibleCollections = filterByHiddenView(rootCollectionSource, userHiddens, "collection", viewFilters).filter((collection) => collectionTab === "mine" ? isGalleryCollectionOwned(collection) : !isGalleryCollectionOwned(collection));
  const rootSearchLoading = Boolean(rootSearchQuery.trim() && (rootSearching || !rootSearchResults));
  const writableCollections = collections.filter(({ access, role }) => access?.canContribute && role !== "viewer");
  const canManageAnyCollection = collections.some((collection) => collection.access?.canManage && isGalleryCollectionOwned(collection));
  const identityPickerVisibleCollections = filterByHiddenView(collections, userHiddens, "collection", viewFilters);
  const identityPickerVisibleImages = filterByHiddenView(identityPickerResults ?? identityPickerImages, userHiddens, "image", viewFilters);
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
  const filterBadges = (contextual = false) => !filtersActive && (!contextual || !activeIdentityFilter) ? null : <View style={styles.filterBadgeRow}>
    {showOnlyFavorites ? <View style={styles.similarPill}><Text numberOfLines={1} style={styles.similarPillText}>Favorites</Text><Button accessibilityLabel="Close Favorites filter" contentMode="raw" onPress={() => setViewFilters((current) => ({ ...current, favoritesOnly: false }))} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View> : null}
    {showHidden ? <View style={styles.similarPill}><Text numberOfLines={1} style={styles.similarPillText}>Show hidden</Text><Button accessibilityLabel="Close Show hidden filter" contentMode="raw" onPress={() => setViewFilters((current) => ({ ...current, showHidden: false }))} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View> : null}
    {contextual && activeIdentityFilter ? <View style={styles.similarPill}><Image source={activeIdentityFilter.referenceUrl} contentFit="cover" style={styles.similarPillImage} /><Text numberOfLines={1} style={styles.similarPillText}>{activeIdentityFilter.name}</Text><Button accessibilityLabel="Close visual identity filter" contentMode="raw" onPress={clearIdentityFilter} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View> : null}
  </View>;
  const sheetFooter = activeSheet === "newCollection" ? <View style={styles.compactSheetActions}>
      <Button disabled={busy || !canCreateCollections || !newCollectionName.trim()} loading={busy} onPress={() => void createCollectionAndUpload()} size="md" variant="primary">{pendingFiles.length ? "Create and upload" : "Create collection"}</Button>
      <Button disabled={busy} onPress={closeSheet} size="md" variant="secondary">Close</Button>
    </View> : activeSheet === "imageEdit" ? <View style={styles.compactSheetActions}>
      <Button disabled={busy || !editName.trim()} loading={busy} onPress={() => void submitImageEdit()} size="md" variant="primary">Save</Button>
      <Button disabled={busy} onPress={closeSheet} size="md" variant="secondary">Close</Button>
    </View> : activeSheet === "collectionEdit" ? <View style={styles.compactSheetActions}>
      <Button disabled={busy || !editName.trim()} loading={busy} onPress={() => void submitCollectionEdit()} size="md" variant="primary">Save</Button>
      <Button disabled={busy} onPress={closeSheet} size="md" variant="secondary">Close</Button>
    </View>
    : activeSheet === "similar" ? <Button disabled={similarLoading} onPress={closeSheet} size="md" variant="secondary">Close</Button>
    : activeSheet === "duplicates" ? <View style={styles.compactSheetActions}>
      <Button disabled={duplicatesLoading || duplicateSelectedCount === 0} onPress={() => pushSheet("confirmDeleteDuplicates")} size="md" variant="primary">Delete duplicates</Button>
      <Button disabled={duplicatesLoading} onPress={closeSheet} size="md" variant="secondary">Close</Button>
    </View> : activeSheet === "cleanup" ? <View style={styles.compactSheetActions}>
      <Button disabled={busy || cleanupLoading || cleanupLoadingMore || cleanupSelectedCount === 0} onPress={() => pushSheet("confirmCleanupDelete")} size="md" variant="primary">Delete</Button>
      <Button disabled={busy} onPress={closeSheet} size="md" variant="secondary">Close</Button>
    </View> : activeSheet === "visualIdentities" ? <View style={styles.compactSheetActions}>
      <Button disabled={identitiesLoading} onPress={() => void openIdentityPicker()} size="md" variant="primary">Create</Button>
      <Button onPress={closeSheet} size="md" variant="secondary">Close</Button>
    </View> : activeSheet === "identityPicker" ? <View style={styles.compactSheetActions}>
      <Button disabled={!identityPickerSelected} onPress={() => imagePickerPurpose === "cover" ? chooseCollectionCover() : pushSheet("identityName")} size="md" variant="primary">{imagePickerPurpose === "cover" ? "Choose" : "Next"}</Button>
      <Button onPress={imagePickerPurpose === "cover" ? goBackSheet : closeSheet} size="md" variant="secondary">Close</Button>
    </View> : activeSheet === "identityName" ? <View style={styles.compactSheetActions}>
      <Button disabled={!identityPickerSelected || !identityPickerName.trim()} onPress={() => void createVisualIdentity()} size="md" variant="primary">Create</Button>
      <Button onPress={closeSheet} size="md" variant="secondary">Close</Button>
    </View> : activeSheet === "transferDestination" ? <View style={styles.sheetFooter}>
    <Button disabled={!destinationCollectionKey} onPress={completeTransfer} size="md" style={styles.sheetFooterAction} variant="primary">{transferMode === "move" ? "Move" : "Copy"} {selectedImageKeys.length} image{selectedImageKeys.length === 1 ? "" : "s"}</Button>
    <Button onPress={closeSheet} size="md" style={styles.sheetFooterAction} variant="secondary">Close</Button>
  </View> : undefined;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher active="gallery" />
      </View>

      <ScrollView alwaysBounceVertical contentContainerStyle={[styles.scroll, { paddingBottom: spacing.md }]} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMoreImages(); }} refreshControl={<PullToRefresh onRefresh={refreshGallery} refreshing={userRefreshing} />} scrollEventThrottle={120} showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {!contextualView && (showingCollectionOverview || loading) ? (
          <View style={styles.galleryRoot}>
            <View style={styles.collectionTitleRow}>
              <WorkspaceAppSwitcher active="gallery" trigger="back" />
              <Text numberOfLines={1} style={styles.collectionTitle}>Gallery</Text>
              <Button accessibilityLabel="Create in Gallery" contentMode="raw" disabled={loading} onPress={() => openSheet("rootActions")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
            </View>
            {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
            <View style={styles.rootActions}>
              <View style={styles.collectionSearch}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput accessibilityLabel="Search Gallery collections" editable={!collectionSearchFocusBlocked} focusable={!collectionSearchFocusBlocked} onChangeText={setRootSearchQuery} onFocus={() => { if (collectionSearchFocusBlocked) { rootSearchInput.current?.blur(); Keyboard.dismiss(); } }} placeholder="Search..." ref={rootSearchInput} style={styles.rootSearchInput} value={rootSearchQuery} />
                {rootSearchQuery.trim() ? <Button accessibilityLabel="Clear Gallery search" contentMode="raw" iconOnly onPress={() => setRootSearchQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel="Filter Gallery" contentMode="raw" onPress={() => openSheet("filter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
            </View>
            <Tabs accessibilityRole="tablist" style={styles.collectionTabs}>
              <Button accessibilityRole="tab" accessibilityState={{ selected: collectionTab === "mine" }} onPress={() => setCollectionTab("mine")} size="xs" style={styles.collectionTab} variant={collectionTab === "mine" ? "secondary" : "ghost"}>Collections</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: collectionTab === "shared" }} onPress={() => setCollectionTab("shared")} size="xs" style={styles.collectionTab} variant={collectionTab === "shared" ? "secondary" : "ghost"}>Shared collections</Button>
            </Tabs>
            {filterBadges()}
            <View style={styles.collectionGrid}>
              {loading || rootSearchLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: collectionSize, height: collectionSize }]} />) : visibleCollections.map((collection) => (
                <View key={collection.key} style={[styles.collectionCard, { width: collectionSize, height: collectionSize }]}>
                  <CollectionCover collection={collection} />
                   <Button accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => { viewRequest.current += 1; setShowingCollectionOverview(false); setLoading(true); setImageOrigin("uploaded"); setQuery(""); setSelectedImageKeys([]); setActiveSubject(undefined); setShowingSearchResults(false); setActiveCollection(collection); }} size="xl" style={[styles.collectionMain, collectionHasCover(collection) && styles.coveredCollectionMain]} variant="ghost">
                    {collectionHasCover(collection) ? null : <FolderIcon size="lg" />}
                    <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.collectionName, collectionHasCover(collection) && styles.coveredCollectionName]}>{collection.name}</Text>
                  </Button>
                </View>
              ))}
              {!loading && !rootSearchLoading && visibleCollections.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyText}>{rootSearchQuery.trim() ? "No collections matched this search." : collectionTab === "shared" ? "No collections have been shared with you." : "No collections here yet."}</Text>{!rootSearchQuery.trim() && collectionTab === "mine" && canCreateCollections ? <Button accessibilityLabel="Create collection" contentMode="raw" onPress={() => { setPendingFiles([]); setNewCollectionName(""); openSheet("newCollection"); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
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
          {!managedCollection ? <View style={styles.sharingRow}><Button accessibilityLabel={`AI actions for ${activeCollection.name}`} contentMode="raw" onPress={() => openSheet("cleanupMenu")} size="sm" variant="icon"><BrainIcon size="sm" /></Button><Button accessibilityLabel={`Sharing and access for ${activeCollection.name}`} contentMode="raw" onPress={() => { closeSheet(); setSharingOpen(true); }} size="sm" variant="icon"><MemberIcon size="sm" /></Button></View> : null}
          {normalCollectionView ? <View style={styles.rootActions}>
            <View style={styles.collectionSearch}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel={`Search images in ${activeCollection.name}`} editable={!collectionSearchFocusBlocked} onChangeText={updateCollectionSearch} onFocus={() => { if (collectionSearchFocusBlocked) { collectionSearchInput.current?.blur(); Keyboard.dismiss(); } }} onSubmitEditing={() => { if (searchTimer.current) clearTimeout(searchTimer.current); void search(); }} placeholder="Search..." ref={collectionSearchInput} returnKeyType="search" style={styles.rootSearchInput} value={query} />
              {query.trim() ? <Button accessibilityLabel="Clear image search" contentMode="raw" hitSlop={8} iconOnly onPress={() => clearCollectionSearch()} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
            </View>
             <Button accessibilityLabel={`Filter ${activeCollection.name}`} contentMode="raw" onPress={() => openSheet("filter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
           </View> : null}
          {normalCollectionView ? <Tabs accessibilityLabel="Image origin" accessibilityRole="tablist" style={styles.collectionTabs}>
            <Button accessibilityRole="tab" accessibilityState={{ selected: imageOrigin === "uploaded" }} onPress={() => showImageOrigin("uploaded")} size="xs" style={styles.collectionTab} variant={imageOrigin === "uploaded" ? "secondary" : "ghost"}>Uploaded</Button>
            <Button accessibilityRole="tab" accessibilityState={{ selected: imageOrigin === "generated" }} onPress={() => showImageOrigin("generated")} size="xs" style={styles.collectionTab} variant={imageOrigin === "generated" ? "secondary" : "ghost"}>Generated</Button>
          </Tabs> : null}
          {bulkToolbar}
          {filterBadges(true)}
          {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
           {(loading || (searching || loadingMore && showOnlyFavorites) && visibleImages.length === 0) && visibleGenerationPlaceholders.length === 0 ? <View accessibilityLabel={searching ? "Searching images" : "Loading images"} accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: imageSize, height: imageSize }]} />)}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 && visibleGenerationPlaceholders.length === 0 && normalCollectionView ? <View style={styles.emptyState}><Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : emptyGridMessage}</Text>{collectionSearchActive || showOnlyFavorites || !canAddImages ? null : imageOrigin === "uploaded" ? <Button accessibilityLabel={`Upload images to ${activeCollection.name}`} contentMode="raw" onPress={() => void choosePhotos()} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : !managedCollection && collectionRole !== "viewer" && activeCollection.access.canContribute ? <Button accessibilityLabel={`Generate images in ${activeCollection.name}`} contentMode="raw" onPress={() => setGenerationOpen(true)} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 && visibleGenerationPlaceholders.length === 0 ? <Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : emptyGridMessage}</Text> : (
            <View style={styles.imageSections}>
              {visibleImageGroups.map((group) => <View key={group.label} style={styles.dateGroup}>
                <Text style={styles.dateHeading}>{group.label}</Text>
                <View style={styles.grid}>{group.images.map((entry) => entry.kind === "generation" ? <Skeleton accessibilityLabel="Generating image" accessibilityRole="progressbar" key={entry.key} style={[styles.imageSkeleton, { width: imageSize, height: imageSize }]} /> : entry.kind === "optimistic" ? (
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
           {filterBadges(true)}
          {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
           {visibleImages.length ? <View style={styles.grid}>{visibleImages.map((image) => <Button key={image.key} accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => handleImagePress(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost"><View style={styles.imageFrame}><Image source={image.url} contentFit="cover" style={styles.image} transition={150} /></View></Button>)}</View> : <View style={styles.emptyState}><Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : emptyGridMessage}</Text></View>}
        </View> : null}
      </ScrollView>

      <CoreComposer
        accessory={returnToSignalAttachments ? <Button accessibilityLabel="Back to Signal attachments" contentMode="raw" onPress={returnToSignalAttachments} size="sm" style={styles.tripReturn} variant="secondary"><Text numberOfLines={1} style={styles.tripReturnText}>Signal attachments</Text><ChevronRightIcon size="sm" /></Button> : returnToTripAssets ? <Button accessibilityLabel={`Back to ${returnTripName ?? "trip"} assets`} contentMode="raw" onPress={returnToTripAssets} size="sm" style={styles.tripReturn} variant="secondary"><Text numberOfLines={1} style={styles.tripReturnText}>{returnTripName ?? "Trip"}</Text><ChevronRightIcon size="sm" /></Button> : undefined}
        accessibilityLabel="Ask Core about your Gallery"
        disabled={assistantBusy}
        editable={!assistantBusy}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        loading={assistantBusy}
        message={aiResponse ? <Text numberOfLines={3} style={styles.aiResponse}>{aiResponse}</Text> : null}
        onChangeText={setAiInput}
        onFocusChange={handleCoreFocusChange}
        onSubmit={() => void askAssistant()}
        pageIdentity={(closeCore) => <WorkspaceAppSwitcher active="gallery" identity="core" onSelectActive={closeCore} />}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" variant="inverse" />}
        value={aiInput}
      />

      {activeCollection && !managedCollection ? <GalleryHighlights collection={activeCollection} key={`highlights:${activeCollection.key}`} onClose={() => setHighlightsOpen(false)} open={highlightsOpen} /> : null}
      {activeCollection && !managedCollection ? <GalleryMemories collection={activeCollection} key={`memories:${activeCollection.key}`} onClose={() => setMemoriesOpen(false)} open={memoriesOpen} /> : null}
      {activeCollection && !managedCollection && activeCollection.access.canContribute && collectionRole !== "viewer" ? <GalleryImageGeneration collection={activeCollection} key={`generation:${activeCollection.key}`} onClose={() => setGenerationOpen(false)} onGenerate={(input, requestKey) => void generateImages(input, requestKey)} open={generationOpen} /> : null}

      <SearchHistorySheet error={status} history={history} loading={historyLoading} onClose={closeSheet} onRemove={(item) => void removeHistoryQuery(item)} onSelect={applyHistoryQuery} open={!sharingOpen && sheetOpen && activeSheet === "searchHistory"} removingQuery={removingHistoryQuery} />

      <BottomSheet
        footer={<Button onPress={closeSheet} size="md" variant="secondary">Close</Button>}
        height="full"
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        onSwipeLeft={collectionViewerImages.length > 1 ? () => focusCollectionImage(1) : undefined}
        onSwipeRight={collectionViewerImages.length > 1 ? () => focusCollectionImage(-1) : undefined}
        open={!sharingOpen && sheetOpen && (activeSheet === "image" || activeSheet === "imageActions") && Boolean(selectedImage || selectedOptimisticItem)}
        pageKey={selectedImage?.key ?? selectedOptimisticItem?.clientKey}
        title={selectedImage?.filename ?? selectedOptimisticItem?.filename ?? "Image"}
      >
        {selectedImage || selectedOptimisticItem ? <View style={styles.detail}>
          <View style={styles.detailMenuRow}>
            {selectedImage && (activeCollection || !isManagedGalleryImage(selectedImage)) ? <Button accessibilityLabel="Open image actions" contentMode="raw" onPress={() => pushSheet("imageActions")} size="md" style={styles.detailMenuButton} variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}
          </View>
          <View accessibilityActions={collectionViewerImages.length > 1 ? [{ name: "decrement", label: "Previous image" }, { name: "increment", label: "Next image" }] : undefined} accessibilityLabel={`${selectedImage?.filename ?? selectedOptimisticItem?.filename ?? "Image"} collection image`} accessibilityRole="adjustable" onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "decrement") focusCollectionImage(-1); if (nativeEvent.actionName === "increment") focusCollectionImage(1); }} onLayout={({ nativeEvent }) => setImageViewerSize(nativeEvent.layout)} style={styles.detailImageFrame}>{selectedImage && imageViewerSize.width > 0 && imageViewerSize.height > 0 ? <GalleryViewerImage image={selectedImage} viewport={imageViewerSize} /> : null}</View>
        </View> : null}
      </BottomSheet>

      <BottomSheet
        description={activeSheet === "destination" ? `${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"} ready to upload.` : activeSheet === "transferDestination" ? "Choose one destination collection." : activeSheet === "cleanup" ? "Choose a quality threshold to find and remove lower-quality images. Images are scored from 1 to 100." : undefined}
        dismissible={!busy}
        footer={sheetFooter}
        focusKey={activeSheet}
        hideHeading={activeSheet === "rootActions" || activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "filter" || activeSheet === "imageActions" || activeSheet === "bulkActions" || activeSheet === "cleanupMenu"}
        height={activeSheet === "destination" || activeSheet === "imageEdit" || activeSheet === "newCollection" || activeSheet === "collectionEdit" || activeSheet === "similar" || activeSheet === "duplicates" || activeSheet === "cleanup" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory" ? "full" : undefined}
        onOpenChange={(open) => { if (!open) { if (activeSheetRef.current === "imageActions") goBackSheet(); else closeSheet(); } }}
        open={!sharingOpen && sheetOpen && activeSheet !== "image" && activeSheet !== "searchHistory"}
        title={sheetTitle}
      >
        {activeSheet === "cleanup" ? <FlatList
          columnWrapperStyle={styles.cleanupGridRow}
          contentContainerStyle={styles.cleanupListContent}
          data={cleanupImages}
          keyExtractor={({ key }) => key}
          ListEmptyComponent={cleanupLoading ? <View accessibilityLabel="Loading cleanup images" accessibilityRole="progressbar" style={styles.cleanupGridRow}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View> : <View style={styles.cleanupEmpty}><Text accessibilityRole={cleanupError ? "alert" : undefined} style={styles.emptyText}>{cleanupError ?? "No scored images found at this threshold."}</Text></View>}
          ListFooterComponent={cleanupLoadingMore ? <View accessibilityLabel="Loading more cleanup images" accessibilityRole="progressbar" style={styles.cleanupGridRow}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={`cleanup-more-${index}`} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View> : null}
          ListHeaderComponent={<View style={styles.cleanupHeader}><Tabs accessibilityRole="tablist" style={styles.cleanupTabs}>{CLEANUP_THRESHOLDS.map((threshold) => <Button key={threshold} accessibilityLabel={`Quality threshold ${threshold}`} accessibilityRole="tab" accessibilityState={{ selected: cleanupThreshold === threshold }} disabled={busy} onPress={() => void loadCleanupImages(threshold)} size="md" style={styles.cleanupTab} variant={cleanupThreshold === threshold ? "secondary" : "ghost"}>{threshold}</Button>)}</Tabs>{cleanupError && cleanupImages.length > 0 ? <View accessibilityLiveRegion="polite" style={styles.inlineError}><Text style={styles.inlineErrorText}>{cleanupError}</Text></View> : null}</View>}
          numColumns={IMAGE_COLUMNS}
          onEndReached={() => void loadMoreCleanupImages()}
          onEndReachedThreshold={0.4}
          renderItem={({ item: image }) => { const selected = cleanupSelectedImageKeys.includes(image.key); return <Button accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.filename} for cleanup`} accessibilityState={{ selected }} contentMode="raw" disabled={busy} onPress={() => toggleDeletionSelection(image.key, setCleanupSelectedImageKeys)} size="md" style={[styles.imageButton, styles.cleanupCard, { width: sheetImageSize, height: sheetImageSize }]} variant="ghost"><View style={[styles.imageFrame, selected && styles.imageFrameSelected]}><Image source={image.url} contentFit="cover" style={styles.image} />{selected ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>; }}
          showsVerticalScrollIndicator={false}
          style={styles.fullSheetScroll}
        /> : activeSheet === "similar" ? <FlatList columnWrapperStyle={styles.cleanupGridRow} contentContainerStyle={styles.similarListContent} data={similarLoading ? [] : similarImages} keyExtractor={({ key }) => key} ListEmptyComponent={similarLoading ? <View accessibilityLabel="Loading similar images" accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View> : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>{similarError ?? "No similar images found in this collection."}</Text></View>} numColumns={IMAGE_COLUMNS} renderItem={({ item: image }) => <Button accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => showSimilarImage(image)} size="md" style={[styles.imageButton, { width: sheetImageSize, height: sheetImageSize }]} variant="ghost"><View style={styles.imageFrame}><Image source={image.url} contentFit="cover" style={styles.image} /></View></Button>} showsVerticalScrollIndicator={false} style={styles.fullSheetScroll} /> : <ScrollView contentContainerStyle={[styles.sheetContent, (activeSheet === "destination" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetContent]} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (activeSheet === "identityPicker" && isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMoreIdentityPickerImages(); }} scrollEventThrottle={120} showsVerticalScrollIndicator={false} style={[styles.sheetScroll, (activeSheet === "destination" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "transferDestination" || activeSheet === "searchHistory") && styles.fullSheetScroll, { maxHeight: activeSheet === "destination" || activeSheet === "transferDestination" || activeSheet === "duplicates" || activeSheet === "imageEdit" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "identityName" || activeSheet === "searchHistory" ? undefined : height * 0.6 }]}>
        {activeSheet === "rootActions" ? <BottomSheetMenu>
          {canCreateCollections ? <BottomSheetItem onPress={() => { setPendingFiles([]); setNewCollectionName(""); pushSheet("newCollection"); }} style={styles.sheetAction} variant="secondary">Create collection</BottomSheetItem> : null}
          {canManageAnyCollection ? <BottomSheetItem onPress={() => void openIdentityPicker()} style={styles.sheetAction} variant="secondary">Create visual identity</BottomSheetItem> : null}
        </BottomSheetMenu> : null}
        {activeSheet === "actions" ? <BottomSheetMenu>
          <BottomSheetItem disabled={busy} loading={busy} onPress={() => void choosePhotos()} style={styles.sheetAction} variant="secondary">Upload images</BottomSheetItem>
          <BottomSheetItem disabled={busy} loading={busy} onPress={() => void takePhoto()} style={styles.sheetAction} variant="secondary">Capture images</BottomSheetItem>
          {isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={() => void openIdentityPicker()} style={styles.sheetAction} variant="secondary">Create visual identity</BottomSheetItem> : null}
        </BottomSheetMenu> : null}
        {activeSheet === "destination" ? <>
          <View style={styles.destinationGrid}>{writableCollections.map((collection) => <View key={collection.key} style={[styles.destinationCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}>
            <CollectionCover collection={collection} />
            <Button accessibilityLabel={`Upload to ${collection.name}`} contentMode="raw" disabled={busy} onPress={() => void uploadTo(collection.key)} shape="rounded" size="md" style={[styles.collectionMain, collectionHasCover(collection) && styles.coveredCollectionMain]} variant="ghost">
              {collectionHasCover(collection) ? null : <FolderIcon size="lg" />}
              <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.collectionName, collectionHasCover(collection) && styles.coveredCollectionName]}>{collection.name}</Text>
            </Button>
          </View>)}</View>
          {canCreateCollections ? <BottomSheetItem contentMode="raw" onPress={() => { setNewCollectionName(""); openSheet("newCollection"); }} variant="ghost"><View style={styles.sheetItem}><PlusIcon size="md" /><Text style={styles.sheetText}>New collection</Text></View></BottomSheetItem> : null}
        </> : null}
        {activeSheet === "newCollection" ? <View style={styles.form}>
          <TextInput accessibilityLabel="Collection name" editable={!busy} onChangeText={setNewCollectionName} placeholder="Name" returnKeyType="done" style={styles.formInput} value={newCollectionName} />
        </View> : null}
        {activeSheet === "collectionMenu" ? <BottomSheetMenu>
          {isCollectionOwner && !managedCollection ? <BottomSheetItem disabled={busy} onPress={openCollectionEdit} style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem> : null}
          {isCollectionOwner && !managedCollection ? <BottomSheetItem disabled={busy} onPress={() => void openVisualIdentities()} style={styles.sheetAction} variant="secondary">Visual identities</BottomSheetItem> : null}
          <BottomSheetItem disabled={busy} onPress={() => { if (activeCollection) setHiddenOptimistically("collection", activeCollection.key, !hidden("collection", activeCollection.key), "Collection"); }} style={styles.sheetAction} variant="secondary">{activeCollection && hidden("collection", activeCollection.key) ? "Reveal" : "Hide"}</BottomSheetItem>
          {!managedCollection ? isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={() => pushSheet("confirmDeleteCollection")} style={styles.sheetAction} variant="secondary">Delete collection</BottomSheetItem> : <BottomSheetItem disabled={busy} onPress={() => pushSheet("confirmLeaveCollection")} style={styles.sheetAction} variant="secondary">Leave</BottomSheetItem> : null}
        </BottomSheetMenu> : null}
        {activeSheet === "cleanupMenu" ? <BottomSheetMenu>
          {collectionRole !== "viewer" && activeCollection?.access.canContribute ? <BottomSheetItem disabled={busy} onPress={() => { closeSheet(); setGenerationOpen(true); }} style={styles.sheetAction} variant="secondary">Generate images</BottomSheetItem> : null}
          <BottomSheetItem disabled={busy} onPress={() => { closeSheet(); setMemoriesOpen(true); }} style={styles.sheetAction} variant="secondary">Memories</BottomSheetItem>
          <BottomSheetItem disabled={busy} onPress={() => { closeSheet(); setHighlightsOpen(true); }} style={styles.sheetAction} variant="secondary">Highlights</BottomSheetItem>
          {isCollectionOwner ? <BottomSheetItem disabled={busy} onPress={() => void showDuplicates()} style={styles.sheetAction} variant="secondary">Find duplicates</BottomSheetItem> : null}
          {isCollectionOwner ? <BottomSheetItem onPress={() => void showCleanup()} style={styles.sheetAction} variant="secondary">Clean up</BottomSheetItem> : null}
        </BottomSheetMenu> : null}
        {activeSheet === "imageActions" && selectedImage ? <BottomSheetMenu>
          {canMutateImage(selectedImage) ? <BottomSheetItem onPress={openImageEdit} style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem> : null}
          {activeCollection ? <BottomSheetItem onPress={() => void findSimilar()} style={styles.sheetAction} variant="secondary">Find similar</BottomSheetItem> : null}
          {!managedCollection && !isManagedGalleryImage(selectedImage) ? <BottomSheetItem onPress={() => setHiddenOptimistically("image", selectedImage.key, !hidden("image", selectedImage.key), "Image")} style={styles.sheetAction} variant="secondary">{hidden("image", selectedImage.key) ? "Reveal" : "Hide"}</BottomSheetItem> : null}
          {canMutateImage(selectedImage) ? <BottomSheetItem onPress={() => pushSheet("confirmDeleteImage")} style={styles.sheetAction} variant="secondary">Delete image</BottomSheetItem> : null}
        </BottomSheetMenu> : null}
        {activeSheet === "imageEdit" && selectedImage ? <View style={styles.form}>
          <TextInput accessibilityLabel="Image name" editable={!busy} maxLength={255} onChangeText={setEditName} placeholder="Image name" style={styles.formInput} value={editName} />
          <View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Favorite image" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteSwitchLabel}>Favorite</Text></View>
        </View> : null}
        {activeSheet === "collectionEdit" && activeCollection ? <View style={styles.form}>
          <TextInput accessibilityLabel="Collection name" editable={!busy} maxLength={120} onChangeText={setEditName} placeholder="Collection name" style={styles.formInput} value={editName} />
          <View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Favorite collection" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteSwitchLabel}>Favorite</Text></View>
          <View style={styles.collectionCoverField}>
            <Text style={styles.sheetSubtitle}>Cover</Text>
            <View style={styles.collectionCoverControl}>
              <Button accessibilityLabel={editCoverPreviewUrl ? "Change collection cover" : "Choose collection cover"} contentMode="raw" disabled={busy} onPress={() => void openCollectionCoverPicker()} shape="rounded" size="md" style={styles.collectionCoverButton} variant="secondary">
                {editCoverPreviewUrl ? <Image contentFit="cover" source={editCoverPreviewUrl} style={styles.collectionCover} /> : <FolderIcon size="lg" />}
              </Button>
              {editCoverPreviewUrl ? <Button accessibilityLabel="Clear collection cover" contentMode="raw" disabled={busy} iconOnly onPress={() => { setEditCoverImageKey(null); setEditCoverPreviewUrl(null); }} size="md" style={styles.collectionCoverRemove} variant="secondary"><CloseIcon size="sm" /></Button> : null}
            </View>
          </View>
        </View> : null}
        {activeSheet === "confirmDeleteImage" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={deleteSelectedImage} size="md" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="md" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "confirmDeleteCollection" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={() => void removeActiveCollection()} size="md" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="md" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "confirmLeaveCollection" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={() => void leaveActiveCollection()} size="md" variant="primary">Leave</Button>
          <Button disabled={busy} onPress={goBackSheet} size="md" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "duplicates" ? <View style={styles.duplicatePanel}>
          {duplicatesLoading ? <View accessibilityLabel="Loading duplicate images" accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View>
            : duplicateImages.length ? <View style={styles.grid}>{duplicateImages.map((image) => { const selected = duplicateSelectedImageKeys.includes(image.key); return <Button key={image.key} accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.filename} for duplicate deletion`} accessibilityState={{ selected }} contentMode="raw" disabled={busy} onPress={() => toggleDeletionSelection(image.key, setDuplicateSelectedImageKeys)} size="md" style={[styles.duplicateImageButton, { width: sheetImageSize, height: sheetImageSize }]} variant="ghost"><View style={[styles.imageFrame, selected && styles.imageFrameSelected]}><Image source={image.url} contentFit="cover" style={styles.image} />{selected ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>; })}</View>
              : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>{duplicatesError ?? "No duplicate images found in this collection."}</Text></View>}
        </View> : null}
        {activeSheet === "filter" ? <View style={styles.filterPanel}>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel="Show only Gallery favorites" checked={showOnlyFavorites} onCheckedChange={(checked) => { setViewFilters((current) => ({ ...current, favoritesOnly: checked })); closeSheet(); }} />
            <Text style={styles.favoriteSwitchLabel}>Favorites</Text>
          </View>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel="Show hidden Gallery items" checked={showHidden} onCheckedChange={(checked) => { setViewFilters((current) => ({ ...current, showHidden: checked })); closeSheet(); }} />
            <Text style={styles.favoriteSwitchLabel}>Show hidden</Text>
          </View>
          <Button onPress={() => void openSearchHistory(activeCollection ? "gallery" : "root")} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button>
        </View> : null}
        {activeSheet === "identityPickerFilter" ? <View style={styles.filterPanel}>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel="Show only favorite picker items" checked={showOnlyFavorites} onCheckedChange={(checked) => setViewFilters((current) => ({ ...current, favoritesOnly: checked }))} />
            <Text style={styles.favoriteSwitchLabel}>Favorites</Text>
          </View>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel="Show hidden picker items" checked={showHidden} onCheckedChange={(checked) => setViewFilters((current) => ({ ...current, showHidden: checked }))} />
            <Text style={styles.favoriteSwitchLabel}>Show hidden</Text>
          </View>
          <Button onPress={() => void openVisualIdentities()} size="md" variant="secondary">Visual identities</Button>
          <Button onPress={() => void openSearchHistory("identityPicker")} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button>
        </View> : null}
        {activeSheet === "visualIdentities" ? <View style={styles.identityLibrary}>
          {identityError && activeSubjects.length > 0 ? <View accessibilityLiveRegion="polite" style={styles.inlineError}><Text style={styles.inlineErrorText}>{identityError}</Text></View> : null}
          {identitiesLoading || creatingIdentityKeys.length > 0 ? <View accessibilityLabel="Loading visual identities" accessibilityRole="progressbar" style={styles.collectionGrid}>{Array.from({ length: COLLECTION_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: destinationCollectionSize, height: destinationCollectionSize }]} />)}</View>
            : activeSubjects.length ? <View style={styles.collectionGrid}>{activeSubjects.map((identity) => <View key={identity.key} style={[styles.collectionCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}>
              <Image source={identity.referenceUrl} contentFit="cover" style={styles.collectionCover} />
              <Button accessibilityLabel={`${identity.name}, ${identity.imageCount} matching images`} contentMode="raw" disabled={creatingIdentityKeys.includes(identity.key)} onPress={() => void filterByVisualIdentity(identity)} size="md" style={[styles.collectionMain, styles.coveredCollectionMain]} variant="ghost">
                <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.collectionName, styles.coveredCollectionName]}>{identity.name}</Text>
              </Button>
              {!creatingIdentityKeys.includes(identity.key) ? <Button accessibilityLabel={`Delete visual identity ${identity.name}`} contentMode="raw" onPress={() => confirmDeleteVisualIdentity(identity)} size="md" style={styles.thumbnailRemove} variant="icon"><CloseIcon size="sm" /></Button> : null}
            </View>)}</View> : <View style={styles.duplicateEmpty}><Text accessibilityRole={identityError ? "alert" : undefined} style={styles.emptyText}>{identityError ?? "No visual identities yet."}</Text></View>}
        </View> : null}
        {activeSheet === "confirmDeleteIdentity" ? <View style={styles.compactSheetActions}>
          <Button disabled={!identityPendingDelete} onPress={deleteVisualIdentity} size="md" variant="primary">Delete</Button>
          <Button onPress={goBackSheet} size="md" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "identityPicker" ? <View style={styles.identityPicker}>
          <Text style={styles.sheetSubtitle}>{imagePickerPurpose === "cover" ? `Choose an existing image from ${activeCollection?.name ?? "this collection"}.` : "Choose an image to create a visual identity from."}</Text>
          {identityPickerCollection ? <View style={styles.destinationLocationLane}><Button accessibilityLabel="Back to collections" contentMode="raw" onPress={backIdentityPicker} size="md" variant="icon"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.destinationLocationTitle}>{identityPickerCollection.name}</Text></View> : null}
          <View style={styles.rootActions}>
            <View style={styles.collectionSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search images for visual identity" onChangeText={updateIdentityPickerSearch} placeholder="Search images..." style={styles.rootSearchInput} value={identityPickerQuery} />{identityPickerQuery.trim() ? <Button accessibilityLabel="Clear image search" contentMode="raw" iconOnly onPress={() => updateIdentityPickerSearch("")} size="md" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
            <Button accessibilityLabel="Filter visual identity image picker" contentMode="raw" onPress={() => pushSheet("identityPickerFilter")} size="md" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
          </View>
          {filterBadges()}
          {!identityPickerCollection && !identityPickerQuery.trim() ? <View style={[styles.collectionGrid, !identityPickerLoading && identityPickerVisibleCollections.length === 0 && styles.sheetEmptyContent]}>
            {identityPickerLoading ? Array.from({ length: COLLECTION_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: destinationCollectionSize, height: destinationCollectionSize }]} />) : identityPickerVisibleCollections.map((collection) => <View key={collection.key} style={[styles.collectionCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}><CollectionCover collection={collection} /><Button accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => void openIdentityPickerCollection(collection)} size="md" style={[styles.collectionMain, collectionHasCover(collection) && styles.coveredCollectionMain]} variant="ghost">{collectionHasCover(collection) ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.collectionName, collectionHasCover(collection) && styles.coveredCollectionName]}>{collection.name}</Text></Button></View>)}
            {!identityPickerLoading && identityPickerVisibleCollections.length === 0 ? <Text style={styles.emptyText}>No collections found.</Text> : null}
          </View> : null}
          {identityPickerCollection || identityPickerQuery.trim() ? identityPickerSearching || identityPickerLoading && identityPickerVisibleImages.length === 0 ? <View accessibilityLabel="Loading images" accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View> : identityPickerVisibleImages.length ? <View style={styles.grid}>{identityPickerVisibleImages.map((image) => { const selected = identityPickerSelected?.key === image.key; return <Button key={image.key} accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.filename}`} accessibilityState={{ selected }} contentMode="raw" onPress={() => setIdentityPickerSelected(selected ? undefined : image)} size="md" style={[styles.imageButton, { width: sheetImageSize, height: sheetImageSize }]} variant="ghost"><View style={[styles.imageFrame, selected && styles.imageFrameSelected]}><Image source={image.url} contentFit="cover" style={styles.image} />{selected ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>; })}{identityPickerLoading ? Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={`picker-more-${index}`} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />) : null}</View> : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>No images found.</Text></View> : null}
        </View> : null}
        {activeSheet === "identityName" && identityPickerSelected ? <View style={styles.identityNameForm}>
          <TextInput accessibilityLabel="Visual identity name" maxLength={120} onChangeText={setIdentityPickerName} placeholder="Name" value={identityPickerName} />
          <Button accessibilityLabel="Choose a different visual identity image" contentMode="raw" onPress={goBackSheet} shape="rounded" size="md" style={styles.identityImageButton} variant="secondary">
            <Image contentFit="cover" source={identityPickerSelected.url} style={styles.identityImage} />
          </Button>
        </View> : null}
        {activeSheet === "bulkActions" ? <BottomSheetMenu>
          <Button disabled={busy} loading={busy} onPress={() => void updateSelectedFavorites()} size="md" variant="secondary">{allSelectedFavorite ? "Unfavorite" : "Favorite"}</Button>
          <Button disabled={busy || !activeCollection} onPress={() => openTransfer("move")} size="md" variant="secondary">Move to collection</Button>
          <Button disabled={busy || !activeCollection} onPress={() => openTransfer("copy")} size="md" variant="secondary">Copy to collection</Button>
          <Button disabled={busy} onPress={() => pushSheet("bulkDelete")} size="md" variant="secondary">Delete</Button>
        </BottomSheetMenu> : null}
        {activeSheet === "bulkDelete" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={deleteSelectedImages} size="md" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="md" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "transferDestination" ? <View style={styles.destinationBrowser}>
          <View style={styles.destinationLocationLane}><Text numberOfLines={1} style={styles.destinationLocationTitle}>Gallery</Text></View>
          <View style={[styles.destinationGrid, writableCollections.filter(({ key }) => key !== activeCollection?.key).length === 0 && styles.sheetEmptyContent]}>{writableCollections.filter(({ key }) => key !== activeCollection?.key).map((collection) => {
            const selected = destinationCollectionKey === collection.key;
            return <View key={collection.key} style={[styles.destinationCard, selected && styles.destinationCardSelected, { width: destinationCollectionSize, height: destinationCollectionSize }]}>
              <CollectionCover collection={collection} />
              <Button accessibilityLabel={`${selected ? "Remove" : "Select"} ${collection.name}`} accessibilityState={{ selected }} contentMode="raw" onPress={() => setDestinationCollectionKey(selected ? undefined : collection.key)} shape="rounded" size="md" style={[styles.collectionMain, collectionHasCover(collection) && styles.coveredCollectionMain]} variant="ghost">
                {collectionHasCover(collection) ? null : <FolderIcon size="lg" />}
                <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.collectionName, collectionHasCover(collection) && styles.coveredCollectionName]}>{collection.name}</Text>
                {selected ? <View style={styles.destinationBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
              </Button>
            </View>;
          })}
          {writableCollections.filter(({ key }) => key !== activeCollection?.key).length === 0 ? <Text style={styles.emptyText}>No writable destination collections are available.</Text> : null}
          </View>
        </View> : null}
        {activeSheet === "confirmDeleteDuplicates" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy || duplicateSelectedCount === 0} loading={busy} onPress={() => void deleteDuplicates()} size="md" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="md" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "confirmCleanupDelete" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy || cleanupSelectedCount === 0} loading={busy} onPress={() => void deleteCleanupImages()} size="md" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="md" variant="secondary">Close</Button>
        </View> : null}
        </ScrollView>}
      </BottomSheet>
      {activeCollection ? <GalleryCollectionSharing collection={activeCollection} context={galleryContext} memberKeys={memberKeys} onClose={() => setSharingOpen(false)} open={sharingOpen} /> : null}
      {cameraOpen ? <GalleryCaptureModal onClose={() => setCameraOpen(false)} onSubmit={uploadCapturedPhotos} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, justifyContent: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  galleryRoot: { flexGrow: 1, gap: spacing.md },
  rootActions: { minHeight: 52, marginTop: -spacing.xs, flexDirection: "row", alignItems: "center", gap: 8 },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  searchHistoryButton: { width: 44, height: 44 },
  statusCard: { marginBottom: spacing.sm, paddingHorizontal: 13, paddingVertical: 10, borderLeftWidth: 2, borderLeftColor: palette.silver700, borderRadius: radii.md, backgroundColor: palette.panel },
  status: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  collectionView: { flexGrow: 1, gap: spacing.md },
  collectionTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  collectionTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  collectionTitleActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  collectionTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  collectionTab: { flex: 1 },
  sharingRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  collectionSearch: { minHeight: 44, flex: 1, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  bulkToolbar: { minHeight: 40, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  similarPill: { alignSelf: "flex-start", maxWidth: "100%", minHeight: 38, padding: 4, paddingLeft: 5, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, backgroundColor: palette.panel },
  filterBadgeRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
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
  managedCollectionLogo: { position: "absolute", top: spacing.sm, right: spacing.sm, bottom: spacing.sm, left: spacing.sm },
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
  tripReturn: { width: "100%", minHeight: 40, justifyContent: "flex-start", paddingHorizontal: spacing.sm },
  tripReturnText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { gap: 4, paddingBottom: 4 },
  fullSheetScroll: { flex: 1 },
  fullSheetContent: { flexGrow: 1 },
  sheetText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
  sheetSubtitle: { marginTop: 3, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  actionMenu: { gap: 8 },
  duplicatePanel: { flexGrow: 1, minHeight: 320 },
  duplicateEmpty: { flexGrow: 1, minHeight: 320, alignItems: "center", justifyContent: "center" },
  similarListContent: { flexGrow: 1, paddingBottom: spacing.lg },
  cleanupListContent: { flexGrow: 1, paddingBottom: 4 },
  cleanupHeader: { gap: spacing.sm, marginBottom: spacing.sm },
  cleanupGridRow: { flexDirection: "row", gap: GRID_GAP },
  cleanupCard: { marginBottom: GRID_GAP },
  cleanupTabs: { flexDirection: "row", gap: 3, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  cleanupTab: { flex: 1 },
  cleanupEmpty: { flexGrow: 1, minHeight: 320, alignItems: "center", justifyContent: "center" },
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
  confirmationText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: "center" },
  filterPanel: { gap: 6 },
  searchHistoryOption: { backgroundColor: palette.page },
  favoriteSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  sheetEmptyContent: { flexGrow: 1, alignContent: "center", alignItems: "center", justifyContent: "center" },
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
  collectionCoverControl: { width: 96, height: 96, position: "relative", alignSelf: "flex-start" },
  collectionCoverButton: { width: 96, height: 96, overflow: "hidden", paddingHorizontal: 0, paddingVertical: 0 },
  collectionCoverRemove: { width: 42, height: 42, minHeight: 42, paddingHorizontal: 0, paddingVertical: 0, position: "absolute", right: -12, top: -12 },
  detail: { flex: 1, gap: 8 },
  detailMenuRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  detailMenuButton: { width: 34, height: 34, minHeight: 34 },
  detailImageFrame: { flex: 1, width: "100%", overflow: "hidden", alignItems: "center", justifyContent: "center" },
  detailImage: { borderRadius: radii.lg },
  detailActions: { flexDirection: "row", gap: 8 },
  detailActionsCompact: { flexDirection: "column" },
  detailAction: { flex: 1 },
  detailActionCompact: { flex: 0, width: "100%" },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(176, 74, 74, 0.45)", backgroundColor: "rgba(176, 74, 74, 0.1)" },
  inlineErrorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
});

function GalleryViewerImage({ image, viewport }: { image: GalleryImage; viewport: { width: number; height: number } }) {
  const scale = image.width > 0 && image.height > 0 ? Math.min(viewport.width / image.width, viewport.height / image.height) : 1;
  return <Image contentFit="contain" source={image.url} style={[styles.detailImage, { width: image.width > 0 ? image.width * scale : viewport.width, height: image.height > 0 ? image.height * scale : viewport.height }]} />;
}
