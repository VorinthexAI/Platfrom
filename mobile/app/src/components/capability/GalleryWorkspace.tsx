import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { CameraIcon, ChevronLeftIcon, FolderIcon, GalleryIcon, PlusIcon, SearchIcon, SendIcon, UploadIcon } from "@vorinthex/shared/ui/icons-mobile";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import {
  askGalleryAssistant,
  createGalleryCollection,
  fetchGalleryOverview,
  fetchGalleryUploadStatus,
  searchGalleryImages,
  uploadGalleryImages,
  type GalleryCollection,
  type GalleryImage,
  type PreparedGalleryUpload,
} from "@/lib/gallery-client";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

type GallerySheet = "source" | "destination" | "newCollection" | "image";
const COLLECTION_COLUMNS = 3;
const IMAGE_COLUMNS = 5;
const GRID_GAP = 5;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Gallery could not complete that request.";
}

export function GalleryWorkspace() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [collections, setCollections] = useState<GalleryCollection[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [activeCollection, setActiveCollection] = useState<GalleryCollection>();
  const [selectedImage, setSelectedImage] = useState<GalleryImage>();
  const [similarImages, setSimilarImages] = useState<GalleryImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PreparedGalleryUpload[]>([]);
  const [activeSheet, setActiveSheet] = useState<GallerySheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showingSearchResults, setShowingSearchResults] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [aiInput, setAiInput] = useState("");
  const [aiResponse, setAiResponse] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const contentWidth = width - spacing.md * 2;
  const collectionSize = Math.floor((contentWidth - GRID_GAP * (COLLECTION_COLUMNS - 1)) / COLLECTION_COLUMNS);
  const imageSize = Math.floor((contentWidth - GRID_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);

  async function load(collection = activeCollection) {
    setLoading(true);
    try {
      const overview = await fetchGalleryOverview(collection?.key);
      setCollections(overview.collections);
      setImages(overview.images);
      setStatus(undefined);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (showingSearchResults) return;
    void fetchGalleryOverview(activeCollection?.key).then((overview) => {
      setCollections(overview.collections);
      setImages(overview.images);
      setStatus(undefined);
    }).catch((error: unknown) => setStatus(errorMessage(error))).finally(() => setLoading(false));
  }, [activeCollection?.key, showingSearchResults]);

  function openSheet(sheet: GallerySheet) {
    setActiveSheet(sheet);
    setSheetOpen(true);
  }

  async function prepareAssets(assets: ImagePicker.ImagePickerAsset[]) {
    setBusy(true);
    setSheetOpen(false);
    setStatus(`Preparing ${assets.length} image${assets.length === 1 ? "" : "s"}...`);
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
    setStatus(`Uploading ${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"}...`);
    try {
      const result = await uploadGalleryImages(pendingFiles, collectionKey);
      setPendingFiles([]);
      const uploadKeys = result.jobs.map(({ key }) => key);
      setStatus("Upload complete. Gallery is describing your images in the background.");
      setBusy(false);
      void (async () => {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await wait(3_000);
          const current = await fetchGalleryUploadStatus(uploadKeys);
          if (current.jobs.every(({ status: jobStatus }) => jobStatus === "completed" || jobStatus === "failed")) break;
        }
        await load();
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
    if (!value) { setShowingSearchResults(false); await load(); return; }
    setBusy(true);
    setStatus("Searching by meaning...");
    try {
      const result = await searchGalleryImages({ query: value, limit: 50 });
      setShowingSearchResults(true);
      setActiveCollection(undefined);
      setImages(result.images);
      setStatus(`${result.images.length} result${result.images.length === 1 ? "" : "s"} for "${value}"`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function showImage(image: GalleryImage) {
    setSelectedImage(image);
    setSimilarImages([]);
    openSheet("image");
  }

  async function findSimilar() {
    if (!selectedImage) return;
    setBusy(true);
    try {
      const result = await searchGalleryImages({ imageKey: selectedImage.key, limit: 15 });
      setSimilarImages(result.images);
    } catch (error) {
      setStatus(errorMessage(error));
      setSheetOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function askAssistant() {
    const message = aiInput.trim();
    if (!message) return;
    setBusy(true);
    setAiInput("");
    try {
      const response = await askGalleryAssistant(message);
      setAiResponse(response.message);
    } catch (error) {
      setAiResponse(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Button accessibilityLabel="Back to your personal AI" contentMode="raw" onPress={() => navigation.goBack()} size="md" style={styles.headerButton} variant="ghost">
          <ChevronLeftIcon size="md" variant="accent" />
        </Button>
        <WorkspaceAppSwitcher active="gallery" />
        <Button accessibilityLabel="Add images" contentMode="raw" onPress={() => openSheet("source")} size="md" style={styles.headerButton} variant="icon">
          <PlusIcon size="md" />
        </Button>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 126 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>VISUAL MEMORY</Text>
          <Text style={styles.heading}>Images, understood.</Text>
          <Text style={styles.subheading}>Collect moments and retrieve them by meaning rather than by filename.</Text>
        </View>

        <View style={styles.searchBar}>
          <SearchIcon size="sm" variant="muted" />
          <TextInput accessibilityLabel="Search Gallery" onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="A foggy morning, blueprints, a red chair..." returnKeyType="search" style={styles.searchInput} value={query} />
          <Button accessibilityLabel="Search" contentMode="raw" disabled={busy} onPress={() => void search()} size="xs" variant="icon"><SearchIcon size="sm" /></Button>
        </View>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {!activeCollection && !showingSearchResults ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>COLLECTIONS</Text><Text style={styles.count}>{collections.length}</Text></View>
            <View style={styles.grid}>
              {collections.map((collection) => (
                <Button key={collection.key} accessibilityLabel={`${collection.name}, ${collection.count} images`} contentMode="raw" onPress={() => { setLoading(true); setQuery(""); setShowingSearchResults(false); setActiveCollection(collection); }} size="xl" style={[styles.collectionCard, { width: collectionSize }]} variant="ghost">
                  {collection.coverUrl ? <Image source={collection.coverUrl} contentFit="cover" style={[styles.collectionCover, { height: collectionSize }]} /> : <View style={[styles.emptyCover, { height: collectionSize }]}><FolderIcon size="lg" variant="muted" /></View>}
                  <Text numberOfLines={1} style={styles.collectionName}>{collection.name}</Text>
                  <Text style={styles.collectionCount}>{collection.count} images</Text>
                </Button>
              ))}
              <Button accessibilityLabel="Create collection" contentMode="raw" onPress={() => { setPendingFiles([]); openSheet("newCollection"); }} size="xl" style={[styles.collectionCard, { width: collectionSize }]} variant="ghost">
                <View style={[styles.emptyCover, { height: collectionSize }]}><PlusIcon size="lg" variant="muted" /></View>
                <Text style={styles.collectionName}>New collection</Text>
              </Button>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            {activeCollection ? <Button accessibilityLabel="All images" contentMode="raw" onPress={() => { setLoading(true); setActiveCollection(undefined); }} size="xs" variant="ghost"><ChevronLeftIcon size="sm" /><Text style={styles.sectionTitle}>{activeCollection.name.toUpperCase()}</Text></Button> : <Text style={styles.sectionTitle}>{showingSearchResults ? "SEARCH RESULTS" : "ALL IMAGES"}</Text>}
            <Text style={styles.count}>{images.length}</Text>
          </View>
          {loading ? <Text style={styles.emptyText}>Opening Gallery...</Text> : images.length === 0 ? <Text style={styles.emptyText}>Your visual memory starts with the first image.</Text> : (
            <View style={styles.grid}>
              {images.map((image) => (
                <Button key={image.key} accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => void showImage(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost">
                  <Image source={image.url} contentFit="cover" style={styles.image} transition={150} />
                </Button>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.composerWrap, { bottom: insets.bottom + 12 }]}>
        {aiResponse ? <Text numberOfLines={3} style={styles.aiResponse}>{aiResponse}</Text> : null}
        <View style={styles.composer}>
          <GalleryIcon size="sm" variant="muted" />
          <TextInput accessibilityLabel="Ask your Gallery assistant" editable={!busy} onChangeText={setAiInput} onSubmitEditing={() => void askAssistant()} placeholder="Ask about your images..." returnKeyType="send" style={styles.composerInput} value={aiInput} />
          <Button accessibilityLabel="Send" contentMode="raw" disabled={busy || !aiInput.trim()} onPress={() => void askAssistant()} size="sm" variant="primary"><SendIcon size="sm" variant="inverse" /></Button>
        </View>
      </View>

      <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title={activeSheet === "source" ? "Add images" : activeSheet === "destination" ? "Choose destination" : activeSheet === "newCollection" ? "New collection" : "Image"} description={activeSheet === "destination" ? `${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"} ready to upload.` : undefined} dismissible={!busy} mutation={activeSheet === "newCollection"} tall={activeSheet === "image"}>
        {activeSheet === "source" ? <>
          <BottomSheetItem contentMode="raw" onPress={() => void choosePhotos()} size="md" variant="ghost"><View style={styles.sheetItem}><UploadIcon size="md" /><Text style={styles.sheetText}>Choose from photos</Text></View></BottomSheetItem>
          <BottomSheetItem contentMode="raw" onPress={() => void takePhoto()} size="md" variant="ghost"><View style={styles.sheetItem}><CameraIcon size="md" /><Text style={styles.sheetText}>Take a photo</Text></View></BottomSheetItem>
        </> : null}
        {activeSheet === "destination" ? <>
          <BottomSheetItem contentMode="raw" disabled={busy} onPress={() => void uploadTo()} size="md" variant="secondary"><View style={styles.sheetItem}><GalleryIcon size="md" /><Text style={styles.sheetText}>All images</Text></View></BottomSheetItem>
          {collections.map((collection) => <BottomSheetItem key={collection.key} contentMode="raw" disabled={busy} onPress={() => void uploadTo(collection.key)} size="md" variant="ghost"><View style={styles.sheetItem}><FolderIcon size="md" /><Text style={styles.sheetText}>{collection.name}</Text></View></BottomSheetItem>)}
          <BottomSheetItem contentMode="raw" onPress={() => openSheet("newCollection")} size="md" variant="ghost"><View style={styles.sheetItem}><PlusIcon size="md" /><Text style={styles.sheetText}>New collection</Text></View></BottomSheetItem>
        </> : null}
        {activeSheet === "newCollection" ? <View style={styles.form}>
          <TextInput autoFocus accessibilityLabel="Collection name" editable={!busy} onChangeText={setNewCollectionName} placeholder="Collection name" returnKeyType="done" style={styles.formInput} value={newCollectionName} />
          <Button disabled={busy || !newCollectionName.trim()} loading={busy} onPress={() => void createCollectionAndUpload()} size="md" variant="primary">{pendingFiles.length ? "Create and upload" : "Create collection"}</Button>
        </View> : null}
        {activeSheet === "image" && selectedImage ? <View style={styles.detail}>
          <Image source={selectedImage.url} contentFit="contain" style={styles.detailImage} />
          <Text style={styles.detailCaption}>{selectedImage.caption || "This image is still being described."}</Text>
          <Button disabled={busy} loading={busy} onPress={() => void findSimilar()} size="md" variant="secondary">Find similar images</Button>
          {similarImages.length ? <View style={styles.grid}>{similarImages.map((image) => <Button key={image.key} accessibilityLabel={image.caption || image.filename} contentMode="raw" onPress={() => void showImage(image)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost"><Image source={image.url} contentFit="cover" style={styles.image} /></Button>)}</View> : null}
        </View> : null}
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 54, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: spacing.md },
  intro: { paddingTop: 28, paddingBottom: 24 },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.label },
  heading: { marginTop: 10, color: palette.silver50, fontFamily: fonts.light, fontSize: 34, letterSpacing: -1.2 },
  subheading: { marginTop: 9, maxWidth: 330, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  searchBar: { height: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panel },
  searchInput: { flex: 1, borderWidth: 0, backgroundColor: "transparent", paddingHorizontal: 0, fontSize: 13 },
  status: { paddingTop: 12, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  section: { marginTop: 30 },
  sectionHeader: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: palette.silver300, fontFamily: fonts.medium, fontSize: 10, letterSpacing: tracking.micro },
  count: { color: palette.silver700, fontFamily: fonts.medium, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  collectionCard: { alignItems: "stretch", paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  collectionCover: { width: "100%", borderRadius: radii.md, backgroundColor: palette.panelRaised },
  emptyCover: { width: "100%", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.md, backgroundColor: palette.panel },
  collectionName: { marginTop: 8, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  collectionCount: { marginTop: 2, color: palette.silver500, fontFamily: fonts.regular, fontSize: 10 },
  imageButton: { paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden", borderRadius: 3, backgroundColor: palette.panelRaised },
  image: { width: "100%", height: "100%" },
  emptyText: { paddingVertical: 28, color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
  composerWrap: { position: "absolute", left: spacing.md, right: spacing.md, gap: 6 },
  aiResponse: { paddingHorizontal: 14, paddingVertical: 9, color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, borderRadius: radii.md, backgroundColor: palette.panel },
  composer: { minHeight: 56, padding: 7, paddingLeft: 14, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: 999, backgroundColor: palette.obsidian850 },
  composerInput: { flex: 1, minHeight: 38, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 12 },
  sheetText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15 },
  form: { gap: 14 },
  formInput: { minHeight: 48 },
  detail: { gap: 16 },
  detailImage: { width: "100%", height: 360, borderRadius: radii.lg, backgroundColor: palette.voidBlack },
  detailCaption: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
});
