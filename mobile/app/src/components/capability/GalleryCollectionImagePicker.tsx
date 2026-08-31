import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { CheckIcon, CloseIcon, FilterIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { isNearScrollEnd } from "@vorinthex/shared/lib/pagination";

import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { deleteContentSearchHistory, getContentContext, type ContentSearchHistoryItem } from "@/lib/content-client";
import { fetchGalleryOverview, searchGalleryImages, type GalleryCollection, type GalleryImage } from "@/lib/gallery-client";
import { appendGalleryCollectionPickerPage, GALLERY_COLLECTION_PICKER_COLUMNS, GALLERY_COLLECTION_PICKER_HISTORY_DEBOUNCE_MS, GALLERY_COLLECTION_PICKER_MAX_SELECTION, GALLERY_COLLECTION_PICKER_RESULT_DEBOUNCE_MS, GALLERY_COLLECTION_PICKER_SKELETON_COUNT, toggleGalleryCollectionImageSelection } from "@/lib/gallery-collection-image-picker";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { filterByHiddenView, listUserHiddens, type HiddenViewFilters } from "@/lib/user-hidden-client";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const IMAGE_GAP = 5;
const RESULT_LIMIT = 50;
const EMPTY_SELECTION: string[] = [];
const EMPTY_IMAGES: GalleryImage[] = [];

type GalleryCollectionImagePickerProps = {
  actionLabel?: string;
  collection?: GalleryCollection;
  description: string;
  initialSelectedKeys?: string[];
  initialSelectedImages?: GalleryImage[];
  maxSelection?: number;
  minSelection?: number;
  mode: "single" | "multiple";
  onClose: () => void;
  onSelect: (imageKeys: string[], images: GalleryImage[]) => void;
  open: boolean;
  title: string;
};

export function GalleryCollectionImagePicker({ actionLabel = "Create", collection, description, initialSelectedImages = EMPTY_IMAGES, initialSelectedKeys = EMPTY_SELECTION, maxSelection, minSelection, mode, onClose, onSelect, open, title }: GalleryCollectionImagePickerProps) {
  const queryClient = useQueryClient();
  const context = getContentContext();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [gridWidth, setGridWidth] = useState(0);
  const [filters, setFilters] = useState<HiddenViewFilters>({ favoritesOnly: false, showHidden: false });
  const [filterOpen, setFilterOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const searchGeneration = useRef(0);
  const searchController = useRef<AbortController | undefined>(undefined);
  const selectedImages = useRef(new Map<string, GalleryImage>());
  const loadingMoreRef = useRef(false);
  const historyGeneration = useRef(0);
  const hiddensQuery = useQuery({ queryKey: ["gallery-collection-picker-hiddens", context.userKey], queryFn: listUserHiddens, enabled: open, staleTime: 0 });
  const visibleImages = filterByHiddenView(images, hiddensQuery.data ?? [], "image", filters);
  const imageSize = Math.floor(((gridWidth || 320) - IMAGE_GAP * (GALLERY_COLLECTION_PICKER_COLUMNS - 1)) / GALLERY_COLLECTION_PICKER_COLUMNS);
  const collectionKey = collection?.key;

  async function load(value: string) {
    const generation = ++searchGeneration.current;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const result = value
        ? { ...await searchGalleryImages({ query: value, ...(collectionKey ? { collectionKey } : {}), recordHistory: false, limit: RESULT_LIMIT, minimumScore: -1 }, controller.signal), nextCursor: null }
        : await fetchGalleryOverview(collectionKey, undefined, RESULT_LIMIT, undefined, controller.signal);
      if (generation === searchGeneration.current && !controller.signal.aborted) {
        setImages(result.images);
        result.images.forEach((image) => { if (selectedKeys.includes(image.key)) selectedImages.current.set(image.key, image); });
        setNextCursor(result.nextCursor);
      }
    } catch (cause) {
      if (generation === searchGeneration.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Images could not be loaded.");
    } finally {
      if (generation === searchGeneration.current) setLoading(false);
    }
  }
  const loadLatest = useEffectEvent((value: string) => load(value));

  async function loadMore() {
    if (!nextCursor || query.trim() || loading || loadingMoreRef.current) return;
    const generation = searchGeneration.current;
    const cursor = nextCursor;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchGalleryOverview(collectionKey, cursor, RESULT_LIMIT);
      if (generation !== searchGeneration.current || !open) return;
      setImages((current) => appendGalleryCollectionPickerPage(current, page.images));
      page.images.forEach((image) => { if (selectedKeys.includes(image.key)) selectedImages.current.set(image.key, image); });
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (generation === searchGeneration.current) setError(cause instanceof Error ? cause.message : "Images could not be loaded.");
    } finally {
      loadingMoreRef.current = false;
      if (generation === searchGeneration.current) setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    const timer = setTimeout(() => void loadLatest(value), value ? GALLERY_COLLECTION_PICKER_RESULT_DEBOUNCE_MS : 0);
    return () => { clearTimeout(timer); searchGeneration.current += 1; searchController.current?.abort(); };
  }, [collectionKey, open, query]);

  useEffect(() => {
    const value = query.trim();
    if (!open || !value) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchGalleryImages({ query: value, ...(collectionKey ? { collectionKey } : {}), recordHistory: true, limit: RESULT_LIMIT, minimumScore: -1 }, controller.signal).catch(() => undefined);
    }, GALLERY_COLLECTION_PICKER_HISTORY_DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [collectionKey, open, query]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      selectedImages.current = new Map(initialSelectedImages.map((image) => [image.key, image]));
      setSelectedKeys(initialSelectedKeys.slice(0, mode === "single" ? 1 : (maxSelection ?? GALLERY_COLLECTION_PICKER_MAX_SELECTION)));
    }, 0);
    return () => clearTimeout(timer);
  }, [initialSelectedImages, initialSelectedKeys, maxSelection, mode, open]);

  useEffect(() => {
    if (open) return;
    searchGeneration.current += 1;
    searchController.current?.abort();
    historyGeneration.current += 1;
    const timer = setTimeout(() => {
      setSelectedKeys([]);
      selectedImages.current.clear();
      setQuery("");
      setFilterOpen(false);
      setHistoryOpen(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  function choose(imageKey: string) {
    const image = images.find(({ key }) => key === imageKey);
    if (image) selectedImages.current.set(imageKey, image);
    if (mode === "single") { onSelect([imageKey], image ? [image] : []); return; }
    setSelectedKeys((current) => toggleGalleryCollectionImageSelection(current, imageKey, maxSelection));
  }

  function changeQuery(value: string) {
    searchGeneration.current += 1;
    searchController.current?.abort();
    setLoading(true);
    setError(undefined);
    setImages([]);
    setQuery(value);
  }

  async function openSearchHistory() {
    const generation = ++historyGeneration.current;
    const key = userSearchHistoryQueryKey(context.userKey ?? "");
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []);
    setHistoryError(undefined);
    setHistoryLoading(!cached || invalidated);
    setFilterOpen(false);
    setHistoryOpen(true);
    if (cached && !invalidated) return;
    try {
      const loaded = await getUserSearchHistory(queryClient, context);
      if (generation === historyGeneration.current) setHistory(loaded);
    } catch (cause) {
      if (generation === historyGeneration.current) setHistoryError(cause instanceof Error ? cause.message : "Search history could not be loaded.");
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  }

  function useHistoryQuery(item: ContentSearchHistoryItem) {
    const promoted = promoteCachedUserSearchHistory(queryClient, context, item);
    setHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    setHistoryOpen(false);
    changeQuery(item.query);
  }

  async function removeHistoryQuery(item: ContentSearchHistoryItem) {
    if (removingHistoryQuery) return;
    const previous = removeCachedUserSearchHistory(queryClient, context, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (cause) {
      queryClient.setQueryData(userSearchHistoryQueryKey(context.userKey ?? ""), previous);
      setHistory(previous);
      setHistoryError(cause instanceof Error ? cause.message : "The search could not be removed.");
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  }

  const footer = mode === "multiple" ? <><Button disabled={selectedKeys.length < (minSelection ?? 2)} onPress={() => onSelect(selectedKeys, selectedKeys.flatMap((key) => { const image = selectedImages.current.get(key) ?? images.find((candidate) => candidate.key === key); return image ? [image] : []; }))} size="md" variant="primary">{actionLabel}</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></> : <Button onPress={onClose} size="md" variant="secondary">Close</Button>;

  return <>
    <BottomSheet description={description} footer={footer} height="full" onOpenChange={(next) => { if (!next && !filterOpen && !historyOpen) onClose(); }} open={open} title={title}>
      <View style={styles.actions}><View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search collection images" onChangeText={changeQuery} placeholder="Search..." returnKeyType="search" style={styles.searchInput} value={query} />{query.trim() ? <ButtonSizeProvider overrideParent size="xs"><Button accessibilityLabel="Clear image search" contentMode="raw" iconOnly onPress={() => changeQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button></ButtonSizeProvider> : null}</View><Button accessibilityLabel="Filter collection images" contentMode="raw" onPress={() => setFilterOpen(true)} size="md" style={styles.filterButton} variant="icon"><FilterIcon size="sm" variant={filters.favoritesOnly || filters.showHidden ? "accent" : "default"} /></Button></View>
      {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text><Button onPress={() => void load(query.trim())} size="md" variant="secondary">Retry</Button></View> : null}
      <ScrollView accessibilityLabel="Collection image results" accessibilityState={{ busy: loading || loadingMore }} contentContainerStyle={[styles.results, !loading && !error && visibleImages.length === 0 && styles.emptyResults]} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (isNearScrollEnd({ offset: nativeEvent.contentOffset.y, viewport: nativeEvent.layoutMeasurement.height, content: nativeEvent.contentSize.height })) void loadMore(); }} scrollEventThrottle={120} showsVerticalScrollIndicator={false}>
        <View onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.grid}>{loading ? Array.from({ length: GALLERY_COLLECTION_PICKER_SKELETON_COUNT }, (_, index) => <Skeleton key={index} style={[styles.skeleton, { width: imageSize, height: imageSize }]} />) : visibleImages.map((image) => { const selected = selectedKeys.includes(image.key); return <Button accessibilityLabel={`${selected ? "Deselect" : "Select"} ${image.caption || image.filename}`} accessibilityState={{ selected }} contentMode="raw" key={image.key} onPress={() => choose(image.key)} size="md" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost"><View style={[styles.imageFrame, selected && styles.imageFrameSelected]}><Image contentFit="cover" source={image.url} style={styles.image} transition={150} />{selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>; })}{loadingMore ? Array.from({ length: GALLERY_COLLECTION_PICKER_SKELETON_COUNT }, (_, index) => <Skeleton key={`more-${index}`} style={[styles.skeleton, { width: imageSize, height: imageSize }]} />) : null}</View>
        {!loading && !error && visibleImages.length === 0 ? <Text style={styles.empty}>No images found.</Text> : null}
      </ScrollView>
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={setFilterOpen} open={filterOpen} title=""><View style={styles.filterPanel}><View style={styles.filterRow}><Switch accessibilityLabel="Show only favorite collection images" checked={filters.favoritesOnly} onCheckedChange={(checked) => { setFilters((current) => ({ ...current, favoritesOnly: checked })); setFilterOpen(false); }} /><Text style={styles.filterLabel}>Favorites</Text></View><View style={styles.filterRow}><Switch accessibilityLabel="Show hidden collection images" checked={filters.showHidden} onCheckedChange={(checked) => { setFilters((current) => ({ ...current, showHidden: checked })); setFilterOpen(false); }} /><Text style={styles.filterLabel}>Show hidden</Text></View><Button onPress={() => void openSearchHistory()} size="md" variant="secondary">Search history</Button></View></BottomSheet>
    <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => setHistoryOpen(false)} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={historyOpen} removingQuery={removingHistoryQuery} />
  </>;
}

const styles = StyleSheet.create({
  actions: { minHeight: 52, marginTop: -spacing.xs, flexDirection: "row", alignItems: "center", gap: 8 },
  search: { minHeight: 44, flex: 1, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  filterButton: { width: 44, height: 44 },
  results: { flexGrow: 1, paddingVertical: spacing.md },
  emptyResults: { justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: IMAGE_GAP },
  imageButton: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: "transparent" },
  imageFrame: { width: "100%", height: "100%", overflow: "hidden", borderWidth: 1, borderColor: "transparent", borderRadius: radii.md, backgroundColor: palette.panelRaised },
  imageFrameSelected: { borderColor: palette.silver50, borderWidth: 2 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  image: { width: "100%", height: "100%" },
  skeleton: { borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  empty: { width: "100%", color: palette.silver500, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  error: { marginTop: spacing.sm, padding: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  errorText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.regular, fontSize: 12 },
  filterPanel: { gap: 6 },
  filterRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  filterLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
});
