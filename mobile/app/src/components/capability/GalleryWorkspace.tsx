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
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { CameraIcon, CheckIcon, ChevronLeftIcon, ClockIcon, CloseIcon, CopyIcon, FolderIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon, StarIcon, TrashIcon, UploadIcon, UsersIcon } from "@vorinthex/shared/ui/icons-mobile";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { BrandedCameraModal } from "@/components/capability/BrandedCameraModal";
import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource } from "@/data/capability-icons";
import {
  askGalleryAssistant,
  createGalleryCollection,
  createGallerySubject,
  deleteGalleryCollectionDuplicates,
  deleteGallerySubject,
  fetchGalleryOverview,
  fetchGalleryUploadStatus,
  filterCollections,
  filterMediaItems,
  findGalleryCollectionDuplicates,
  getGalleryContext,
  listGallerySubjectImages,
  listGallerySubjects,
  mergeMediaItems,
  restoreGallerySubject,
  searchGalleryImages,
  setGalleryImageFavorite,
  transferGalleryCollectionImages,
  uploadGalleryImages,
  type GalleryCollection,
  type GalleryImage,
  type GallerySubject,
  type PreparedGalleryUpload,
} from "@/lib/gallery-client";
import { getContentContext } from "@/lib/content-client";
import { galleryQueryKeys, invalidateAssistantChanges, patchGalleryImage } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { normalizeCapturedJpeg, type CapturedImage } from "@/lib/captured-image";

type GallerySheet = "actions" | "destination" | "newCollection" | "image" | "collectionMenu" | "confirmDeleteDuplicates" | "createSubject" | "subjects" | "transferDestination";
type CollectionTransferMode = "copy" | "move";
type OptimisticMediaItem = PreparedGalleryUpload & { batchKey: string; collectionKey: string };
const COLLECTION_COLUMNS = 3;
const IMAGE_COLUMNS = 5;
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
  const galleryContext = getGalleryContext();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [collections, setCollections] = useState<GalleryCollection[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [activeCollection, setActiveCollection] = useState<GalleryCollection>();
  const [showingCollectionOverview, setShowingCollectionOverview] = useState(true);
  const [subjects, setSubjects] = useState<GallerySubject[]>([]);
  const [activeSubject, setActiveSubject] = useState<GallerySubject>();
  const [selectedImage, setSelectedImage] = useState<GalleryImage>();
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PreparedGalleryUpload[]>([]);
  const [activeSheet, setActiveSheet] = useState<GallerySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collectionSearchResults, setCollectionSearchResults] = useState<GalleryImage[]>();
  const [optimisticMediaItems, setOptimisticMediaItems] = useState<OptimisticMediaItem[]>([]);
  const [showingSearchResults, setShowingSearchResults] = useState(false);
  const [showingDuplicates, setShowingDuplicates] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectReferenceKeys, setSubjectReferenceKeys] = useState<string[]>([]);
  const [selectedImageKeys, setSelectedImageKeys] = useState<string[]>([]);
  const [transferMode, setTransferMode] = useState<CollectionTransferMode>();
  const [destinationCollectionKeys, setDestinationCollectionKeys] = useState<string[]>([]);
  const [aiInput, setAiInput] = useState("");
  const [aiResponse, setAiResponse] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [imageAction, setImageAction] = useState<"similar" | "favorite">();
  const [imageError, setImageError] = useState<string>();
  const viewRequest = useRef(0);
  const backgroundLoadRequest = useRef(0);
  const searchRequest = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSearch = useRef<string | undefined>(undefined);
  const imageSheetRequest = useRef(0);
  const activeCollectionKey = useRef<string | undefined>(undefined);
  const visibleGalleryView = useRef<"root" | "collection" | "search" | "duplicates" | "contextual">("root");
  const longPressedImage = useRef<{ key: string; at: number } | undefined>(undefined);
  activeCollectionKey.current = activeCollection?.key;
  visibleGalleryView.current = activeCollection
    ? showingDuplicates ? "duplicates" : query.trim() ? "search" : "collection"
    : activeSubject || showingSearchResults ? "contextual" : "root";

  const contentWidth = width - spacing.md * 2;
  const collectionSize = Math.floor((contentWidth - COLLECTION_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const imageSize = Math.floor((contentWidth - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);

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
      setCollections(overview.collections);
      setImages(overview.images);
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
      setCollections(overview.collections);
      setImages(overview.images);
      setCollectionSearchResults(undefined);
      setStatus(undefined);
    }).catch((error: unknown) => { if (request === viewRequest.current) setStatus(errorMessage(error)); }).finally(() => { if (request === viewRequest.current) setLoading(false); });
  }, [activeCollection?.key, activeSubject?.key, showingSearchResults, galleryContext.organizationKey, galleryContext.scopeKey, queryClient]);

  async function loadSubjects() {
    try {
      setSubjects((await listGallerySubjects(true)).subjects);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  useEffect(() => { void loadSubjects(); }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const value = query.trim();
    if (!activeCollection || activeSubject || showingDuplicates || !value) {
      setSearching(false);
      return;
    }
    searchTimer.current = setTimeout(() => { void search(value, activeCollection); }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [activeCollection?.key, activeSubject?.key, query, showingDuplicates]);

  function openSheet(sheet: GallerySheet) {
    setActiveSheet(sheet);
    setSheetOpen(true);
  }

  function showCollectionsOverview() {
    viewRequest.current += 1;
    setShowingCollectionOverview(true);
    setLoading(true);
    setQuery("");
    setCollectionSearchResults(undefined);
    searchRequest.current += 1;
    setSelectedImageKeys([]);
    setActiveCollection(undefined);
    setActiveSubject(undefined);
    setShowingDuplicates(false);
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
    setSheetOpen(false);
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
        setCollections((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: collection.count + files.length } : collection));
        setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: current.count + files.length } : current);
        try {
          await completeUpload(files, targetCollection.key, batchKey);
        } catch (error) {
          setOptimisticMediaItems((current) => current.filter((item) => item.batchKey !== batchKey));
          setCollections((current) => current.map((collection) => collection.key === targetCollection.key ? { ...collection, count: Math.max(0, collection.count - files.length) } : collection));
          setActiveCollection((current) => current?.key === targetCollection.key ? { ...current, count: Math.max(0, current.count - files.length) } : current);
          throw error;
        }
        setSheetOpen(false);
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
    if (!permission.granted) { setSheetOpen(false); setStatus("Photo access is required to choose images."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 20, quality: 1 });
    if (!result.canceled) await prepareAssets(result.assets);
  }

  async function takePhoto() {
    setSheetOpen(false);
    setCameraOpen(true);
  }

  async function useCapturedPhoto(picture: CameraCapturedPicture) {
    setCameraOpen(false);
    await prepareAssets([picture]);
  }

  async function uploadTo(collectionKey: string) {
    if (pendingFiles.length === 0) return;
    setBusy(true);
    setSheetOpen(false);
    try {
      await completeUpload(pendingFiles, collectionKey);
      setBusy(false);
    } catch (error) {
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
      setCollections((current) => [...current, collection]);
      setNewCollectionName("");
      if (pendingFiles.length) await uploadTo(collection.key);
      else { setSheetOpen(false); setBusy(false); await load(); }
    } catch (error) {
      setStatus(errorMessage(error));
      setBusy(false);
    }
  }

  function updateCollectionSearch(value: string) {
    searchRequest.current += 1;
    activeSearch.current = undefined;
    setSearching(Boolean(value.trim()));
    setCollectionSearchResults(undefined);
    setStatus(undefined);
    setQuery(value);
  }

  async function search(value = query.trim(), collection = activeCollection) {
    if (!collection || !value) return;
    const searchKey = `${collection.key}:${value.toLocaleLowerCase()}`;
    if (activeSearch.current === searchKey) return;
    activeSearch.current = searchKey;
    const request = ++searchRequest.current;
    const immediateMatches = filterMediaItems(images, value);
    setSearching(true);
    try {
      const result = await searchGalleryImages({ query: value, collectionKey: collection.key, limit: 50 });
      if (request !== searchRequest.current || activeCollectionKey.current !== collection.key || visibleGalleryView.current !== "search") return;
      setSelectedImageKeys([]);
      const matches = mergeMediaItems(immediateMatches, result.images);
      setCollectionSearchResults(matches);
      setStatus(`${matches.length} result${matches.length === 1 ? "" : "s"} in ${collection.name}`);
    } catch (error) {
      if (request === searchRequest.current && activeCollectionKey.current === collection.key && visibleGalleryView.current === "search") setStatus(errorMessage(error));
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

  async function showImage(image: GalleryImage) {
    imageSheetRequest.current += 1;
    setSelectedImage(image);
    setSimilarImages([]);
    setImageError(undefined);
    openSheet("image");
  }

  async function findSimilar() {
    if (!selectedImage) return;
    const request = ++imageSheetRequest.current;
    const imageKey = selectedImage.key;
    setImageAction("similar");
    setImageError(undefined);
    try {
      const result = await searchGalleryImages({ imageKey, limit: 15 });
      if (request !== imageSheetRequest.current) return;
      setSimilarImages(result.images);
    } catch (error) {
      setImageError(errorMessage(error));
    } finally {
      setImageAction(undefined);
    }
  }

  async function toggleFavorite() {
    if (!selectedImage) return;
    const request = ++imageSheetRequest.current;
    const imageKey = selectedImage.key;
    setImageAction("favorite");
    setImageError(undefined);
    try {
      const { image } = await setGalleryImageFavorite(imageKey, !selectedImage.isFavorite);
      if (request !== imageSheetRequest.current) return;
      setSelectedImage(image);
      setImages((current) => current.map((candidate) => candidate.key === image.key ? image : candidate));
      patchGalleryImage(queryClient, galleryContext, image);
    } catch (error) {
      setImageError(errorMessage(error));
    } finally {
      setImageAction(undefined);
    }
  }

  async function showDuplicates() {
    if (!activeCollection) return;
    clearCollectionSearch(false);
    const request = ++viewRequest.current;
    setBusy(true);
    setSheetOpen(false);
    try {
      const result = await findGalleryCollectionDuplicates(activeCollection.key);
      if (request !== viewRequest.current) return;
      setImages(result.images);
      setShowingDuplicates(true);
      setStatus(result.images.length
        ? `${result.images.length} redundant image${result.images.length === 1 ? "" : "s"}. One original from each group is kept.`
        : "No duplicate images were found in this collection.");
    } catch (error) {
      if (request === viewRequest.current) setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exitDuplicates() {
    setShowingDuplicates(false);
    setLoading(true);
    await load(activeCollection);
  }

  async function deleteDuplicates() {
    if (!activeCollection || images.length === 0) return;
    setBusy(true);
    try {
      const deleted = await deleteGalleryCollectionDuplicates(activeCollection.key, images.map(({ key }) => key));
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      setCollections((current) => current.map((collection) => collection.key === activeCollection.key
        ? { ...collection, count: Math.max(0, collection.count - deleted.removedImageKeys.length) }
        : collection));
      setActiveCollection((current) => current ? { ...current, count: Math.max(0, current.count - deleted.removedImageKeys.length) } : current);
      setImages([]);
      setSheetOpen(false);
      setStatus(`${deleted.removedImageKeys.length} duplicate image${deleted.removedImageKeys.length === 1 ? "" : "s"} removed from this collection. ${deleted.deletedImageKeys.length} moved to trash.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function showSubject(subject: GallerySubject) {
    const request = ++viewRequest.current;
    setBusy(true);
    setSheetOpen(false);
    try {
      const result = await listGallerySubjectImages(subject.key);
      if (request !== viewRequest.current) return;
      setActiveSubject(subject);
      setActiveCollection(undefined);
      setShowingDuplicates(false);
      setShowingSearchResults(false);
      setImages(result.images);
      setStatus(`${result.images.length} image${result.images.length === 1 ? "" : "s"} identified as ${subject.name}.`);
      void loadSubjects();
    } catch (error) {
      if (request === viewRequest.current) setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exitSubject() {
    setActiveSubject(undefined);
    setShowingCollectionOverview(true);
    setLoading(true);
    await load(undefined);
  }

  async function createSubject() {
    const name = subjectName.trim();
    if (!name || !selectedImage || subjectReferenceKeys.length === 0) return;
    setBusy(true);
    try {
      const { subject } = await createGallerySubject(name, subjectReferenceKeys);
      setSubjects((current) => [...current.filter(({ key }) => key !== subject.key), subject]);
      setSubjectName("");
      setSubjectReferenceKeys([]);
      setSheetOpen(false);
      setStatus(`${subject.name} is now a subject. Gallery matched ${subject.imageCount} image${subject.imageCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function setSubjectDeleted(subject: GallerySubject, deleted: boolean) {
    setBusy(true);
    try {
      const result = deleted ? await deleteGallerySubject(subject.key) : await restoreGallerySubject(subject.key);
      setSubjects((current) => current.map((candidate) => candidate.key === result.subject.key ? result.subject : candidate));
      if (deleted && activeSubject?.key === subject.key) { setActiveSubject(undefined); await load(undefined); }
    } catch (error) {
      setStatus(errorMessage(error));
      setSheetOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function toggleImageSelection(imageKey: string) {
    if (!selectedImageKeys.includes(imageKey) && selectedImageKeys.length >= 100) {
      setStatus("You can move or copy up to 100 images at once.");
      return;
    }
    setSelectedImageKeys((current) => current.includes(imageKey) ? current.filter((key) => key !== imageKey) : [...current, imageKey]);
  }

  function handleImageLongPress(imageKey: string) {
    if (!activeCollection || showingDuplicates) return;
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
    if (!selectedImageKeys.length) return;
    setTransferMode(mode);
    setDestinationCollectionKeys([]);
    openSheet("transferDestination");
  }

  async function completeTransfer() {
    if (!activeCollection || !transferMode || !selectedImageKeys.length || !destinationCollectionKeys.length) return;
    setBusy(true);
    try {
      const result = await transferGalleryCollectionImages({ sourceCollectionKey: activeCollection.key, destinationCollectionKeys, imageKeys: selectedImageKeys, mode: transferMode });
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.overviews(galleryContext) });
      setSheetOpen(false);
      setSelectedImageKeys([]);
      setDestinationCollectionKeys([]);
      await load(activeCollection);
      setStatus(transferMode === "move"
        ? `${result.imageKeys.length} image${result.imageKeys.length === 1 ? "" : "s"} moved to ${result.destinationCollectionKeys.length} collection${result.destinationCollectionKeys.length === 1 ? "" : "s"}.`
        : result.createdRelationCount
          ? `${result.createdRelationCount} new collection placement${result.createdRelationCount === 1 ? "" : "s"} created.`
          : "The selected images already exist in those collections.");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
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
      setShowingDuplicates(false);
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
  const deletedSubjects = subjects.filter(({ deletedAt }) => deletedAt !== null);
  const subjectReferenceOptions = selectedImage
    ? [selectedImage, ...similarImages.filter(({ key }) => key !== selectedImage.key)].slice(0, 8)
    : [];
  const sheetTitle = activeSheet === "actions" ? activeCollection ? `Add to ${activeCollection.name}` : "New in Gallery"
    : activeSheet === "destination" ? "Choose destination"
      : activeSheet === "newCollection" ? "New collection"
        : activeSheet === "collectionMenu" ? "Collection actions"
          : activeSheet === "confirmDeleteDuplicates" ? "Delete duplicates?"
            : activeSheet === "createSubject" ? "Create subject"
              : activeSheet === "subjects" ? "Manage subjects"
                : activeSheet === "transferDestination" ? `${transferMode === "move" ? "Move" : "Copy"} images`
                  : "Image";
  const collectionSearchActive = Boolean(activeCollection && query.trim() && !showingDuplicates);
  const immediateSearchResults = collectionSearchActive ? filterMediaItems(images, query) : images;
  const visibleImages = collectionSearchActive && collectionSearchResults ? collectionSearchResults : immediateSearchResults;
  const visibleOptimisticItems = activeCollection && !collectionSearchActive && !showingDuplicates
    ? optimisticMediaItems.filter(({ collectionKey }) => collectionKey === activeCollection.key)
    : [];
  const emptyGridMessage = showingDuplicates
    ? "No duplicate images were found in this collection."
    : activeSubject
      ? `No images are currently identified as ${activeSubject.name}.`
      : collectionSearchActive || showingSearchResults
        ? "No images matched this search."
        : activeCollection
          ? "This collection has no images yet."
          : "Your visual memory starts with the first image.";
  const contextualView = Boolean(activeCollection || activeSubject || showingSearchResults || showingDuplicates);
  const normalCollectionView = Boolean(activeCollection && !activeSubject && !showingDuplicates);
  const visibleCollections = filterCollections(collections, query);
  const imageActionsBusy = imageAction !== undefined;

  return (
    <KeyboardAvoidingView behavior="height" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher active="gallery" />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 126 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!contextualView && (showingCollectionOverview || loading) ? (
          <View style={styles.galleryRoot}>
            {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
            <View style={styles.rootActions}>
              <View style={styles.rootSearch}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput accessibilityLabel="Search Gallery collections" onChangeText={setQuery} placeholder="Search collections" style={styles.rootSearchInput} value={query} />
                {query.trim() ? <Button accessibilityLabel="Clear collection search" contentMode="raw" hitSlop={8} onPress={() => setQuery("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel="Create or add to Gallery" contentMode="raw" disabled={loading} onPress={() => openSheet("actions")} size="md" style={styles.rootCreateButton} variant="icon"><PlusIcon size="sm" /></Button>
            </View>
            <View style={styles.collectionGrid}>
              {loading ? Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.collectionCard, styles.collectionSkeleton, { width: collectionSize, height: collectionSize }]} />) : visibleCollections.map((collection) => (
                <View key={collection.key} style={[styles.collectionCard, { width: collectionSize, height: collectionSize }]}>
                  {collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={styles.collectionCover} /> : null}
                  <Button accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => { viewRequest.current += 1; setShowingCollectionOverview(false); setLoading(true); setQuery(""); setSelectedImageKeys([]); setActiveSubject(undefined); setShowingDuplicates(false); setShowingSearchResults(false); setActiveCollection(collection); }} size="xl" style={[styles.collectionMain, collection.coverUrl && styles.coveredCollectionMain]} variant="ghost">
                    {collection.coverUrl ? null : <FolderIcon size="lg" />}
                    <Text numberOfLines={1} style={[styles.collectionName, collection.coverUrl && styles.coveredCollectionName]}>{collection.name}</Text>
                  </Button>
                </View>
              ))}
              {!loading && visibleCollections.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyText}>{query.trim() ? "No collections match this search." : "No collections here yet."}</Text>{query.trim() ? null : <Button accessibilityLabel="Create collection" contentMode="raw" onPress={() => { setPendingFiles([]); setNewCollectionName(""); openSheet("newCollection"); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button>}</View> : null}
            </View>
          </View>
        ) : null}

        {activeCollection ? <View style={styles.collectionView}>
          <View style={styles.collectionTitleRow}>
            <Button accessibilityLabel={showingDuplicates ? `Back to ${activeCollection.name}` : "Back to Gallery collections"} contentMode="raw" hitSlop={5} onPress={() => { if (showingDuplicates) void exitDuplicates(); else showCollectionsOverview(); }} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
            {selectedImageKeys.length ? <Button accessibilityLabel="Clear image selection" contentMode="raw" onPress={() => setSelectedImageKeys([])} size="xs" style={styles.selectionTitle} variant="ghost"><CloseIcon size="sm" /><Text style={styles.sectionTitle}>{selectedImageKeys.length} SELECTED</Text></Button> : <Text numberOfLines={1} style={styles.collectionTitle}>{showingDuplicates ? "Duplicates" : activeCollection.name}</Text>}
            <View style={styles.collectionTitleActions}>
              {showingDuplicates ? <Button accessibilityLabel="Delete duplicate images" contentMode="raw" disabled={images.length === 0} hitSlop={5} onPress={() => openSheet("confirmDeleteDuplicates")} size="sm" variant="icon"><TrashIcon size="sm" variant={images.length ? "danger" : "muted"} /></Button> : <>
                <Button accessibilityLabel={`Manage ${activeCollection.name}`} contentMode="raw" hitSlop={5} onPress={() => openSheet("collectionMenu")} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
                <Button accessibilityLabel={`Add images to ${activeCollection.name}`} contentMode="raw" disabled={busy} hitSlop={5} onPress={() => openSheet("actions")} size="sm" variant="icon"><PlusIcon size="sm" /></Button>
              </>}
            </View>
          </View>
          {normalCollectionView ? <View style={styles.collectionSearch}>
            <SearchIcon size="sm" variant="muted" />
            <TextInput accessibilityLabel={`Search images in ${activeCollection.name}`} onChangeText={updateCollectionSearch} onSubmitEditing={() => { if (searchTimer.current) clearTimeout(searchTimer.current); void search(); }} placeholder="Search this collection" returnKeyType="search" style={styles.rootSearchInput} value={query} />
            {query.trim() ? <Button accessibilityLabel="Clear image search" contentMode="raw" hitSlop={8} onPress={() => clearCollectionSearch()} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
          </View> : null}
          {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
          {loading || searching && visibleImages.length === 0 ? <View accessibilityLabel={searching ? "Searching images" : "Loading images"} accessibilityRole="progressbar" style={styles.grid}>{Array.from({ length: IMAGE_COLUMNS }, (_, index) => <View key={index} style={[styles.imageSkeleton, { width: imageSize, height: imageSize }]} />)}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 && normalCollectionView ? <View style={styles.emptyState}><Text style={styles.emptyText}>{emptyGridMessage}</Text>{collectionSearchActive ? null : <Button accessibilityLabel={`Add images to ${activeCollection.name}`} contentMode="raw" onPress={() => openSheet("actions")} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button>}</View> : visibleImages.length === 0 && visibleOptimisticItems.length === 0 ? <Text style={styles.emptyText}>{emptyGridMessage}</Text> : (
            <View style={styles.grid}>
              {visibleOptimisticItems.map((item) => <View key={item.clientKey} accessibilityLabel={`Uploading ${item.filename}`} accessibilityRole="progressbar" style={[styles.imageButton, { width: imageSize, height: imageSize }]}>
                <View style={styles.imageFrame}>
                  <Image source={item.uri} contentFit="cover" style={styles.image} />
                  <View style={styles.optimisticOverlay}><Spinner size="small" /></View>
                </View>
              </View>)}
              {visibleImages.map((image) => (
                <Button key={image.key} accessibilityLabel={image.caption || image.filename} accessibilityState={{ selected: selectedImageKeys.includes(image.key) }} contentMode="raw" onLongPress={activeCollection && !showingDuplicates ? () => handleImageLongPress(image.key) : undefined} onPress={() => handleImagePress(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost">
                  <View style={[styles.imageFrame, selectedImageKeys.includes(image.key) && styles.imageFrameSelected]}>
                    <Image source={image.url} contentFit="cover" style={styles.image} transition={150} />
                    {selectedImageKeys.includes(image.key) ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
                  </View>
                </Button>
              ))}
            </View>
          )}
        </View> : contextualView ? <View style={styles.collectionView}>
          <View style={styles.collectionTitleRow}>
            <Button accessibilityLabel="Back to Gallery collections" contentMode="raw" hitSlop={5} onPress={() => { if (activeSubject) void exitSubject(); else showCollectionsOverview(); }} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
            <Text numberOfLines={1} style={styles.collectionTitle}>{activeSubject?.name ?? "Search results"}</Text>
            <Text style={styles.count}>{images.length}</Text>
          </View>
          {status ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}
          {images.length ? <View style={styles.grid}>{images.map((image) => <Button key={image.key} accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => handleImagePress(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost"><View style={styles.imageFrame}><Image source={image.url} contentFit="cover" style={styles.image} transition={150} /></View></Button>)}</View> : <View style={styles.emptyState}><Text style={styles.emptyText}>{emptyGridMessage}</Text></View>}
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

      <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title={sheetTitle} description={activeSheet === "destination" ? `${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"} ready to upload.` : activeSheet === "confirmDeleteDuplicates" ? `This removes ${images.length} redundant image${images.length === 1 ? "" : "s"} from this collection while keeping one original from each group. Images still used elsewhere remain available there.` : activeSheet === "createSubject" ? "Gallery learns the stable visual details that distinguish this specific subject." : activeSheet === "collectionMenu" ? selectedImageKeys.length ? `${selectedImageKeys.length} image${selectedImageKeys.length === 1 ? "" : "s"} selected.` : "Long press an image to select it, then select more with a tap." : activeSheet === "transferDestination" ? "Choose up to 20 destination collections." : undefined} dismissible={!busy && !imageActionsBusy} mutation={activeSheet === "newCollection" || activeSheet === "confirmDeleteDuplicates" || activeSheet === "createSubject" || activeSheet === "transferDestination"} tall={activeSheet === "image" || activeSheet === "subjects" || activeSheet === "transferDestination" || activeSheet === "destination" || activeSheet === "createSubject"}>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={[styles.sheetScroll, { maxHeight: height * 0.6 }]}>
        {activeSheet === "actions" ? <>
          {!activeCollection ? <BottomSheetItem icon={<FolderIcon size="md" />} onPress={() => { setPendingFiles([]); setNewCollectionName(""); openSheet("newCollection"); }} size="lg">Create collection</BottomSheetItem> : null}
          <BottomSheetItem disabled={busy} icon={<UploadIcon size="md" />} loading={busy} onPress={() => void choosePhotos()} size="lg">Upload images</BottomSheetItem>
          <BottomSheetItem disabled={busy} icon={<CameraIcon size="md" />} loading={busy} onPress={() => void takePhoto()} size="lg">Capture image</BottomSheetItem>
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
          {!selectedImageKeys.length ? <BottomSheetItem contentMode="raw" disabled={busy} onPress={() => { setSheetOpen(false); setStatus("Long press an image to begin selecting, then tap to add more."); }} size="lg" variant="ghost"><View style={styles.sheetItem}><CheckIcon size="md" /><View><Text style={styles.sheetText}>Select images</Text><Text style={styles.sheetSubtitle}>Long press any image to begin</Text></View></View></BottomSheetItem> : null}
          <BottomSheetItem contentMode="raw" disabled={busy || selectedImageKeys.length > 0} onPress={() => void showDuplicates()} size="lg" variant="ghost"><View style={styles.sheetItem}><CopyIcon size="md" /><View><Text style={styles.sheetText}>Find duplicates</Text><Text style={styles.sheetSubtitle}>Keep one image from every matching group</Text></View></View></BottomSheetItem>
          <BottomSheetItem contentMode="raw" disabled={busy || selectedImageKeys.length === 0} onPress={() => openTransfer("move")} size="lg" variant="ghost"><View style={styles.sheetItem}><FolderIcon size="md" variant={selectedImageKeys.length ? "default" : "muted"} /><View><Text style={styles.sheetText}>Move images</Text><Text style={styles.sheetSubtitle}>Remove from here and add to destinations</Text></View></View></BottomSheetItem>
          <BottomSheetItem contentMode="raw" disabled={busy || selectedImageKeys.length === 0} onPress={() => openTransfer("copy")} size="lg" variant="ghost"><View style={styles.sheetItem}><CopyIcon size="md" variant={selectedImageKeys.length ? "default" : "muted"} /><View><Text style={styles.sheetText}>Copy images</Text><Text style={styles.sheetSubtitle}>Keep here and add to destinations</Text></View></View></BottomSheetItem>
          <BottomSheetItem contentMode="raw" disabled={busy} onPress={() => openSheet("subjects")} size="lg" variant="ghost"><View style={styles.sheetItem}><UsersIcon size="md" /><View><Text style={styles.sheetText}>Manage subjects</Text><Text style={styles.sheetSubtitle}>{activeSubjects.length} active subject{activeSubjects.length === 1 ? "" : "s"}</Text></View></View></BottomSheetItem>
        </> : null}
        {activeSheet === "transferDestination" ? <View style={styles.form}>
          {collections.filter(({ key }) => key !== activeCollection?.key).map((collection) => {
            const selected = destinationCollectionKeys.includes(collection.key);
            return <BottomSheetItem key={collection.key} contentMode="raw" disabled={busy} onPress={() => setDestinationCollectionKeys((current) => selected ? current.filter((key) => key !== collection.key) : current.length >= 20 ? current : [...current, collection.key])} size="lg" variant={selected ? "secondary" : "ghost"}><View style={styles.sheetItem}>{selected ? <CheckIcon size="md" /> : <FolderIcon size="md" />}<View><Text style={styles.sheetText}>{collection.name}</Text><Text style={styles.sheetSubtitle}>{collection.count} images</Text></View></View></BottomSheetItem>;
          })}
          {collections.filter(({ key }) => key !== activeCollection?.key).length === 0 ? <Text style={styles.emptyText}>Create another collection before moving or copying images.</Text> : null}
          <Button disabled={busy || destinationCollectionKeys.length === 0} loading={busy} onPress={() => void completeTransfer()} size="md" variant="primary">{transferMode === "move" ? "Move" : "Copy"} {selectedImageKeys.length} image{selectedImageKeys.length === 1 ? "" : "s"}</Button>
        </View> : null}
        {activeSheet === "confirmDeleteDuplicates" ? <View style={styles.form}>
          <Button disabled={busy} onPress={() => setSheetOpen(false)} size="md" variant="secondary">Cancel</Button>
          <Button disabled={busy || images.length === 0} icon={<TrashIcon size="sm" variant="inverse" />} loading={busy} onPress={() => void deleteDuplicates()} size="md" variant="danger">Move duplicates to trash</Button>
        </View> : null}
        {activeSheet === "createSubject" ? <View style={styles.form}>
          {selectedImage ? <Image source={selectedImage.url} contentFit="cover" style={styles.subjectReference} /> : null}
          <TextInput autoFocus accessibilityLabel="Subject name" editable={!busy} onChangeText={setSubjectName} placeholder="Name this subject, for example Viggo" returnKeyType="done" style={styles.formInput} value={subjectName} />
          {subjectReferenceOptions.length > 1 ? <>
            <Text style={styles.listLabel}>REFERENCE IMAGES {subjectReferenceKeys.length}/8</Text>
            <View style={styles.referenceGrid}>{subjectReferenceOptions.map((image) => {
              const selected = subjectReferenceKeys.includes(image.key);
              return <Button key={image.key} accessibilityLabel={`${selected ? "Remove" : "Add"} reference image`} accessibilityState={{ selected }} contentMode="raw" onPress={() => setSubjectReferenceKeys((current) => selected ? current.length > 1 ? current.filter((key) => key !== image.key) : current : [...current, image.key].slice(0, 8))} size="xl" style={[styles.referenceOption, !selected && styles.referenceOptionMuted]} variant="ghost"><View style={[styles.imageFrame, selected && styles.imageFrameSelected]}><Image source={image.url} contentFit="cover" style={styles.image} />{selected ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>;
            })}</View>
          </> : null}
          <Text style={styles.sheetSubtitle}>Gallery compares these references, learns persistent visual details, and finds likely matches.</Text>
          <Button disabled={busy || !subjectName.trim() || subjectReferenceKeys.length === 0} loading={busy} onPress={() => void createSubject()} size="md" variant="primary">Create subject</Button>
        </View> : null}
        {activeSheet === "subjects" ? <View style={styles.subjectList}>
          <Text style={styles.listLabel}>ACTIVE</Text>
          {activeSubjects.length ? activeSubjects.map((subject) => <View key={subject.key} style={styles.subjectRow}>
            <Image source={subject.referenceUrl} contentFit="cover" style={styles.subjectRowImage} />
            <Button accessibilityLabel={`Show images of ${subject.name}`} contentMode="raw" disabled={busy} onPress={() => void showSubject(subject)} size="md" style={styles.subjectRowMain} variant="ghost"><View><Text style={styles.sheetText}>{subject.name}</Text><Text style={styles.sheetSubtitle}>{subject.imageCount} matched images</Text></View></Button>
            <Button accessibilityLabel={`Delete subject ${subject.name}`} contentMode="raw" disabled={busy} onPress={() => void setSubjectDeleted(subject, true)} size="md" variant="icon"><TrashIcon size="sm" variant="danger" /></Button>
          </View>) : <Text style={styles.emptyText}>No active Subjects.</Text>}
          <Text style={styles.listLabel}>RECENTLY DELETED</Text>
          {deletedSubjects.length ? deletedSubjects.map((subject) => <View key={subject.key} style={styles.subjectRow}>
            <Image source={subject.referenceUrl} contentFit="cover" style={styles.subjectRowImage} />
            <View style={styles.subjectRowMain}><Text style={styles.sheetText}>{subject.name}</Text><Text style={styles.sheetSubtitle}>Deleted subject</Text></View>
            <Button accessibilityLabel={`Restore subject ${subject.name}`} contentMode="raw" disabled={busy} onPress={() => void setSubjectDeleted(subject, false)} size="md" variant="icon"><ClockIcon size="sm" /></Button>
          </View>) : <Text style={styles.emptyText}>No deleted Subjects.</Text>}
        </View> : null}
        {activeSheet === "image" && selectedImage ? <View style={styles.detail}>
          <Image source={selectedImage.url} contentFit="contain" style={[styles.detailImage, { height: Math.min(360, height * 0.4) }]} />
          <Text style={styles.detailCaption}>{selectedImage.caption || "This image is still being described."}</Text>
          {imageError ? <View accessibilityLiveRegion="assertive" style={styles.inlineError}><Text style={styles.inlineErrorText}>{imageError}</Text></View> : null}
          <View style={[styles.detailActions, width < 370 && styles.detailActionsCompact]}>
            <Button disabled={imageActionsBusy} loading={imageAction === "similar"} onPress={() => void findSimilar()} size="md" style={[styles.detailAction, width < 370 && styles.detailActionCompact]} variant="secondary">Find similar images</Button>
          </View>
          <View style={[styles.detailActions, width < 370 && styles.detailActionsCompact]}>
            <Button disabled={imageActionsBusy} icon={<UsersIcon size="sm" />} onPress={() => { setSubjectName(""); setSubjectReferenceKeys([selectedImage.key]); openSheet("createSubject"); }} size="md" style={[styles.detailAction, width < 370 && styles.detailActionCompact]} variant="secondary">Create subject</Button>
            <Button disabled={imageActionsBusy} icon={<StarIcon size="sm" variant="inverse" />} loading={imageAction === "favorite"} onPress={() => void toggleFavorite()} size="md" style={[styles.detailAction, width < 370 && styles.detailActionCompact]} variant="primary">{selectedImage.isFavorite ? "Unfavorite" : "Favorite"}</Button>
          </View>
          {similarImages.length ? <View style={styles.grid}>{similarImages.map((image) => <Button key={image.key} accessibilityLabel={image.caption || image.filename} contentMode="raw" disabled={imageActionsBusy} onPress={() => void showImage(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost"><View style={styles.imageFrame}><Image source={image.url} contentFit="cover" style={styles.image} /></View></Button>)}</View> : null}
        </View> : null}
        </ScrollView>
      </BottomSheet>
      {cameraOpen ? <BrandedCameraModal hint="Frame the moment and hold steady" onCapture={useCapturedPhoto} onClose={() => setCameraOpen(false)} title="Capture for Gallery" /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, justifyContent: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  galleryRoot: { flexGrow: 1 },
  rootActions: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  rootCreateButton: { height: 44, width: 44 },
  rootSearch: { minHeight: 44, flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  statusCard: { marginBottom: spacing.sm, paddingHorizontal: 13, paddingVertical: 10, borderLeftWidth: 2, borderLeftColor: palette.silver700, borderRadius: radii.md, backgroundColor: palette.panel },
  status: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  collectionView: { flexGrow: 1, gap: spacing.md },
  collectionTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  collectionTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  collectionTitleActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  selectionTitle: { minHeight: 44, flex: 1, justifyContent: "flex-start" },
  collectionSearch: { minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  sectionTitle: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  count: { color: palette.silver700, fontFamily: fonts.medium, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  collectionGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: COLLECTION_GAP },
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
  subjectList: { gap: 10 },
  listLabel: { marginTop: 8, color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  subjectRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10 },
  subjectRowImage: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.panelRaised },
  subjectRowMain: { flex: 1, alignItems: "flex-start" },
  subjectReference: { width: 112, height: 112, alignSelf: "center", borderRadius: 56, backgroundColor: palette.panelRaised },
  referenceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  referenceOption: { width: 58, height: 58, paddingHorizontal: 0, paddingVertical: 0 },
  referenceOptionMuted: { opacity: 0.42 },
  form: { gap: 14 },
  formInput: { minHeight: 48 },
  detail: { gap: 16 },
  detailImage: { width: "100%", height: 360, borderRadius: radii.lg, backgroundColor: palette.voidBlack },
  detailCaption: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  detailActions: { flexDirection: "row", gap: 8 },
  detailActionsCompact: { flexDirection: "column" },
  detailAction: { flex: 1 },
  detailActionCompact: { flex: 0, width: "100%" },
  inlineError: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(176, 74, 74, 0.45)", backgroundColor: "rgba(176, 74, 74, 0.1)" },
  inlineErrorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
});
