import { useEffect, useEffectEvent, useRef, useState, type ComponentRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button, ButtonSizeProvider } from "@vorinthex/shared/ui/button";
import { CheckIcon, CloseIcon, FileIcon, FilterIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { deleteContentSearchHistory, listContentDocumentsAtLocation, searchContentMatches, type ContentContext, type ContentDocument, type ContentSearchHistoryItem } from "@/lib/content-client";
import { attachmentIdentity, createAttachmentSearchOwner, isSelectableEmailDocument, toggleEmailAttachment } from "@/lib/email-attachment-picker";
import type { EmailAttachmentRef } from "@/lib/email-client";
import { fetchGalleryOverview, isManagedGalleryImage, searchGalleryImages, type GalleryImage } from "@/lib/gallery-client";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { filterByHiddenView, listUserHiddens, type HiddenViewFilters } from "@/lib/user-hidden-client";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type PickerTab = "archive" | "gallery";
export type EmailAttachmentLabels = Record<string, string>;
export type EmailAttachmentImageUrls = Record<string, string>;

const MAX_ATTACHMENTS = 20;
const MAX_VISIBLE_RESULTS = 10;
const GALLERY_CANDIDATE_LIMIT = 50;
const IMAGE_COLUMNS = 4;
const IMAGE_GAP = 5;
const SHEET_INPUT_FOCUS_DELAY_MS = 300;
const SHEET_TRANSITION_DELAY_MS = 180;

type EmailAttachmentPickerProps = {
  context: ContentContext;
  contextKey: string;
  imageUrls?: EmailAttachmentImageUrls;
  labels?: EmailAttachmentLabels;
  onClose: () => void;
  onDone: (selection: EmailAttachmentRef[], labels: EmailAttachmentLabels, imageUrls: EmailAttachmentImageUrls) => void;
  open: boolean;
  selection: EmailAttachmentRef[];
};

export function EmailAttachmentPicker({ context, contextKey, imageUrls: selectedImageUrls, labels: selectedLabels, open, selection, onClose, onDone }: EmailAttachmentPickerProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PickerTab>("archive");
  const [working, setWorking] = useState<EmailAttachmentRef[]>(() => selection);
  const [labels, setLabels] = useState<EmailAttachmentLabels>(() => selectedLabels ?? {});
  const [imageUrls, setImageUrls] = useState<EmailAttachmentImageUrls>(() => selectedImageUrls ?? {});
  const [documents, setDocuments] = useState<ContentDocument[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectionNotice, setSelectionNotice] = useState<string>();
  const [gridWidth, setGridWidth] = useState(0);
  const [filters, setFilters] = useState<HiddenViewFilters>({ favoritesOnly: false, showHidden: false });
  const [filterOpen, setFilterOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [searchOwner] = useState(createAttachmentSearchOwner);
  const historyGeneration = useRef(0);
  const searchInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const hiddensQuery = useQuery({ queryKey: ["email-attachment-hiddens", contextKey], queryFn: listUserHiddens, enabled: open, staleTime: 0 });
  const hiddens = hiddensQuery.data ?? [];
  const visibleDocuments = filterByHiddenView(documents, hiddens, "document", filters);
  const visibleImages = filterByHiddenView(images, hiddens, "image", filters);
  const renderedDocuments = visibleDocuments.slice(0, MAX_VISIBLE_RESULTS);
  const renderedImages = visibleImages.slice(0, MAX_VISIBLE_RESULTS);
  const imageSize = Math.floor(((gridWidth || 320) - IMAGE_GAP * (IMAGE_COLUMNS - 1)) / IMAGE_COLUMNS);

  function rememberLabels(nextDocuments: ContentDocument[], nextImages: GalleryImage[]) {
    setLabels((current) => {
      const next = { ...current };
      nextDocuments.forEach((document) => { next[`document:${document.key}`] = document.name; });
      nextImages.forEach((image) => { next[`image:${image.key}`] = image.caption || image.filename; });
      return next;
    });
    setImageUrls((current) => {
      const next = { ...current };
      nextImages.forEach((image) => { next[`image:${image.key}`] = image.url; });
      return next;
    });
  }
  async function load(targetTab: PickerTab, searchValue: string) {
    const operation = searchOwner.begin();
    const value = searchValue.trim();
    setLoading(true);
    setError(undefined);
    if (targetTab === "archive") setDocuments([]);
    else setImages([]);
    try {
      if (targetTab === "archive") {
        const result = value
          ? (await searchContentMatches(value, operation.signal, undefined, false, { limit: MAX_VISIBLE_RESULTS, minimumScore: -1 })).documents.filter(isSelectableEmailDocument).map((document) => ({ key: document.documentKey, name: document.name, extension: document.extension, folderKey: document.folderKey, isFavorite: document.isFavorite, updatedAt: "" }))
          : (await listContentDocumentsAtLocation(undefined, operation.signal)).filter(isSelectableEmailDocument);
        if (searchOwner.isCurrent(operation.generation)) {
          setDocuments(result);
          rememberLabels(result, []);
        }
      } else {
        const result = (value
          ? (await searchGalleryImages({ query: value, recordHistory: false, limit: GALLERY_CANDIDATE_LIMIT, minimumScore: -1 }, operation.signal)).images
          : (await fetchGalleryOverview(undefined, undefined, GALLERY_CANDIDATE_LIMIT, undefined, operation.signal)).images).filter((image) => !isManagedGalleryImage(image));
        if (searchOwner.isCurrent(operation.generation)) {
          setImages(result);
          rememberLabels([], result);
        }
      }
    } catch (cause) {
      if (!operation.signal.aborted && searchOwner.isCurrent(operation.generation)) {
        if (targetTab === "archive") setDocuments([]);
        else setImages([]);
        setError(cause instanceof Error ? cause.message : value ? "Attachment search could not be completed." : "Attachments could not be loaded.");
      }
    } finally {
      if (searchOwner.isCurrent(operation.generation)) setLoading(false);
    }
  }
  const loadLatest = useEffectEvent((targetTab: PickerTab, searchValue: string) => load(targetTab, searchValue));

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void loadLatest(tab, query), query.trim() ? 300 : 0);
    return () => {
      clearTimeout(timer);
      searchOwner.invalidate();
    };
  }, [contextKey, open, query, searchOwner, tab]);
  useEffect(() => {
    const value = query.trim();
    if (!open || !value) return;
    const controller = new AbortController();
    const historyTimer = setTimeout(() => {
      const request = tab === "archive"
        ? searchContentMatches(value, controller.signal, undefined, true, { limit: MAX_VISIBLE_RESULTS, minimumScore: -1 })
        : searchGalleryImages({ query: value, recordHistory: true, limit: GALLERY_CANDIDATE_LIMIT, minimumScore: -1 }, controller.signal);
      void request.catch(() => undefined);
    }, 800);
    return () => { clearTimeout(historyTimer); controller.abort(); };
  }, [contextKey, open, query, tab]);
  useEffect(() => {
    if (!open || filterOpen || historyOpen) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), SHEET_INPUT_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filterOpen, historyOpen, open]);
  useEffect(() => {
    if (!open) return;
    const imageRefs = selection.filter((ref): ref is EmailAttachmentRef & { type: "image" } => ref.type === "image");
    if (!imageRefs.length) return;
    const controller = new AbortController();
    void Promise.allSettled(imageRefs.map(async (ref) => {
      const image = (await searchGalleryImages({ imageKey: ref.key }, controller.signal)).images.find(({ key }) => key === ref.key);
      if (!image || controller.signal.aborted) return;
      setImageUrls((current) => ({ ...current, [`image:${ref.key}`]: image.url }));
      setLabels((current) => ({ ...current, [`image:${ref.key}`]: image.caption || image.filename }));
    }));
    return () => controller.abort();
  }, [contextKey, open, selection]);

  function isSelected(ref: EmailAttachmentRef) { return working.some((item) => attachmentIdentity(item) === attachmentIdentity(ref)); }
  function toggle(ref: EmailAttachmentRef) {
    if (!isSelected(ref) && working.length >= MAX_ATTACHMENTS) {
      setSelectionNotice(`You can attach up to ${MAX_ATTACHMENTS} items.`);
      return;
    }
    setSelectionNotice(undefined);
    setWorking((current) => toggleEmailAttachment(current, ref));
  }
  function changeTab(next: PickerTab) {
    searchOwner.invalidate();
    setTab(next);
    setQuery("");
    setError(undefined);
  }
  function changeQuery(next: string) {
    searchOwner.invalidate();
    if (tab === "archive") setDocuments([]);
    else setImages([]);
    setQuery(next);
  }
  function closePicker() {
    searchOwner.invalidate();
    historyGeneration.current += 1;
    setFilterOpen(false);
    setHistoryOpen(false);
    onClose();
  }
  async function openSearchHistory() {
    const generation = ++historyGeneration.current;
    const key = userSearchHistoryQueryKey(context.userKey ?? "");
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []);
    setHistoryError(undefined);
    setHistoryLoading(!cached || invalidated);
    setRemovingHistoryQuery(undefined);
    setFilterOpen(false);
    await new Promise((resolve) => setTimeout(resolve, SHEET_TRANSITION_DELAY_MS));
    if (generation !== historyGeneration.current) return;
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
    setHistoryError(undefined);
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

  return <>
    <BottomSheet
      footer={<View style={styles.footer}><Button onPress={() => { searchOwner.invalidate(); onDone(working, labels, imageUrls); }} size="md" variant="primary">Done</Button><Button onPress={closePicker} size="md" variant="secondary">Close</Button></View>}
      height="full"
      onOpenChange={(next) => { if (!next && !filterOpen && !historyOpen) closePicker(); }}
      open={open}
      title="Attachments"
    >
      <View style={styles.rootActions}><View style={styles.rootSearch}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel={`Search ${tab}`} onChangeText={changeQuery} onSubmitEditing={() => void load(tab, query)} placeholder="Search..." ref={searchInputRef} returnKeyType="search" style={styles.rootSearchInput} value={query} />{query.trim() ? <ButtonSizeProvider overrideParent size="xs"><Button accessibilityLabel="Clear attachment search" contentMode="raw" iconOnly onPress={() => changeQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button></ButtonSizeProvider> : null}</View><Button accessibilityLabel="Filter attachments" contentMode="raw" onPress={() => setFilterOpen(true)} size="md" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filters.favoritesOnly || filters.showHidden ? "accent" : "default"} /></Button></View>
      <Tabs accessibilityLabel="Attachment sources" accessibilityRole="tablist" style={styles.folderTabs}>
        <Button accessibilityRole="tab" accessibilityState={{ selected: tab === "archive" }} onPress={() => changeTab("archive")} style={styles.folderTab} variant={tab === "archive" ? "secondary" : "ghost"}>Archive</Button>
        <Button accessibilityRole="tab" accessibilityState={{ selected: tab === "gallery" }} onPress={() => changeTab("gallery")} style={styles.folderTab} variant={tab === "gallery" ? "secondary" : "ghost"}>Gallery</Button>
      </Tabs>
      {selectionNotice ? <Text accessibilityLiveRegion="assertive" style={styles.notice}>{selectionNotice}</Text> : null}
      {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text><Button onPress={() => void load(tab, query)} size="md" variant="secondary">Retry</Button></View> : null}
      <ScrollView accessibilityLabel={`${tab} attachment results`} accessibilityLiveRegion="polite" accessibilityState={{ busy: loading }} contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {loading ? <View accessibilityLabel="Loading attachment results" accessibilityRole="progressbar" style={tab === "gallery" ? styles.imageGrid : styles.rootDocuments}>{Array.from({ length: tab === "gallery" ? 4 : 3 }, (_, index) => <Skeleton key={index} style={tab === "gallery" ? [styles.imageSkeleton, { width: imageSize, height: imageSize }] : styles.documentSkeleton} />)}</View> : tab === "archive" ? <View style={styles.rootDocuments}>{renderedDocuments.map((document) => {
          const ref = { type: "document" as const, key: document.key }; const active = isSelected(ref);
          return <Button accessibilityLabel={`${active ? "Deselect" : "Select"} ${document.name}`} accessibilityState={{ selected: active }} contentMode="raw" key={document.key} onPress={() => toggle(ref)} size="md" style={[styles.documentButton, active && styles.selectedDocumentItem]} variant={active ? "ghost" : "secondary"}><FileIcon size="sm" /><Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text></Button>;
        })}</View> : <View onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.imageGrid}>{renderedImages.map((image) => {
          const ref = { type: "image" as const, key: image.key }; const active = isSelected(ref);
          return <Button accessibilityLabel={`${active ? "Deselect" : "Select"} ${image.caption || image.filename}`} accessibilityState={{ selected: active }} contentMode="raw" key={image.key} onPress={() => toggle(ref)} size="xl" style={[styles.imageButton, { width: imageSize, height: imageSize }]} variant="ghost"><View style={[styles.imageFrame, active && styles.imageFrameSelected]}><Image accessibilityLabel={image.caption || image.filename} contentFit="cover" source={image.url} style={styles.image} transition={150} />{active ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View></Button>;
        })}</View>}
        {!loading && !error && (tab === "archive" ? visibleDocuments.length === 0 : visibleImages.length === 0) ? <Text style={styles.empty}>No {tab === "archive" ? "documents" : "images"} found.</Text> : null}
      </ScrollView>
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(next) => { if (!next) setFilterOpen(false); }} open={filterOpen} title="">
      <View style={styles.filterPanel}><View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Show only favorite attachments" checked={filters.favoritesOnly} onCheckedChange={(checked) => { setFilters((current) => ({ ...current, favoritesOnly: checked })); setFilterOpen(false); }} /><Text style={styles.favoriteSwitchLabel}>Favorites</Text></View><View style={styles.favoriteSwitchRow}><Switch accessibilityLabel="Show hidden attachments" checked={filters.showHidden} onCheckedChange={(checked) => { setFilters((current) => ({ ...current, showHidden: checked })); setFilterOpen(false); }} /><Text style={styles.favoriteSwitchLabel}>Show hidden</Text></View><Button onPress={() => void openSearchHistory()} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button></View>
    </BottomSheet>
    <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => setHistoryOpen(false)} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={historyOpen} removingQuery={removingHistoryQuery} />
  </>;
}

const styles = StyleSheet.create({
  rootActions: { minHeight: 52, marginTop: -spacing.xs, flexDirection: "row", alignItems: "center", gap: 8 },
  rootSearch: { minHeight: 44, flex: 1, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  searchHistoryButton: { width: 44, height: 44 },
  folderTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  folderTab: { flex: 1 },
  notice: { marginTop: spacing.xs, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  results: { flexGrow: 1, paddingVertical: spacing.md },
  rootDocuments: { gap: 7 },
  documentButton: { width: "100%", justifyContent: "flex-start", paddingHorizontal: 14 },
  selectedDocumentItem: { borderColor: palette.silver50, borderWidth: 1, backgroundColor: "transparent" },
  documentButtonLabel: { flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "left" },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: IMAGE_GAP },
  imageButton: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: "transparent" },
  imageFrame: { width: "100%", height: "100%", overflow: "hidden", borderWidth: 1, borderColor: "transparent", borderRadius: radii.md, backgroundColor: palette.panelRaised },
  imageFrameSelected: { borderColor: palette.silver50, borderWidth: 2 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  image: { width: "100%", height: "100%" },
  imageSkeleton: { borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  documentSkeleton: { width: "100%", height: 38, borderRadius: 999 },
  empty: { paddingVertical: 60, color: palette.silver700, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  error: { marginTop: spacing.sm, padding: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  errorText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.regular, fontSize: 12 },
  footer: { gap: spacing.sm },
  filterPanel: { gap: 6 },
  favoriteSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  searchHistoryOption: { backgroundColor: palette.page },
});
