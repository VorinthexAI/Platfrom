import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { CameraIcon, CheckIcon, ChevronLeftIcon, ClockIcon, CloseIcon, CopyIcon, FolderIcon, GalleryIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon, StarIcon, TrashIcon, UploadIcon, UsersIcon } from "@vorinthex/shared/ui/icons-mobile";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
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
  findInitialMediaCollection,
  findGalleryCollectionDuplicates,
  listGallerySubjectImages,
  listGallerySubjects,
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
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

type GallerySheet = "actions" | "source" | "destination" | "newCollection" | "image" | "collectionMenu" | "confirmDeleteDuplicates" | "createSubject" | "subjects" | "transferDestination";
type CollectionTransferMode = "copy" | "move";
const COLLECTION_COLUMNS = 3;
const IMAGE_COLUMNS = 5;
const GRID_GAP = 5;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Gallery could not complete that request.";
}

export function GalleryWorkspace() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [collections, setCollections] = useState<GalleryCollection[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [activeCollection, setActiveCollection] = useState<GalleryCollection>();
  const [showingCollectionOverview, setShowingCollectionOverview] = useState(false);
  const [subjects, setSubjects] = useState<GallerySubject[]>([]);
  const [activeSubject, setActiveSubject] = useState<GallerySubject>();
  const [selectedImage, setSelectedImage] = useState<GalleryImage>();
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PreparedGalleryUpload[]>([]);
  const [activeSheet, setActiveSheet] = useState<GallerySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
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
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [searching, setSearching] = useState(false);
  const [imageAction, setImageAction] = useState<"similar" | "favorite">();
  const [imageError, setImageError] = useState<string>();
  const viewRequest = useRef(0);
  const imageSheetRequest = useRef(0);
  const initialCollectionResolved = useRef(false);
  const longPressedImage = useRef<{ key: string; at: number } | undefined>(undefined);

  const contentWidth = width - spacing.md * 2;
  const collectionSize = Math.floor((contentWidth - GRID_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const imageSize = Math.floor((contentWidth - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);

  async function load(collection = activeCollection) {
    const request = ++viewRequest.current;
    setLoading(true);
    try {
      const overview = await fetchGalleryOverview(collection?.key);
      if (request !== viewRequest.current) return;
      setCollections(overview.collections);
      setImages(overview.images);
      setStatus(undefined);
    } catch (error) {
      if (request === viewRequest.current) setStatus(errorMessage(error));
    } finally {
      if (request === viewRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (showingSearchResults || activeSubject) return;
    const request = ++viewRequest.current;
    setLoading(true);
    void fetchGalleryOverview(activeCollection?.key).then((overview) => {
      if (request !== viewRequest.current) return;
      setCollections(overview.collections);
      if (!activeCollection && !initialCollectionResolved.current) {
        initialCollectionResolved.current = true;
        const provisionedCollection = findInitialMediaCollection(overview.collections);
        if (provisionedCollection) {
          setShowingCollectionOverview(false);
          setActiveCollection(provisionedCollection);
          return;
        }
        setShowingCollectionOverview(true);
      }
      setImages(overview.images);
      setStatus(undefined);
    }).catch((error: unknown) => { if (request === viewRequest.current) setStatus(errorMessage(error)); }).finally(() => { if (request === viewRequest.current) setLoading(false); });
  }, [activeCollection?.key, activeSubject?.key, showingSearchResults]);

  async function loadSubjects() {
    try {
      setSubjects((await listGallerySubjects(true)).subjects);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  useEffect(() => { void loadSubjects(); }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  function openSheet(sheet: GallerySheet) {
    setActiveSheet(sheet);
    setSheetOpen(true);
  }

  function showCollectionsOverview() {
    viewRequest.current += 1;
    setShowingCollectionOverview(true);
    setLoading(true);
    setQuery("");
    setSelectedImageKeys([]);
    setActiveCollection(undefined);
    setActiveSubject(undefined);
    setShowingDuplicates(false);
    setShowingSearchResults(false);
  }

  async function prepareAssets(assets: ImagePicker.ImagePickerAsset[]) {
    setBusy(true);
    setSheetOpen(false);
    try {
      const files = await Promise.all(assets.slice(0, 20).map(async (asset, index) => {
        const maxSide = Math.max(asset.width, asset.height);
        const actions: ImageManipulator.Action[] = maxSide > 2400
          ? [{ resize: asset.width >= asset.height ? { width: 2400 } : { height: 2400 } }]
          : [];
        const output = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG });
        const blob = await (await fetch(output.uri)).blob();
        return {
          clientKey: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          filename: `gallery-${Date.now()}-${index + 1}.jpg`,
          uri: output.uri,
          sizeBytes: blob.size,
        };
      }));
      setPendingFiles(files);
      openSheet("destination");
      setStatus(undefined);
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
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setSheetOpen(false); setStatus("Camera access is required to take a photo."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
    if (!result.canceled) await prepareAssets(result.assets);
  }

  async function uploadTo(collectionKey?: string) {
    if (pendingFiles.length === 0) return;
    setBusy(true);
    setSheetOpen(false);
    try {
      const result = await uploadGalleryImages(pendingFiles, collectionKey);
      setPendingFiles([]);
      const uploadKeys = result.jobs.map(({ key }) => key);
      const uploadView = viewRequest.current;
      setStatus("Upload complete. Gallery is describing your images in the background.");
      setBusy(false);
      void (async () => {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await wait(3_000);
          const current = await fetchGalleryUploadStatus(uploadKeys);
          if (current.jobs.every(({ status: jobStatus }) => jobStatus === "completed" || jobStatus === "failed")) break;
        }
        if (uploadView === viewRequest.current) await load();
        await loadSubjects();
      })().catch((error: unknown) => setStatus(errorMessage(error)));
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
      setCollections((current) => [...current, collection]);
      setNewCollectionName("");
      if (pendingFiles.length) await uploadTo(collection.key);
      else { setSheetOpen(false); setBusy(false); await load(); }
    } catch (error) {
      setStatus(errorMessage(error));
      setBusy(false);
    }
  }

  async function search() {
    const value = query.trim();
    if (!value) { setShowingCollectionOverview(true); setShowingSearchResults(false); await load(); return; }
    const request = ++viewRequest.current;
    setSearching(true);
    try {
      const result = await searchGalleryImages({ query: value, limit: 50 });
      if (request !== viewRequest.current) return;
      setShowingSearchResults(true);
      setSelectedImageKeys([]);
      setActiveSubject(undefined);
      setActiveCollection(undefined);
      setImages(result.images);
      setStatus(`${result.images.length} result${result.images.length === 1 ? "" : "s"} for "${value}"`);
    } catch (error) {
      if (request === viewRequest.current) setStatus(errorMessage(error));
    } finally {
      setSearching(false);
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
    } catch (error) {
      setImageError(errorMessage(error));
    } finally {
      setImageAction(undefined);
    }
  }

  async function showDuplicates() {
    if (!activeCollection) return;
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
      const searchRequest = searchGalleryImages({ query: message, limit: 50 }).then((result) => {
        if (request !== viewRequest.current) return result;
        setActiveCollection(undefined);
        setActiveSubject(undefined);
        setShowingDuplicates(false);
        setShowingSearchResults(true);
        setSelectedImageKeys([]);
        setImages(result.images);
        setStatus(`${result.images.length} image${result.images.length === 1 ? "" : "s"} found by your Gallery assistant.`);
        return result;
      });
      const [assistantResult, searchResult] = await Promise.allSettled([askGalleryAssistant(message), searchRequest]);
      if (request !== viewRequest.current) return;
      if (searchResult.status === "fulfilled" && searchResult.value.images.length > 0) setAiResponse(`I found ${searchResult.value.images.length} matching image${searchResult.value.images.length === 1 ? "" : "s"}.`);
      else if (assistantResult.status === "fulfilled") setAiResponse(assistantResult.value.message);
      else if (searchResult.status === "fulfilled") setAiResponse("I could not find a matching image.");
      else throw assistantResult.reason;
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
  const sheetTitle = activeSheet === "actions" ? "New in Gallery"
    : activeSheet === "source" ? "Add images"
    : activeSheet === "destination" ? "Choose destination"
      : activeSheet === "newCollection" ? "New collection"
        : activeSheet === "collectionMenu" ? "Collection actions"
          : activeSheet === "confirmDeleteDuplicates" ? "Delete duplicates?"
            : activeSheet === "createSubject" ? "Create subject"
              : activeSheet === "subjects" ? "Manage subjects"
                : activeSheet === "transferDestination" ? `${transferMode === "move" ? "Move" : "Copy"} images`
                  : "Image";
  const emptyGridMessage = showingDuplicates
    ? "No duplicate images were found in this collection."
    : activeSubject
      ? `No images are currently identified as ${activeSubject.name}.`
      : showingSearchResults
        ? "No images matched this search."
        : activeCollection
          ? "This collection has no images yet."
          : "Your visual memory starts with the first image.";
  const contextualView = Boolean(activeCollection || activeSubject || showingSearchResults || showingDuplicates);
  const normalCollectionView = Boolean(activeCollection && !activeSubject && !showingSearchResults && !showingDuplicates);
  const imageActionsBusy = imageAction !== undefined;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "height" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher active="gallery" />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 126 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {contextualView ? <View style={styles.searchBar}>
          <SearchIcon size="sm" variant="muted" />
          <TextInput accessibilityLabel="Search Gallery" onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="A foggy morning, blueprints, a red chair..." returnKeyType="search" style={styles.searchInput} value={query} />
          <Button accessibilityLabel="Search" contentMode="raw" disabled={busy || searching} loading={searching} onPress={() => void search()} size="sm" variant="icon"><SearchIcon size="sm" /></Button>
        </View> : null}

        {status && contextualView ? <View accessibilityLiveRegion="polite" style={styles.statusCard}><Text style={styles.status}>{status}</Text></View> : null}

        {!contextualView && showingCollectionOverview ? (
          <View style={styles.collectionLanding}>
            <View style={styles.collectionLandingHeader}>
              <Button accessibilityLabel="Create or add to Gallery" contentMode="raw" onPress={() => openSheet("actions")} size="md" variant="icon"><PlusIcon size="sm" /></Button>
            </View>
            <View style={styles.grid}>
              {collections.map((collection) => (
                <Button key={collection.key} accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => { viewRequest.current += 1; setShowingCollectionOverview(false); setLoading(true); setQuery(""); setSelectedImageKeys([]); setActiveSubject(undefined); setShowingDuplicates(false); setShowingSearchResults(false); setActiveCollection(collection); }} size="xl" style={[styles.collectionCard, { width: collectionSize }]} variant="ghost">
                  {collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={[styles.collectionCover, { height: collectionSize }]} /> : <View style={[styles.emptyCover, { height: collectionSize }]}><FolderIcon size="lg" variant="muted" /></View>}
                  <Text numberOfLines={1} style={styles.collectionName}>{collection.name}</Text>
                  <Text style={styles.collectionCount}>{collection.count} images</Text>
                </Button>
              ))}
            </View>
          </View>
        ) : null}

        {contextualView ? <View style={styles.section}>
          <View style={styles.sectionHeader}>
            {selectedImageKeys.length ? <Button accessibilityLabel="Clear image selection" contentMode="raw" onPress={() => setSelectedImageKeys([])} size="xs" variant="ghost"><CloseIcon size="sm" /><Text style={styles.sectionTitle}>{selectedImageKeys.length} SELECTED</Text></Button> : activeSubject ? <Button accessibilityLabel="Back to all Subjects" contentMode="raw" onPress={() => void exitSubject()} size="xs" variant="ghost"><ChevronLeftIcon size="sm" /><Text style={styles.sectionTitle}>{activeSubject.name.toUpperCase()}</Text></Button> : activeCollection && showingDuplicates ? <Button accessibilityLabel={`Back to ${activeCollection.name}`} contentMode="raw" onPress={() => void exitDuplicates()} size="xs" variant="ghost"><ChevronLeftIcon size="sm" /><Text style={styles.sectionTitle}>DUPLICATES</Text></Button> : activeCollection ? <View style={styles.collectionDetailHeading}><Button accessibilityLabel="Back to Your Collections" contentMode="raw" onPress={showCollectionsOverview} size="xs" style={styles.collectionBack} variant="ghost"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.collectionDetailTitle}>{activeCollection.name}</Text></View> : showingSearchResults ? <Button accessibilityLabel="Back to Gallery" contentMode="raw" onPress={() => { setShowingCollectionOverview(true); setQuery(""); setShowingSearchResults(false); setLoading(true); }} size="xs" variant="ghost"><ChevronLeftIcon size="sm" /><Text style={styles.sectionTitle}>SEARCH RESULTS</Text></Button> : <Text style={styles.sectionTitle}>ALL IMAGES</Text>}
            <View style={styles.sectionActions}>
              <Text style={styles.count}>{images.length}</Text>
              {normalCollectionView && !selectedImageKeys.length ? <Button accessibilityLabel="Create or add to Gallery" contentMode="raw" hitSlop={6} onPress={() => openSheet("actions")} size="md" variant="icon"><PlusIcon size="sm" /></Button> : null}
              {activeCollection && !showingDuplicates ? <Button accessibilityLabel="Collection actions" contentMode="raw" hitSlop={6} onPress={() => openSheet("collectionMenu")} size="md" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}
              {activeCollection && showingDuplicates ? <Button accessibilityLabel="Delete duplicate images" contentMode="raw" disabled={images.length === 0} hitSlop={6} onPress={() => openSheet("confirmDeleteDuplicates")} size="md" variant="icon"><TrashIcon size="sm" variant={images.length ? "danger" : "muted"} /></Button> : null}
            </View>
          </View>
          {loading ? <Text style={styles.emptyText}>Opening Gallery...</Text> : images.length === 0 && normalCollectionView ? <View style={styles.collectionEmpty}><Text style={styles.emptyText}>{emptyGridMessage}</Text><Button accessibilityLabel="Add to this collection" onPress={() => openSheet("actions")} size="sm" textStyle={styles.emptyActionText} variant="ghost">Add images or create a collection</Button></View> : images.length === 0 ? <Text style={styles.emptyText}>{emptyGridMessage}</Text> : (
            <View style={styles.grid}>
              {images.map((image) => (
                <Button key={image.key} accessibilityLabel={image.caption || image.filename} accessibilityState={{ selected: selectedImageKeys.includes(image.key) }} contentMode="raw" onLongPress={activeCollection && !showingDuplicates ? () => handleImageLongPress(image.key) : undefined} onPress={() => handleImagePress(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost">
                  <View style={[styles.imageFrame, selectedImageKeys.includes(image.key) && styles.imageFrameSelected]}>
                    <Image source={image.url} contentFit="cover" style={styles.image} transition={150} />
                    {selectedImageKeys.includes(image.key) ? <View style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
                  </View>
                </Button>
              ))}
            </View>
          )}
        </View> : null}
      </ScrollView>

      <View style={[styles.composerWrap, { bottom: keyboardVisible ? 6 : insets.bottom + 12 }]}>
        {aiResponse ? <Text numberOfLines={3} style={styles.aiResponse}>{aiResponse}</Text> : null}
        <View style={styles.composer}>
          <View style={styles.coreMark}><ChromeIcon glow={0.35} size={24} source={assistantIconSource} /></View>
          <TextInput accessibilityLabel="Ask Core anything" editable={!assistantBusy} onChangeText={setAiInput} onSubmitEditing={() => void askAssistant()} placeholder="Ask Core anything..." returnKeyType="send" style={styles.composerInput} value={aiInput} />
          <Button accessibilityLabel="Send to Core" contentMode="raw" disabled={assistantBusy || !aiInput.trim()} loading={assistantBusy} onPress={() => void askAssistant()} size="sm" variant="primary"><SendIcon size="sm" variant="inverse" /></Button>
        </View>
      </View>

      <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title={sheetTitle} description={activeSheet === "destination" ? `${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"} ready to upload.` : activeSheet === "confirmDeleteDuplicates" ? `This removes ${images.length} redundant image${images.length === 1 ? "" : "s"} from this collection while keeping one original from each group. Images still used elsewhere remain available there.` : activeSheet === "createSubject" ? "Gallery learns the stable visual details that distinguish this specific subject." : activeSheet === "collectionMenu" ? selectedImageKeys.length ? `${selectedImageKeys.length} image${selectedImageKeys.length === 1 ? "" : "s"} selected.` : "Long press an image to select it, then select more with a tap." : activeSheet === "transferDestination" ? "Choose up to 20 destination collections." : undefined} dismissible={!busy && !imageActionsBusy} mutation={activeSheet === "newCollection" || activeSheet === "confirmDeleteDuplicates" || activeSheet === "createSubject" || activeSheet === "transferDestination"} tall={activeSheet === "image" || activeSheet === "subjects" || activeSheet === "transferDestination" || activeSheet === "destination" || activeSheet === "createSubject"}>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={[styles.sheetScroll, { maxHeight: height * 0.6 }]}>
        {activeSheet === "actions" ? <>
          <BottomSheetItem icon={<FolderIcon size="md" />} onPress={() => { setPendingFiles([]); setNewCollectionName(""); openSheet("newCollection"); }} size="lg">Create collection</BottomSheetItem>
          <BottomSheetItem disabled={busy} icon={<UploadIcon size="md" />} loading={busy} onPress={() => void choosePhotos()} size="lg">Upload images</BottomSheetItem>
          <BottomSheetItem disabled={busy} icon={<CameraIcon size="md" />} loading={busy} onPress={() => void takePhoto()} size="lg">Capture image</BottomSheetItem>
        </> : null}
        {activeSheet === "source" ? <>
          <BottomSheetItem contentMode="raw" onPress={() => void choosePhotos()} size="lg" variant="ghost"><View style={styles.sheetItem}><UploadIcon size="md" /><Text style={styles.sheetText}>Choose from photos</Text></View></BottomSheetItem>
          <BottomSheetItem contentMode="raw" onPress={() => void takePhoto()} size="lg" variant="ghost"><View style={styles.sheetItem}><CameraIcon size="md" /><Text style={styles.sheetText}>Take a photo</Text></View></BottomSheetItem>
        </> : null}
        {activeSheet === "destination" ? <>
          <BottomSheetItem contentMode="raw" disabled={busy} onPress={() => void uploadTo()} size="lg" variant="secondary"><View style={styles.sheetItem}><GalleryIcon size="md" /><Text style={styles.sheetText}>All images</Text></View></BottomSheetItem>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, justifyContent: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  scroll: { paddingHorizontal: spacing.md },
  collectionLanding: { paddingTop: spacing.md },
  collectionLandingHeader: { minHeight: 50, marginBottom: spacing.sm, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  intro: { paddingTop: 28, paddingBottom: 24 },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.label },
  heading: { marginTop: 10, color: palette.silver50, fontFamily: fonts.light, fontSize: 34, letterSpacing: -1.2 },
  subheading: { marginTop: 9, maxWidth: 330, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  searchBar: { height: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panel },
  searchInput: { flex: 1, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0, fontSize: 13 },
  statusCard: { marginTop: 12, paddingHorizontal: 13, paddingVertical: 10, borderLeftWidth: 2, borderLeftColor: palette.silver700, borderRadius: radii.md, backgroundColor: palette.panel },
  status: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  section: { marginTop: 30 },
  sectionHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  collectionDetailHeading: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center" },
  collectionBack: { width: 28, paddingHorizontal: 0 },
  collectionDetailTitle: { minWidth: 0, flexShrink: 1, color: palette.silver100, fontFamily: fonts.regular, fontSize: 20, letterSpacing: -0.3 },
  sectionActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionTitle: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  count: { color: palette.silver700, fontFamily: fonts.medium, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  collectionCard: { alignItems: "stretch", paddingHorizontal: 0, paddingVertical: 0 },
  collectionCover: { width: "100%", borderRadius: radii.md, backgroundColor: palette.panelRaised },
  subjectCover: { width: "100%", borderRadius: 999, backgroundColor: palette.panelRaised },
  emptyCover: { width: "100%", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel },
  collectionName: { marginTop: 8, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  collectionCount: { marginTop: 2, color: palette.silver500, fontFamily: fonts.regular, fontSize: 10 },
  imageButton: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: "transparent" },
  imageFrame: { width: "100%", height: "100%", overflow: "hidden", borderWidth: 1, borderColor: "transparent", borderRadius: radii.md, backgroundColor: palette.panelRaised },
  imageFrameSelected: { borderColor: palette.silver50, borderWidth: 2 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  image: { width: "100%", height: "100%" },
  emptyText: { paddingVertical: 28, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
  collectionEmpty: { minHeight: 260, alignItems: "center", justifyContent: "center" },
  emptyActionText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  composerWrap: { position: "absolute", left: spacing.md, right: spacing.md, gap: 6 },
  aiResponse: { paddingHorizontal: 14, paddingVertical: 9, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, borderRadius: radii.md, backgroundColor: palette.panel },
  composer: { minHeight: 58, padding: 7, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: 999, backgroundColor: palette.obsidian850, shadowColor: palette.voidBlack, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  coreMark: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  composerInput: { flex: 1, minHeight: 38, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
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
