import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import type { CameraCapturedPicture } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { SearchHistoryPill } from "@vorinthex/shared/ui/search-history-pill";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { CheckIcon, ChevronLeftIcon, CloseIcon, FilterIcon, FolderIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { appendCursorItems, isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { BrandedCameraModal } from "@/components/capability/BrandedCameraModal";
import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource } from "@/data/capability-icons";
import {
  askGalleryAssistant,
  createGalleryCollection,
  createGallerySubject,
  deleteGalleryCollection,
  deleteGalleryCollectionDuplicates,
  deleteGalleryImages,
  fetchGalleryOverview,
  fetchGalleryUploadStatus,
  filterCollections,
  filterMediaItems,
  findGalleryCollectionDuplicates,
  getGalleryContext,
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

type GallerySheet = "rootActions" | "actions" | "destination" | "newCollection" | "image" | "imageActions" | "imageEdit" | "confirmDeleteImage" | "collectionMenu" | "collectionEdit" | "confirmDeleteCollection" | "duplicates" | "confirmDeleteDuplicates" | "visualIdentities" | "identityPicker" | "identityPickerFilter" | "transferDestination" | "filter" | "searchHistory" | "bulkActions" | "bulkDelete";
type IdentityLibraryMode = "browse" | "filter";
type CollectionTransferMode = "copy" | "move";
type OptimisticMediaItem = PreparedGalleryUpload & { batchKey: string; collectionKey: string };
const COLLECTION_COLUMNS = 3;
const IMAGE_COLUMNS = 4;
const GRID_GAP = 5;
const COLLECTION_GAP = 10;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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
  const galleryContext = getGalleryContext();
  const contentContext = getContentContext();
  const showOnlyFavorites = useAuthStore((state) => state.user?.settings.gallery.showOnlyFavorites ?? false);
  const setGalleryShowOnlyFavorites = useAuthStore((state) => state.setGalleryShowOnlyFavorites);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [collections, setCollections] = useState<GalleryCollection[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [activeCollection, setActiveCollection] = useState<GalleryCollection>();
  const [showingCollectionOverview, setShowingCollectionOverview] = useState(true);
  const [subjects, setSubjects] = useState<GallerySubject[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [identityLibraryMode, setIdentityLibraryMode] = useState<IdentityLibraryMode>("browse");
  const [identityPickerCollection, setIdentityPickerCollection] = useState<GalleryCollection>();
  const [identityPickerImages, setIdentityPickerImages] = useState<GalleryImage[]>([]);
  const [identityPickerResults, setIdentityPickerResults] = useState<GalleryImage[]>();
  const [identityPickerQuery, setIdentityPickerQuery] = useState("");
  const [identityPickerName, setIdentityPickerName] = useState("");
  const [identityPickerSelected, setIdentityPickerSelected] = useState<GalleryImage>();
  const [identityPickerLoading, setIdentityPickerLoading] = useState(false);
  const [identityPickerSearching, setIdentityPickerSearching] = useState(false);
  const [identityPickerNextCursor, setIdentityPickerNextCursor] = useState<string | null>(null);
  const [creatingIdentityKeys, setCreatingIdentityKeys] = useState<string[]>([]);
  const [activeSubject, setActiveSubject] = useState<GallerySubject>();
  const [activeIdentityFilter, setActiveIdentityFilter] = useState<GallerySubject>();
  const [selectedImage, setSelectedImage] = useState<GalleryImage>();
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([]);
  const [similarSource, setSimilarSource] = useState<GalleryImage>();
  const [duplicateImages, setDuplicateImages] = useState<GalleryImage[]>([]);
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicatesError, setDuplicatesError] = useState<string>();
  const [pendingFiles, setPendingFiles] = useState<PreparedGalleryUpload[]>([]);
  const [activeSheet, setActiveSheet] = useState<GallerySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [canGoBackSheet, setCanGoBackSheet] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [query, setQuery] = useState("");
  const [collectionSearchResults, setCollectionSearchResults] = useState<GalleryImage[]>();
  const [optimisticMediaItems, setOptimisticMediaItems] = useState<OptimisticMediaItem[]>([]);
  const [showingSearchResults, setShowingSearchResults] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [editName, setEditName] = useState("");
  const [editFavorite, setEditFavorite] = useState(false);
  const [selectedImageKeys, setSelectedImageKeys] = useState<string[]>([]);
  const [transferMode, setTransferMode] = useState<CollectionTransferMode>();
  const [destinationCollectionKey, setDestinationCollectionKey] = useState<string>();
  const [aiInput, setAiInput] = useState("");
  const [aiResponse, setAiResponse] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const viewRequest = useRef(0);
  const backgroundLoadRequest = useRef(0);
  const searchRequest = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSearch = useRef<string | undefined>(undefined);
  const activeSheetRef = useRef<GallerySheet | undefined>(undefined);
  const sheetStack = useRef<GallerySheet[]>([]);
  const historyGeneration = useRef(0);
  const historyTarget = useRef<"gallery" | "identityPicker">("gallery");
  const identityPickerRequest = useRef(0);
  const identityFilterRequest = useRef(0);
  const identityPickerSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const identityPickerHistoryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const imageSheetRequest = useRef(0);
  const favoriteRequests = useRef(new Map<string, number>());
  const favoriteWrites = useRef(new Map<string, Promise<{ image: GalleryImage }>>());
  const activeCollectionKey = useRef<string | undefined>(undefined);
  const visibleGalleryView = useRef<"root" | "collection" | "search" | "duplicates" | "contextual">("root");
  const longPressedImage = useRef<{ key: string; at: number } | undefined>(undefined);
  activeCollectionKey.current = activeCollection?.key;
  visibleGalleryView.current = activeCollection
    ? query.trim() ? "search" : "collection"
    : activeSubject || showingSearchResults ? "contextual" : "root";

  const contentWidth = width - spacing.md * 2;
  const collectionSize = Math.floor((contentWidth - COLLECTION_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const destinationCollectionSize = Math.floor((width - 40 - COLLECTION_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const imageSize = Math.floor((contentWidth - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);
  const sheetImageSize = Math.floor((width - 40 - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);

  function applyCollectionSingleton(fallback: GalleryCollection[]) {
    setCachedGalleryCollections(queryClient, galleryContext, fallback);
    setCollections(fallback);
    return fallback;
  }

  async function loadCollectionSingleton() {
    const loaded = await getGalleryCollections(queryClient, galleryContext, async () => (await fetchGalleryOverview(undefined, undefined, 1)).collections);
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
      setImages(overview.images);
      setNextCursor(overview.nextCursor);
      setCollectionSearchResults(undefined);
      if (!silent) setStatus(undefined);
      return true;
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
    setLoading(true);
    void queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, activeCollection?.key), queryFn: () => fetchGalleryOverview(activeCollection?.key) }).then((overview) => {
      if (request !== viewRequest.current) return;
      applyCollectionSingleton(overview.collections);
      setImages(overview.images);
      setNextCursor(overview.nextCursor);
      setCollectionSearchResults(undefined);
      setStatus(undefined);
    }).catch((error: unknown) => { if (request === viewRequest.current) setStatus(errorMessage(error)); }).finally(() => { if (request === viewRequest.current) setLoading(false); });
  }, [activeCollection?.key, activeSubject?.key, showingSearchResults, galleryContext.organizationKey, galleryContext.scopeKey, queryClient]);

  async function loadMoreImages() {
    if (!activeCollection || !nextCursor || loading || loadingMore || query.trim() || similarSource) return;
    const collectionKey = activeCollection.key;
    const cursor = nextCursor;
    setLoadingMore(true);
    try {
      const page = await fetchGalleryOverview(collectionKey, cursor);
      if (activeCollectionKey.current !== collectionKey) return;
      applyCollectionSingleton(page.collections);
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

  async function loadSubjects() {
    setIdentitiesLoading(true);
    try {
      setSubjects((await listGallerySubjects(true)).subjects);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIdentitiesLoading(false);
    }
  }

  useEffect(() => { void loadSubjects(); }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (historyTimer.current) clearTimeout(historyTimer.current);
    const value = query.trim();
    if (activeSubject || !value) {
      setSearching(false);
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

  function openSheet(sheet: GallerySheet) {
    sheetStack.current = [];
    setCanGoBackSheet(false);
    activeSheetRef.current = sheet;
    setActiveSheet(sheet);
    setSheetOpen(true);
  }

  function pushSheet(sheet: GallerySheet) {
    const current = activeSheetRef.current;
    if (current) sheetStack.current.push(current);
    setCanGoBackSheet(sheetStack.current.length > 0);
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
    setCanGoBackSheet(sheetStack.current.length > 0);
    setActiveSheet(previous);
  }

  function closeSheet() {
    historyGeneration.current += 1;
    identityPickerRequest.current += 1;
    if (identityPickerSearchTimer.current) clearTimeout(identityPickerSearchTimer.current);
    if (identityPickerHistoryTimer.current) clearTimeout(identityPickerHistoryTimer.current);
    sheetStack.current = [];
    setCanGoBackSheet(false);
    activeSheetRef.current = undefined;
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
  }

  async function completeUpload(files: PreparedGalleryUpload[], collectionKey: string, optimisticBatchKey?: string) {
    const uploadLocation = activeCollection?.key;
    const uploadCollection = activeCollection?.key === collectionKey ? activeCollection : undefined;
    const uploadView = uploadCollection ? "collection" : "root";
    const uploadStatusIsVisible = () => activeCollectionKey.current === uploadLocation && visibleGalleryView.current === uploadView
      || !activeCollectionKey.current && visibleGalleryView.current === "root";
    const result = await uploadGalleryImages(files, collectionKey);
    setPendingFiles([]);
    const uploadKeys = result.jobs.map(({ key }) => key);
    const jobsByKey = new Map(result.jobs.map((job) => [job.key, job]));
    await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
    if (uploadStatusIsVisible()) setStatus("Upload complete. Gallery is describing your images in the background.");
    void (async () => {
      const settledKeys = new Set<string>();
      let failedCount = 0;
      let allSettled = false;
      let refreshFailed = false;
      let lastPollingError: unknown;
      const refreshVisibleOverview = async () => {
        if (activeCollectionKey.current === uploadLocation && visibleGalleryView.current === uploadView) return { attempted: true, success: await load(uploadCollection, true) };
        if (!activeCollectionKey.current && visibleGalleryView.current === "root") return { attempted: true, success: await load(undefined, true) };
        return { attempted: false, success: true };
      };
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await wait(3_000);
        try {
          const current = await fetchGalleryUploadStatus(uploadKeys, 5_000);
          const newlySettled = current.jobs.filter(({ key, status: jobStatus }) => !settledKeys.has(key) && (jobStatus === "completed" || jobStatus === "failed"));
          for (const job of newlySettled) {
            settledKeys.add(job.key);
            if (job.status === "failed") failedCount += 1;
          }
          if (newlySettled.length > 0) {
            await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
            const refresh = await refreshVisibleOverview();
            if (refresh.attempted && !refresh.success) refreshFailed = true;
            if (optimisticBatchKey && refresh.success) {
              const clientKeys = new Set(newlySettled.map(({ key }) => jobsByKey.get(key)?.clientKey).filter((key): key is string => Boolean(key)));
              setOptimisticMediaItems((currentItems) => currentItems.filter((item) => item.batchKey !== optimisticBatchKey || !clientKeys.has(item.clientKey)));
            }
          }
          allSettled = current.jobs.every(({ status: jobStatus }) => jobStatus === "completed" || jobStatus === "failed");
          if (allSettled) break;
        } catch (error) {
          lastPollingError = error;
        }
      }
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      const finalRefresh = await refreshVisibleOverview();
      refreshFailed = finalRefresh.attempted && !finalRefresh.success;
      if (optimisticBatchKey && (!allSettled || !refreshFailed)) setOptimisticMediaItems((currentItems) => currentItems.filter(({ batchKey }) => batchKey !== optimisticBatchKey));
      if (uploadStatusIsVisible()) {
        if (!allSettled) setStatus(lastPollingError ? `Images were uploaded, but processing status could not be confirmed: ${errorMessage(lastPollingError)}` : "Images were uploaded, but processing is taking longer than expected.");
        else if (refreshFailed) setStatus("Images finished processing, but Gallery could not refresh them yet.");
        else if (failedCount > 0) setStatus(`${failedCount} image${failedCount === 1 ? "" : "s"} could not be processed.`);
        else setStatus("Images are ready.");
      }
      await loadSubjects();
    })().catch((error: unknown) => {
      setStatus(errorMessage(error));
    });
  }

  async function prepareAssets(assets: CapturedImage[]) {
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
        };
      }));
      if (activeCollection) {
        const targetCollection = activeCollection;
        clearCollectionSearch(false);
        const batchKey = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setOptimisticMediaItems((current) => [...files.map((file) => ({ ...file, batchKey, collectionKey: targetCollection.key })), ...current]);
        updateCollectionSingleton((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: collection.count + files.length } : collection));
        setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: current.count + files.length } : current);
        try {
          await completeUpload(files, targetCollection.key, batchKey);
        } catch (error) {
          setOptimisticMediaItems((current) => current.filter((item) => item.batchKey !== batchKey));
          updateCollectionSingleton((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: Math.max(0, collection.count - files.length) } : collection));
          setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: Math.max(0, current.count - files.length) } : current);
          throw error;
        }
        closeSheet();
      } else {
        setPendingFiles(files);
        openSheet("destination");
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function choosePhotos() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { closeSheet(); setStatus("Photo access is required to choose images."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 1 });
    if (!result.canceled) await prepareAssets(result.assets);
  }

  async function takePhoto() {
    closeSheet();
    setCameraOpen(true);
  }

  async function useCapturedPhoto(picture: CameraCapturedPicture) {
    setCameraOpen(false);
    await prepareAssets([picture]);
  }

  async function uploadTo(collectionKey: string) {
    if (pendingFiles.length === 0) return;
    const files = [...pendingFiles];
    const targetCollection = collections.find(({ key }) => key === collectionKey);
    const batchKey = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOptimisticMediaItems((current) => [...files.map((file) => ({ ...file, batchKey, collectionKey })), ...current]);
    if (targetCollection) updateCollectionSingleton((current) => current.map((collection) => collection.key === collectionKey ? { ...collection, count: collection.count + files.length, coverUrl: collection.coverUrl ?? files[0]?.uri ?? null } : collection));
    setBusy(true);
    closeSheet();
    try {
      await completeUpload(files, collectionKey, batchKey);
      setBusy(false);
    } catch (error) {
      setOptimisticMediaItems((current) => current.filter((item) => item.batchKey !== batchKey));
      if (targetCollection) updateCollectionSingleton((current) => current.map((collection) => collection.key === collectionKey ? {
        ...collection,
        count: Math.max(0, collection.count - files.length),
        coverUrl: collection.coverUrl === files[0]?.uri ? targetCollection.coverUrl : collection.coverUrl,
      } : collection));
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createCollectionAndUpload() {
    const name = newCollectionName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const collection = await createGalleryCollection(name);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      updateCollectionSingleton((current) => [...current, collection]);
      setNewCollectionName("");
      if (pendingFiles.length) await uploadTo(collection.key);
      else { closeSheet(); setBusy(false); await load(); }
    } catch (error) {
      setStatus(errorMessage(error));
      setBusy(false);
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
      setStatus(`${matches.length} image${matches.length === 1 ? "" : "s"}${collection ? ` in ${collection.name}` : ""}.`);
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
    else if (activeCollection) { closeSheet(); updateCollectionSearch(item.query); }
    else {
      closeSheet();
      setLoading(true);
      void searchGalleryImages({ query: item.query, recordHistory: false, limit: 50 }).then(({ images: results }) => {
        setActiveSubject(undefined);
        setActiveIdentityFilter(undefined);
        setShowingSearchResults(true);
        setImages(results);
      }).catch((error: unknown) => setStatus(errorMessage(error))).finally(() => setLoading(false));
    }
  }

  async function removeHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingHistoryQuery) return;
    const previous = removeCachedContentHistory(queryClient, contentContext, undefined, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (error) {
      queryClient.setQueryData(contentQueryKeys.history(contentContext, undefined), previous);
      setHistory(previous);
      setStatus(errorMessage(error));
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  }

  async function showImage(image: GalleryImage) {
    imageSheetRequest.current += 1;
    setSelectedImage(image);
    openSheet("image");
  }

  async function findSimilar() {
    if (!selectedImage || !activeCollection) return;
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
    if (!selectedImage) return;
    setEditName(selectedImage.filename);
    setEditFavorite(selectedImage.isFavorite);
    pushSheet("imageEdit");
  }

  async function submitImageEdit() {
    if (!selectedImage || !editName.trim()) return;
    const previous = selectedImage;
    setBusy(true);
    try {
      const { image } = await updateGalleryImage(previous.key, editName.trim(), editFavorite);
      setSelectedImage(image);
      replaceVisibleImages([image]);
      patchGalleryImage(queryClient, galleryContext, image);
      closeSheet();
    } catch (error) {
      showToast({ title: "Image update failed", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function openCollectionEdit() {
    if (!activeCollection) return;
    setEditName(activeCollection.name);
    setEditFavorite(activeCollection.isFavorite);
    pushSheet("collectionEdit");
  }

  async function submitCollectionEdit() {
    if (!activeCollection || !editName.trim()) return;
    setBusy(true);
    try {
      const { collection } = await updateGalleryCollection(activeCollection.key, editName.trim(), editFavorite);
      updateCollectionSingleton((current) => current.map((candidate) => candidate.key === collection.key ? collection : candidate));
      setActiveCollection(collection);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      closeSheet();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeActiveCollection() {
    if (!activeCollection) return;
    const collection = activeCollection;
    setBusy(true);
    try {
      await deleteGalleryCollection(collection.key);
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      closeSheet();
      setActiveCollection(undefined);
      setShowingCollectionOverview(true);
      updateCollectionSingleton((current) => current.filter(({ key }) => key !== collection.key));
      setImages([]);
      setStatus(`${collection.name} was deleted.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function toggleFavorite() {
    if (!selectedImage) return;
    const previous = selectedImage;
    const request = (favoriteRequests.current.get(previous.key) ?? 0) + 1;
    favoriteRequests.current.set(previous.key, request);
    const optimistic = { ...previous, isFavorite: !previous.isFavorite, updatedAt: new Date().toISOString() };
    setSelectedImage(optimistic);
    replaceVisibleImages([optimistic]);
    patchGalleryImage(queryClient, galleryContext, optimistic);
    if (activeSheetRef.current === "imageActions") goBackSheet();
    const write = (favoriteWrites.current.get(previous.key) ?? Promise.resolve()).catch(() => undefined).then(() => setGalleryImageFavorite(previous.key, optimistic.isFavorite));
    favoriteWrites.current.set(previous.key, write);
    void write.then(({ image }) => {
      if (request !== favoriteRequests.current.get(previous.key)) return;
      setSelectedImage((current) => current?.key === image.key ? image : current);
      replaceVisibleImages([image]);
      patchGalleryImage(queryClient, galleryContext, image);
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
    }).catch((error: unknown) => {
      if (request !== favoriteRequests.current.get(previous.key)) return;
      setSelectedImage((current) => current?.key === previous.key ? previous : current);
      replaceVisibleImages([previous]);
      patchGalleryImage(queryClient, galleryContext, previous);
      showToast({ title: "Favorite update failed", description: errorMessage(error) });
    }).finally(() => {
      if (favoriteWrites.current.get(previous.key) === write) favoriteWrites.current.delete(previous.key);
    });
  }

  function replaceVisibleImages(updated: GalleryImage[]) {
    const byKey = new Map(updated.map((image) => [image.key, image]));
    const replace = (current: GalleryImage[]) => current.map((image) => byKey.get(image.key) ?? image);
    setImages(replace);
    setSimilarImages(replace);
    setCollectionSearchResults((current) => current ? replace(current) : current);
  }

  function deleteSelectedImage() {
    if (!selectedImage) return;
    const target = selectedImage;
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
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      void queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext), queryFn: () => fetchGalleryOverview() }).then((overview) => {
        setCachedGalleryCollections(queryClient, galleryContext, overview.collections);
        setCollections(overview.collections);
        setActiveCollection((current) => current ? overview.collections.find(({ key }) => key === current.key) ?? current : current);
      }).catch((error: unknown) => showToast({ title: "Gallery refresh failed", description: errorMessage(error) }));
      void loadSubjects();
    }).catch((error: unknown) => {
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      setImages(previousImages);
      setSimilarImages(previousSimilarImages);
      setCollectionSearchResults(previousSearchResults);
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(previousActiveCollection);
      setSelectedImage(target);
      showToast({ title: "Image deletion failed", description: errorMessage(error) });
    });
  }

  async function showDuplicates() {
    if (!activeCollection) return;
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
    if (!activeCollection || duplicateImages.length === 0) return;
    setBusy(true);
    try {
      const deleted = await deleteGalleryCollectionDuplicates(activeCollection.key, duplicateImages.map(({ key }) => key));
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      updateCollectionSingleton((current) => current.map((collection) => collection.key === activeCollection.key
        ? { ...collection, count: Math.max(0, collection.count - deleted.removedImageKeys.length) }
        : collection));
      setActiveCollection((current) => current ? { ...current, count: Math.max(0, current.count - deleted.removedImageKeys.length) } : current);
      setImages((current) => current.filter(({ key }) => !deleted.removedImageKeys.includes(key)));
      setDuplicateImages([]);
      closeSheet();
      setStatus(`${deleted.removedImageKeys.length} duplicate image${deleted.removedImageKeys.length === 1 ? "" : "s"} removed from this collection. ${deleted.deletedImageKeys.length} moved to trash.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function openVisualIdentities(mode: IdentityLibraryMode) {
    setIdentityLibraryMode(mode);
    if (activeSheetRef.current) pushSheet("visualIdentities");
    else openSheet("visualIdentities");
    if (!subjects.length) await loadSubjects();
  }

  async function openIdentityPicker() {
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
      await loadCollectionSingleton();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIdentityPickerLoading(false);
    }
  }

  async function openIdentityPickerCollection(collection: GalleryCollection) {
    const request = ++identityPickerRequest.current;
    setIdentityPickerCollection(collection);
    setIdentityPickerQuery("");
    setIdentityPickerResults(undefined);
    setIdentityPickerSelected(undefined);
    setIdentityPickerLoading(true);
    try {
      const overview = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.overview(galleryContext, collection.key), queryFn: () => fetchGalleryOverview(collection.key) });
      if (request !== identityPickerRequest.current) return;
      setIdentityPickerImages(overview.images);
      setIdentityPickerNextCursor(overview.nextCursor);
    } catch (error) {
      if (request === identityPickerRequest.current) setStatus(errorMessage(error));
    } finally {
      if (request === identityPickerRequest.current) setIdentityPickerLoading(false);
    }
  }

  function backIdentityPicker() {
    identityPickerRequest.current += 1;
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
    const collection = identityPickerCollection;
    setIdentityPickerLoading(true);
    try {
      const page = await fetchGalleryOverview(collection.key, identityPickerNextCursor);
      if (request !== identityPickerRequest.current) return;
      setIdentityPickerImages((current) => appendCursorItems(current, page.images, ({ key }) => key));
      setIdentityPickerNextCursor(page.nextCursor);
    } catch (error) {
      if (request === identityPickerRequest.current) setStatus(errorMessage(error));
    } finally {
      if (request === identityPickerRequest.current) setIdentityPickerLoading(false);
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
    if (!normalized) return;
    const collection = identityPickerCollection;
    identityPickerSearchTimer.current = setTimeout(() => {
      void searchGalleryImages({ query: normalized, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: false, limit: 50 }).then(({ images: results }) => {
        if (request === identityPickerRequest.current) setIdentityPickerResults(results);
      }).catch((error: unknown) => { if (request === identityPickerRequest.current) setStatus(errorMessage(error)); }).finally(() => { if (request === identityPickerRequest.current) setIdentityPickerSearching(false); });
    }, 300);
    identityPickerHistoryTimer.current = setTimeout(() => {
      void searchGalleryImages({ query: normalized, ...(collection ? { collectionKey: collection.key } : {}), recordHistory: true, limit: 1 }).then(() => queryClient.invalidateQueries({ queryKey: contentQueryKeys.history(contentContext, undefined), exact: true, refetchType: "none" })).catch(() => undefined);
    }, 800);
  }

  function returnToIdentityPicker(queryValue?: string) {
    sheetStack.current = ["visualIdentities"];
    setCanGoBackSheet(true);
    activeSheetRef.current = "identityPicker";
    setActiveSheet("identityPicker");
    if (queryValue !== undefined) updateIdentityPickerSearch(queryValue);
  }

  async function createVisualIdentity() {
    const image = identityPickerSelected;
    const name = identityPickerName.trim();
    if (!image || !name) return;
    const optimisticKey = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const optimistic: GallerySubject = { key: optimisticKey, name, description: "Learning visual identity...", referenceImageKey: image.key, referenceUrl: image.url, imageCount: 1, deletedAt: null, createdAt: now, updatedAt: now };
    setSubjects((current) => [optimistic, ...current]);
    setCreatingIdentityKeys((current) => [...current, optimisticKey]);
    goBackSheet();
    void createGallerySubject(name, [image.key]).then(({ subject }) => {
      setSubjects((current) => current.map((candidate) => candidate.key === optimisticKey ? subject : candidate));
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.all(galleryContext) });
    }).catch((error: unknown) => {
      setSubjects((current) => current.filter(({ key }) => key !== optimisticKey));
      showToast({ title: "Visual identity creation failed", description: errorMessage(error) });
    }).finally(() => setCreatingIdentityKeys((current) => current.filter((key) => key !== optimisticKey)));
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
    if (!activeCollection) return;
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
    if (selectedImageKeys.length) toggleImageSelection(image.key);
    else void showImage(image);
  }

  function openTransfer(mode: CollectionTransferMode) {
    if (!selectedImageKeys.length || !activeCollection) return;
    setTransferMode(mode);
    setDestinationCollectionKey(undefined);
    if (sheetOpen) pushSheet("transferDestination");
    else openSheet("transferDestination");
  }

  async function updateSelectedFavorites() {
    if (!selectedImages.length) return;
    const nextFavorite = !selectedImages.every(({ isFavorite }) => isFavorite);
    const previous = [...selectedImages];
    const optimistic = previous.map((image) => ({ ...image, isFavorite: nextFavorite, updatedAt: new Date().toISOString() }));
    setBusy(true);
    replaceVisibleImages(optimistic);
    optimistic.forEach((image) => patchGalleryImage(queryClient, galleryContext, image));
    const outcomes = await Promise.allSettled(previous.map((image) => {
      const request = (favoriteRequests.current.get(image.key) ?? 0) + 1;
      favoriteRequests.current.set(image.key, request);
      const write = (favoriteWrites.current.get(image.key) ?? Promise.resolve()).catch(() => undefined).then(() => setGalleryImageFavorite(image.key, nextFavorite));
      favoriteWrites.current.set(image.key, write);
      return write.finally(() => {
        if (favoriteWrites.current.get(image.key) === write) favoriteWrites.current.delete(image.key);
      });
    }));
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
    if (failed.length) showToast({ title: "Some favorites were not updated", description: `${failed.length} image${failed.length === 1 ? "" : "s"} remain selected.` });
  }

  function deleteSelectedImages() {
    if (!selectedImages.length || busy) return;
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
      setSelectedImageKeys([]);
      closeSheet();
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      void loadSubjects();
    }).catch((error: unknown) => {
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      setImages(previousImages);
      setSimilarImages(previousSimilarImages);
      setCollectionSearchResults(previousSearchResults);
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(previousActiveCollection);
      showToast({ title: "Image deletion failed", description: errorMessage(error) });
    }).finally(() => setBusy(false));
  }

  function completeTransfer() {
    if (!activeCollection || !transferMode || !selectedImageKeys.length || !destinationCollectionKey) return;
    const sourceCollection = activeCollection;
    const mode = transferMode;
    const imageKeys = [...selectedImageKeys];
    const destinationKeys = [destinationCollectionKey];
    const destination = collections.find(({ key }) => key === destinationCollectionKey);
    if (!destination) return;
    const selected = imageKeys.map((key) => images.find((image) => image.key === key) ?? collectionSearchResults?.find((image) => image.key === key) ?? (selectedImage?.key === key ? selectedImage : undefined)).filter((image): image is GalleryImage => Boolean(image));
    if (selected.length !== imageKeys.length) return;
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
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      void load(nextDestination, true).then((refreshed) => { if (!refreshed) showToast({ title: "Gallery refresh failed", description: "The transfer completed, but the destination could not be refreshed yet." }); });
    }).catch((error: unknown) => {
      restoreGalleryOverviews(queryClient, cacheSnapshot);
      for (const collectionKey of createdDestinationCaches) queryClient.removeQueries({ queryKey: galleryQueryKeys.overview(galleryContext, collectionKey), exact: true });
      setCachedGalleryCollections(queryClient, galleryContext, previousCollections);
      setCollections(previousCollections);
      setActiveCollection(sourceCollection);
      setImages(previousImages);
      setStatus(undefined);
      showToast({ title: mode === "move" ? "Image move failed" : "Image copy failed", description: errorMessage(error) });
    });
  }

  async function askAssistant() {
    const message = aiInput.trim();
    if (!message) return;
    const request = ++viewRequest.current;
    setAssistantBusy(true);
    setAiInput("");
    try {
      const assistantResult = await askGalleryAssistant(message);
      await invalidateAssistantChanges(queryClient, getContentContext(), assistantResult.changes);
      if (request !== viewRequest.current) return;
      if (assistantResult.type === "unsupported") {
        setAiResponse(assistantResult.message);
        return;
      }
      const searchResult = await searchGalleryImages({ query: message, limit: 50 });
      if (request !== viewRequest.current) return;
      setActiveCollection(undefined);
      setActiveSubject(undefined);
      setShowingSearchResults(true);
      setSelectedImageKeys([]);
      setImages(searchResult.images);
      setStatus(`${searchResult.images.length} image${searchResult.images.length === 1 ? "" : "s"} found by your Gallery assistant.`);
      setAiResponse(searchResult.images.length > 0 ? `I found ${searchResult.images.length} matching image${searchResult.images.length === 1 ? "" : "s"}.` : assistantResult.message);
    } catch (error) {
      if (request === viewRequest.current) setAiResponse(errorMessage(error));
    } finally {
      setAssistantBusy(false);
    }
  }

  const activeSubjects = subjects.filter(({ deletedAt }) => deletedAt === null);
  const sheetTitle = activeSheet === "rootActions" ? "New in Gallery"
    : activeSheet === "actions" ? `Add to ${activeCollection?.name ?? "Gallery"}`
    : activeSheet === "destination" ? "Choose destination"
      : activeSheet === "newCollection" ? "New collection"
        : activeSheet === "collectionMenu" ? "Collection actions"
          : activeSheet === "collectionEdit" ? "Edit collection"
            : activeSheet === "imageEdit" ? "Edit image"
              : activeSheet === "duplicates" ? "Duplicates"
          : activeSheet === "confirmDeleteDuplicates" ? "Delete duplicates?"
            : activeSheet === "visualIdentities" ? "Visual identities"
              : activeSheet === "identityPicker" ? "Create visual identity"
                : activeSheet === "identityPickerFilter" ? "Filter images"
              : activeSheet === "searchHistory" ? "Search history"
                : activeSheet === "bulkDelete" ? "Delete selected images"
                : activeSheet === "transferDestination" ? `${transferMode === "move" ? "Move" : "Copy"} images`
                  : activeSheet === "imageActions" ? ""
                  : "Image";
  const collectionSearchActive = Boolean(activeCollection && query.trim());
  const immediateSearchResults = collectionSearchActive ? filterMediaItems(images, query) : images;
  const unfilteredVisibleImages = similarSource ? similarImages : activeIdentityFilter && activeCollection ? collectionSearchResults ?? [] : collectionSearchActive && collectionSearchResults ? collectionSearchResults : immediateSearchResults;
  const visibleImages = showOnlyFavorites ? unfilteredVisibleImages.filter(({ isFavorite }) => isFavorite) : unfilteredVisibleImages;
  const visibleOptimisticItems = activeCollection && !collectionSearchActive && !similarSource && !showOnlyFavorites
    ? optimisticMediaItems.filter(({ collectionKey }) => collectionKey === activeCollection.key)
    : [];
  const emptyGridMessage = activeSubject
      ? `No images are currently identified as ${activeSubject.name}.`
      : collectionSearchActive || showingSearchResults
        ? "No images matched this search."
        : activeCollection
          ? "This collection has no images yet."
          : "Your visual memory starts with the first image.";
  const contextualView = Boolean(activeCollection || activeSubject || showingSearchResults);
  const normalCollectionView = Boolean(activeCollection && !activeSubject);
  const visibleCollections = filterCollections(collections, query).filter(({ isFavorite }) => !showOnlyFavorites || isFavorite);
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
  const sheetFooter = activeSheet === "image" && selectedImage ? <Button onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    : activeSheet === "duplicates" ? <View style={styles.compactSheetActions}>
      <Button disabled={duplicatesLoading || duplicateImages.length === 0} onPress={() => pushSheet("confirmDeleteDuplicates")} size="lg" variant="primary">Delete duplicates</Button>
      <Button disabled={duplicatesLoading} onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "visualIdentities" ? <View style={styles.compactSheetActions}>
      {identityLibraryMode === "browse" ? <Button disabled={identitiesLoading} onPress={() => void openIdentityPicker()} size="lg" variant="primary">Create new</Button> : null}
      <Button onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "identityPicker" ? <View style={styles.compactSheetActions}>
      {identityPickerSelected ? <Button disabled={!identityPickerName.trim()} onPress={() => void createVisualIdentity()} size="lg" variant="primary">Create</Button> : null}
      <Button onPress={closeSheet} size="lg" variant="secondary">Close</Button>
    </View> : activeSheet === "transferDestination" ? <View style={styles.sheetFooter}>
    <Button disabled={!destinationCollectionKey} onPress={completeTransfer} size="md" style={styles.sheetFooterAction} variant="primary">{transferMode === "move" ? "Move" : "Copy"} {selectedImageKeys.length} image{selectedImageKeys.length === 1 ? "" : "s"}</Button>
    <Button onPress={closeSheet} size="md" style={styles.sheetFooterAction} variant="secondary">Close</Button>
  </View> : activeSheet === "searchHistory" ? <Button disabled={historyLoading} onPress={closeSheet} size="lg" variant="secondary">Close</Button> : undefined;

  return (
    <KeyboardAvoidingView behavior="height" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher active="gallery" />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: spacing.md }]} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMoreImages(); }} scrollEventThrottle={120} showsVerticalScrollIndicator={false} style={styles.scrollView}>
        {!contextualView && (showingCollectionOverview || loading) ? (
          <View style={styles.galleryRoot}>
            <View style={styles.collectionTitleRow}>
              <WorkspaceAppSwitcher active="gallery" trigger="back" />
              <Text numberOfLines={1} style={styles.collectionTitle}>Gallery</Text>
              <View style={styles.collectionTitleActions}>
                <Button accessibilityLabel="Filter Gallery" contentMode="raw" onPress={() => openSheet("filter")} size="xs" variant="icon"><FilterIcon size="sm" variant={showOnlyFavorites ? "accent" : "default"} /></Button>
                <Button accessibilityLabel="Create in Gallery" contentMode="raw" disabled={loading} onPress={() => openSheet("rootActions")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
              </View>
            </View>
            {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
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
              {!loading && visibleCollections.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite collections." : "No collections here yet."}</Text><Button accessibilityLabel="Create collection" contentMode="raw" onPress={() => { setPendingFiles([]); setNewCollectionName(""); openSheet("newCollection"); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View> : null}
            </View>
          </View>
        ) : null}

        {activeCollection ? <View style={styles.collectionView}>
          <View style={styles.collectionTitleRow}>
            <Button accessibilityLabel="Back to Gallery collections" contentMode="raw" hitSlop={5} onPress={showCollectionsOverview} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
            <Text numberOfLines={1} style={styles.collectionTitle}>{activeCollection.name}</Text>
            <View style={styles.collectionTitleActions}>
              <Button accessibilityLabel={`Manage ${activeCollection.name}`} contentMode="raw" hitSlop={5} onPress={() => openSheet("collectionMenu")} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
              <Button accessibilityLabel={`Add images to ${activeCollection.name}`} contentMode="raw" disabled={busy} hitSlop={5} onPress={() => openSheet("actions")} size="sm" variant="icon"><PlusIcon size="sm" /></Button>
            </View>
          </View>
          {normalCollectionView ? <View style={styles.rootActions}>
            <View style={styles.collectionSearch}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel={`Search images in ${activeCollection.name}`} onChangeText={updateCollectionSearch} onSubmitEditing={() => { if (searchTimer.current) clearTimeout(searchTimer.current); void search(); }} placeholder="Search..." returnKeyType="search" style={styles.rootSearchInput} value={query} />
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
          {loading || searching && visibleImages.length === 0 ? <View accessibilityLabel={searching ? "Searching images" : "Loading images"} accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: imageSize, height: imageSize }]} />)}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 && normalCollectionView ? <View style={styles.emptyState}><Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : similarSource ? "No similar images were found in this collection." : emptyGridMessage}</Text>{collectionSearchActive || showOnlyFavorites || similarSource ? null : <Button accessibilityLabel={`Add images to ${activeCollection.name}`} contentMode="raw" onPress={() => openSheet("actions")} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button>}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 ? <Text style={styles.emptyText}>{showOnlyFavorites ? "No favorite images here." : emptyGridMessage}</Text> : (
            <View style={styles.grid}>
              {visibleOptimisticItems.map((item) => <View key={item.clientKey} accessibilityLabel={`Uploading ${item.filename}`} accessibilityRole="progressbar" style={[styles.imageButton, { width: imageSize, height: imageSize }]}>
                <View style={styles.imageFrame}>
                  <Image source={item.uri} contentFit="cover" style={styles.image} />
                  <View style={styles.optimisticOverlay}><Spinner size="small" /></View>
                </View>
              </View>)}
              {visibleImages.map((image) => (
                <Button key={image.key} accessibilityLabel={image.caption || image.filename} accessibilityState={{ selected: selectedImageKeys.includes(image.key) }} contentMode="raw" onLongPress={activeCollection ? () => handleImageLongPress(image.key) : undefined} onPress={() => handleImagePress(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost">
                  <View style={[styles.imageFrame, selectedImageKeys.includes(image.key) && styles.imageFrameSelected]}>
                    <Image source={image.url} contentFit="cover" style={styles.image} transition={150} />
                    {selectedImageKeys.includes(image.key) ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
                  </View>
                </Button>
              ))}
              {loadingMore ? Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={`more-${index}`} style={[styles.imageSkeleton, { width: imageSize, height: imageSize }]} />) : null}
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
        onFocusChange={(focused) => { if (!focused) setAiResponse(undefined); }}
        onSubmit={() => void askAssistant()}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" variant="inverse" />}
        value={aiInput}
      />

      <BottomSheet
        description={activeSheet === "destination" ? `${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"} ready to upload.` : activeSheet === "transferDestination" ? "Choose one destination collection." : undefined}
        dismissible={!busy}
        footer={sheetFooter}
        headerLeading={activeSheet === "image" ? <Button accessibilityLabel="Close image" contentMode="raw" onPress={closeSheet} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button> : activeSheet === "identityPicker" ? <Button accessibilityLabel="Back" contentMode="raw" onPress={backIdentityPicker} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button> : canGoBackSheet ? <Button accessibilityLabel="Back" contentMode="raw" onPress={goBackSheet} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button> : undefined}
        headerTrailing={activeSheet === "image" ? <Button accessibilityLabel="Image actions" contentMode="raw" onPress={() => pushSheet("imageActions")} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : undefined}
        hideCloseButton={activeSheet === "image" || canGoBackSheet}
        hideHeading={activeSheet === "actions" || activeSheet === "collectionMenu" || activeSheet === "image" || activeSheet === "imageActions" || activeSheet === "confirmDeleteImage" || activeSheet === "confirmDeleteCollection" || activeSheet === "confirmDeleteDuplicates" || activeSheet === "filter" || activeSheet === "bulkActions"}
        mutation={activeSheet === "image" || activeSheet === "imageActions" || activeSheet === "imageEdit" || activeSheet === "newCollection" || activeSheet === "duplicates" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" || activeSheet === "transferDestination" || activeSheet === "searchHistory"}
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        open={sheetOpen}
        tall={activeSheet === "image" || activeSheet === "transferDestination" || activeSheet === "destination" || activeSheet === "searchHistory"}
        title={sheetTitle}
      >
        {activeSheet === "image" && selectedImage ? <View style={styles.detail}>
          <Image source={selectedImage.url} contentFit="contain" style={styles.detailImage} />
          <Text numberOfLines={2} style={styles.detailCaption}>{selectedImage.caption || "This image is still being described."}</Text>
        </View> : <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (activeSheet === "identityPicker" && isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMoreIdentityPickerImages(); }} scrollEventThrottle={120} showsVerticalScrollIndicator={false} style={[styles.sheetScroll, { maxHeight: activeSheet === "transferDestination" || activeSheet === "duplicates" || activeSheet === "imageEdit" || activeSheet === "visualIdentities" || activeSheet === "identityPicker" ? undefined : height * 0.6 }]}>
        {activeSheet === "rootActions" ? <>
          <BottomSheetItem onPress={() => { setPendingFiles([]); setNewCollectionName(""); pushSheet("newCollection"); }} size="lg" style={styles.sheetAction} variant="secondary">Create collection</BottomSheetItem>
          <BottomSheetItem onPress={() => void openVisualIdentities("browse")} size="lg" style={styles.sheetAction} variant="secondary">Create visual identity</BottomSheetItem>
        </> : null}
        {activeSheet === "actions" ? <>
          <BottomSheetItem disabled={busy} loading={busy} onPress={() => void choosePhotos()} size="lg" style={styles.sheetAction} variant="secondary">Upload images</BottomSheetItem>
          <BottomSheetItem disabled={busy} loading={busy} onPress={() => void takePhoto()} size="lg" style={styles.sheetAction} variant="secondary">Capture image</BottomSheetItem>
        </> : null}
        {activeSheet === "destination" ? <>
          {collections.map((collection) => <BottomSheetItem key={collection.key} contentMode="raw" disabled={busy} onPress={() => void uploadTo(collection.key)} size="lg" variant="ghost"><View style={styles.sheetItem}><FolderIcon size="md" /><Text style={styles.sheetText}>{collection.name}</Text></View></BottomSheetItem>)}
          <BottomSheetItem contentMode="raw" onPress={() => openSheet("newCollection")} size="lg" variant="ghost"><View style={styles.sheetItem}><PlusIcon size="md" /><Text style={styles.sheetText}>New collection</Text></View></BottomSheetItem>
        </> : null}
        {activeSheet === "newCollection" ? <View style={styles.form}>
          <TextInput autoFocus accessibilityLabel="Collection name" editable={!busy} onChangeText={setNewCollectionName} placeholder="Collection name" returnKeyType="done" style={styles.formInput} value={newCollectionName} />
          <Button disabled={busy || !newCollectionName.trim()} loading={busy} onPress={() => void createCollectionAndUpload()} size="md" variant="primary">{pendingFiles.length ? "Create and upload" : "Create collection"}</Button>
        </View> : null}
        {activeSheet === "collectionMenu" ? <>
          <BottomSheetItem disabled={busy} onPress={openCollectionEdit} size="lg" style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem>
          <BottomSheetItem disabled={busy} onPress={() => { closeSheet(); setStatus("Long press an image to begin selecting, then tap to add more."); }} size="lg" style={styles.sheetAction} variant="secondary">Select images</BottomSheetItem>
          <BottomSheetItem disabled={busy} onPress={() => void showDuplicates()} size="lg" style={styles.sheetAction} variant="secondary">Find duplicates</BottomSheetItem>
          <BottomSheetItem disabled={busy} onPress={() => void openVisualIdentities("browse")} size="lg" style={styles.sheetAction} variant="secondary">Visual identities</BottomSheetItem>
          <BottomSheetItem disabled={busy} onPress={() => pushSheet("confirmDeleteCollection")} size="lg" style={styles.sheetAction} variant="secondary">Delete collection</BottomSheetItem>
        </> : null}
        {activeSheet === "imageActions" && selectedImage ? <View style={styles.actionMenu}>
          <BottomSheetItem onPress={openImageEdit} style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem>
          <BottomSheetItem onPress={toggleFavorite} style={styles.sheetAction} variant="secondary">{selectedImage.isFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>
          <BottomSheetItem onPress={() => void openVisualIdentities("browse")} style={styles.sheetAction} variant="secondary">Visual identities</BottomSheetItem>
          {activeCollection ? <BottomSheetItem onPress={() => void findSimilar()} style={styles.sheetAction} variant="secondary">Find similar image</BottomSheetItem> : null}
          <BottomSheetItem onPress={() => pushSheet("confirmDeleteImage")} style={styles.sheetAction} variant="secondary">Delete image</BottomSheetItem>
        </View> : null}
        {activeSheet === "imageEdit" && selectedImage ? <View style={styles.form}>
          <TextInput accessibilityLabel="Image name" editable={!busy} maxLength={255} onChangeText={setEditName} placeholder="Image name" value={editName} />
          <View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Favorite image" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteSwitchLabel}>Favorite</Text></View>
          <Button disabled={busy || !editName.trim()} loading={busy} onPress={() => void submitImageEdit()} size="lg" variant="primary">Save</Button>
        </View> : null}
        {activeSheet === "collectionEdit" && activeCollection ? <View style={styles.form}>
          <TextInput accessibilityLabel="Collection name" editable={!busy} maxLength={120} onChangeText={setEditName} placeholder="Collection name" value={editName} />
          <View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Favorite collection" checked={editFavorite} onCheckedChange={setEditFavorite} /><Text style={styles.favoriteSwitchLabel}>Favorite</Text></View>
          <Button disabled={busy || !editName.trim()} loading={busy} onPress={() => void submitCollectionEdit()} size="lg" variant="primary">Save</Button>
        </View> : null}
        {activeSheet === "confirmDeleteImage" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={deleteSelectedImage} size="lg" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "confirmDeleteCollection" ? <View style={styles.compactSheetActions}>
          <Button disabled={busy} loading={busy} onPress={() => void removeActiveCollection()} size="lg" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "duplicates" ? <View style={styles.duplicatePanel}>
          {duplicatesLoading ? <View accessibilityLabel="Loading duplicate images" accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View>
            : duplicateImages.length ? <View style={styles.grid}>{duplicateImages.map((image) => <Button key={image.key} accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => void showImage(image)} size="xl" style={[styles.imageButton, { width: sheetImageSize, height: sheetImageSize }]} variant="ghost"><View style={styles.imageFrame}><Image source={image.url} contentFit="cover" style={styles.image} /></View></Button>)}</View>
              : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>{duplicatesError ?? "No duplicate images found in this collection."}</Text></View>}
        </View> : null}
        {activeSheet === "filter" ? <View style={styles.filterPanel}>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel={showOnlyFavorites ? "Show all Gallery images" : "Show only favorite Gallery images"} checked={showOnlyFavorites} onCheckedChange={(checked) => { setGalleryShowOnlyFavorites(checked); closeSheet(); }} />
            <Text style={styles.favoriteSwitchLabel}>{showOnlyFavorites ? "Showing only favorites" : "Showing all"}</Text>
          </View>
          <Button onPress={() => void openVisualIdentities("filter")} size="lg" variant="secondary">Visual identities</Button>
          <Button onPress={() => void openSearchHistory()} size="lg" variant="secondary">Search history</Button>
        </View> : null}
        {activeSheet === "identityPickerFilter" ? <View style={styles.filterPanel}>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel={showOnlyFavorites ? "Show all picker images" : "Show only favorite picker images"} checked={showOnlyFavorites} onCheckedChange={setGalleryShowOnlyFavorites} />
            <Text style={styles.favoriteSwitchLabel}>{showOnlyFavorites ? "Showing only favorites" : "Showing all"}</Text>
          </View>
          <Button onPress={() => void openSearchHistory("identityPicker")} size="lg" variant="secondary">Search history</Button>
        </View> : null}
        {activeSheet === "visualIdentities" ? <View style={styles.identityLibrary}>
          {identitiesLoading ? <View accessibilityLabel="Loading visual identities" accessibilityRole="progressbar" style={styles.collectionGrid}>{Array.from({ length: COLLECTION_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: destinationCollectionSize, height: destinationCollectionSize }]} />)}</View>
            : activeSubjects.length ? <View style={styles.collectionGrid}>{activeSubjects.map((identity) => <View key={identity.key} style={[styles.collectionCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}>
              <Image source={identity.referenceUrl} contentFit="cover" style={styles.collectionCover} />
              <Button accessibilityLabel={`${identity.name}, ${identity.imageCount} matching images`} contentMode="raw" disabled={creatingIdentityKeys.includes(identity.key)} onPress={() => void filterByVisualIdentity(identity)} size="xl" style={[styles.collectionMain, styles.coveredCollectionMain]} variant="ghost">
                <Text numberOfLines={1} style={[styles.collectionName, styles.coveredCollectionName]}>{identity.name}</Text>
                {creatingIdentityKeys.includes(identity.key) ? <View style={styles.optimisticOverlay}><Spinner size="small" /></View> : null}
              </Button>
            </View>)}</View> : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>No visual identities yet.</Text></View>}
        </View> : null}
        {activeSheet === "identityPicker" ? <View style={styles.identityPicker}>
          <Text style={styles.sheetSubtitle}>Choose an image to create a visual identity from.</Text>
          {identityPickerSelected ? <TextInput autoFocus accessibilityLabel="Visual identity name" maxLength={120} onChangeText={setIdentityPickerName} placeholder="Name, for example Hugo" value={identityPickerName} /> : null}
          <View style={styles.rootActions}>
            <View style={styles.collectionSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search images for visual identity" onChangeText={updateIdentityPickerSearch} placeholder="Search images..." style={styles.rootSearchInput} value={identityPickerQuery} />{identityPickerQuery.trim() ? <Button accessibilityLabel="Clear image search" contentMode="raw" onPress={() => updateIdentityPickerSearch("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}</View>
            <Button accessibilityLabel="Filter visual identity image picker" contentMode="raw" onPress={() => pushSheet("identityPickerFilter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={showOnlyFavorites ? "accent" : "default"} /></Button>
          </View>
          {identityPickerCollection ? <View style={styles.destinationLocationLane}><Button accessibilityLabel="Back to collections" contentMode="raw" onPress={backIdentityPicker} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.destinationLocationTitle}>{identityPickerCollection.name}</Text></View> : null}
          {!identityPickerCollection && !identityPickerQuery.trim() ? <View style={styles.collectionGrid}>
            {identityPickerLoading ? Array.from({ length: COLLECTION_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: destinationCollectionSize, height: destinationCollectionSize }]} />) : identityPickerVisibleCollections.map((collection) => <View key={collection.key} style={[styles.collectionCard, { width: destinationCollectionSize, height: destinationCollectionSize }]}>{collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={styles.collectionCover} /> : null}<Button accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => void openIdentityPickerCollection(collection)} size="xl" style={[styles.collectionMain, collection.coverUrl && styles.coveredCollectionMain]} variant="ghost">{collection.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.collectionName, collection.coverUrl && styles.coveredCollectionName]}>{collection.name}</Text></Button></View>)}
          </View> : null}
          {identityPickerCollection || identityPickerQuery.trim() ? identityPickerSearching || identityPickerLoading && identityPickerVisibleImages.length === 0 ? <View accessibilityLabel="Loading images" accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={index} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />)}</View> : identityPickerVisibleImages.length ? <View style={styles.grid}>{identityPickerVisibleImages.map((image) => { const selected = identityPickerSelected?.key === image.key; return <Button key={image.key} accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.filename}`} accessibilityState={{ selected }} contentMode="raw" onPress={() => setIdentityPickerSelected(selected ? undefined : image)} size="xl" style={[styles.imageButton, { width: sheetImageSize, height: sheetImageSize }]} variant="ghost"><View style={[styles.imageFrame, selected && styles.imageFrameSelected]}><Image source={image.url} contentFit="cover" style={styles.image} />{selected ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>; })}{identityPickerLoading ? Array.from({ length: IMAGE_COLUMNS }, (_, index) => <Skeleton key={`picker-more-${index}`} style={[styles.imageSkeleton, { width: sheetImageSize, height: sheetImageSize }]} />) : null}</View> : <View style={styles.duplicateEmpty}><Text style={styles.emptyText}>No images found.</Text></View> : null}
        </View> : null}
        {activeSheet === "searchHistory" ? <ScrollView contentContainerStyle={styles.searchHistoryList} showsVerticalScrollIndicator={false}>
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
          <View style={styles.destinationGrid}>{collections.filter(({ key }) => key !== activeCollection?.key).map((collection) => {
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
          {collections.filter(({ key }) => key !== activeCollection?.key).length === 0 ? <Text style={styles.emptyText}>Create another collection before moving or copying images.</Text> : null}
          </View>
        </View> : null}
        {activeSheet === "confirmDeleteDuplicates" ? <View style={styles.form}>
          <Button disabled={busy || duplicateImages.length === 0} loading={busy} onPress={() => void deleteDuplicates()} size="lg" variant="primary">Delete</Button>
          <Button disabled={busy} onPress={goBackSheet} size="lg" variant="secondary">Close</Button>
        </View> : null}
        </ScrollView>}
      </BottomSheet>
      {cameraOpen ? <BrandedCameraModal hint="Frame the moment and hold steady" onCapture={useCapturedPhoto} onClose={() => setCameraOpen(false)} title="Capture for Gallery" /> : null}
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
  rootSearch: { minHeight: 44, flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  searchHistoryButton: { width: 44, height: 44 },
  statusCard: { marginBottom: spacing.sm, paddingHorizontal: 13, paddingVertical: 10, borderLeftWidth: 2, borderLeftColor: palette.silver700, borderRadius: radii.md, backgroundColor: palette.panel },
  status: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  collectionView: { flexGrow: 1, gap: spacing.md },
  collectionTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  collectionTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  collectionTitleActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  collectionSearch: { minHeight: 44, flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  bulkToolbar: { minHeight: 40, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  similarPill: { alignSelf: "flex-start", maxWidth: "100%", minHeight: 38, padding: 4, paddingLeft: 5, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, backgroundColor: palette.panel },
  similarPillImage: { width: 28, height: 28, borderRadius: 14, backgroundColor: palette.panelRaised },
  similarPillText: { maxWidth: 210, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  sectionTitle: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  count: { color: palette.silver700, fontFamily: fonts.medium, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  collectionGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: COLLECTION_GAP },
  searchResultSection: { gap: spacing.sm },
  collectionCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  collectionSkeleton: { backgroundColor: palette.hairlineBright, opacity: 0.72 },
  collectionCover: StyleSheet.absoluteFill,
  collectionMain: { width: "100%", height: "100%", flexDirection: "column", justifyContent: "center", gap: 10, paddingHorizontal: 8 },
  coveredCollectionMain: { justifyContent: "flex-end", paddingBottom: 10, backgroundColor: "rgba(0, 0, 0, 0.16)" },
  collectionName: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  coveredCollectionName: { paddingHorizontal: 5, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: "rgba(0, 0, 0, 0.68)", color: "#FFFFFF" },
  imageButton: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: "transparent" },
  imageSkeleton: { borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  imageFrame: { width: "100%", height: "100%", overflow: "hidden", borderWidth: 1, borderColor: "transparent", borderRadius: radii.md, backgroundColor: palette.panelRaised },
  imageFrameSelected: { borderColor: palette.silver50, borderWidth: 2 },
  optimisticOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.28)" },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  image: { width: "100%", height: "100%" },
  emptyState: { flex: 1, width: "100%", minHeight: 360, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
  emptyPlusButton: { width: 44, height: 44 },
  aiResponse: { paddingHorizontal: 14, paddingVertical: 9, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, borderRadius: radii.md, backgroundColor: palette.panel },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { gap: 4, paddingBottom: 4 },
  sheetText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
  sheetSubtitle: { marginTop: 3, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  actionMenu: { gap: 8 },
  duplicatePanel: { flexGrow: 1, minHeight: 320 },
  duplicateEmpty: { minHeight: 320, alignItems: "center", justifyContent: "center" },
  identityLibrary: { flexGrow: 1, minHeight: 360 },
  identityPicker: { flexGrow: 1, minHeight: 480, gap: spacing.sm },
  sheetAction: { justifyContent: "center" },
  destinationBrowser: { flex: 1, minHeight: 0, gap: spacing.sm },
  destinationLocationLane: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  destinationLocationTitle: { flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  destinationGrid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: COLLECTION_GAP, paddingVertical: 4 },
  destinationCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panelRaised },
  destinationCardSelected: { borderColor: palette.silver50, borderWidth: 2 },
  destinationBadge: { position: "absolute", top: 6, right: 6, width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: palette.silver50 },
  sheetFooter: { flexDirection: "row", gap: 8 },
  sheetFooterAction: { flex: 1 },
  compactSheetActions: { width: "100%", gap: spacing.sm, padding: 2 },
  filterPanel: { gap: 6 },
  favoriteSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  searchHistoryList: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
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
  formInput: { minHeight: 48 },
  detail: { flex: 1, gap: 12 },
  detailImage: { flex: 1, width: "100%", borderRadius: radii.lg, backgroundColor: palette.voidBlack },
  detailCaption: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  detailActions: { flexDirection: "row", gap: 8 },
  detailActionsCompact: { flexDirection: "column" },
  detailAction: { flex: 1 },
  detailActionCompact: { flex: 0, width: "100%" },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(176, 74, 74, 0.45)", backgroundColor: "rgba(176, 74, 74, 0.1)" },
  inlineErrorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
});
