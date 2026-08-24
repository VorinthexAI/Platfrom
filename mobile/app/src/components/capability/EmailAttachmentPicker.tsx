import { useEffect, useEffectEvent, useRef, useState, type ComponentRef } from "react";
import { Image } from "expo-image";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CheckIcon, CloseIcon, FileIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { listContentDocumentsAtLocation, searchContentMatches, type ContentDocument } from "@/lib/content-client";
import { attachmentIdentity, createAttachmentSearchOwner, isSelectableEmailDocument, toggleEmailAttachment } from "@/lib/email-attachment-picker";
import type { EmailAttachmentRef } from "@/lib/email-client";
import { fetchGalleryOverview, isManagedGalleryImage, searchGalleryImages, type GalleryImage } from "@/lib/gallery-client";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type PickerTab = "archive" | "gallery";
const MAX_ATTACHMENTS = 20;
const SHEET_INPUT_FOCUS_DELAY_MS = 300;

export function EmailAttachmentPicker({ contextKey, open, selection, onClose, onDone }: { contextKey: string; open: boolean; selection: EmailAttachmentRef[]; onClose: () => void; onDone: (selection: EmailAttachmentRef[]) => void }) {
  const [tab, setTab] = useState<PickerTab>("archive");
  const [working, setWorking] = useState<EmailAttachmentRef[]>(() => selection);
  const [documents, setDocuments] = useState<ContentDocument[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectionNotice, setSelectionNotice] = useState<string>();
  const [gridWidth, setGridWidth] = useState(0);
  const [searchOwner] = useState(createAttachmentSearchOwner);
  const searchInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const imageSize = Math.floor(((gridWidth || 320) - spacing.sm * 2) / 3);

  async function load(targetTab: PickerTab, searchValue: string) {
    const operation = searchOwner.begin();
    const value = searchValue.trim();
    setLoading(true);
    setError(undefined);
    try {
      if (targetTab === "archive") {
        const result = value
          ? (await searchContentMatches(value, operation.signal, undefined, false)).documents.filter(isSelectableEmailDocument).map((document) => ({ key: document.documentKey, name: document.name, extension: document.extension, folderKey: document.folderKey, isFavorite: document.isFavorite, updatedAt: "" }))
          : (await listContentDocumentsAtLocation(undefined, operation.signal)).filter(isSelectableEmailDocument);
        if (searchOwner.isCurrent(operation.generation)) setDocuments(result);
      } else {
        const result = (value
          ? (await searchGalleryImages({ query: value, recordHistory: false, limit: 100 }, operation.signal)).images
          : (await fetchGalleryOverview(undefined, undefined, 100, undefined, operation.signal)).images).filter((image) => !isManagedGalleryImage(image));
        if (searchOwner.isCurrent(operation.generation)) setImages(result);
      }
    } catch (cause) {
      if (!operation.signal.aborted && searchOwner.isCurrent(operation.generation)) setError(cause instanceof Error ? cause.message : value ? "Attachment search could not be completed." : "Attachments could not be loaded.");
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
        ? searchContentMatches(value, controller.signal, undefined, true)
        : searchGalleryImages({ query: value, recordHistory: true, limit: 100 }, controller.signal);
      void request.catch(() => undefined);
    }, 800);
    return () => { clearTimeout(historyTimer); controller.abort(); };
  }, [contextKey, open, query, tab]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), SHEET_INPUT_FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open]);

  function isSelected(ref: EmailAttachmentRef) { return working.some((item) => attachmentIdentity(item) === attachmentIdentity(ref)); }
  function toggle(ref: EmailAttachmentRef) {
    if (!isSelected(ref) && working.length >= MAX_ATTACHMENTS) {
      setSelectionNotice(`You can attach up to ${MAX_ATTACHMENTS} items.`);
      return;
    }
    setSelectionNotice(undefined);
    setWorking((current) => toggleEmailAttachment(current, ref));
  }
  function labelFor(ref: EmailAttachmentRef) {
    if (ref.type === "document") return documents.find(({ key }) => key === ref.key)?.name ?? `Archive document ${ref.key}`;
    const image = images.find(({ key }) => key === ref.key);
    return image?.caption || image?.filename || `Gallery image ${ref.key}`;
  }
  function changeTab(next: PickerTab) {
    searchOwner.invalidate();
    setTab(next);
    setQuery("");
    setError(undefined);
  }
  function changeQuery(next: string) {
    searchOwner.invalidate();
    setQuery(next);
  }
  function closePicker() {
    searchOwner.invalidate();
    onClose();
  }

  return <BottomSheet
    description="Choose Archive documents or Gallery images. Selection stays while you search."
    footer={<View style={styles.footer}><Text accessibilityLiveRegion="polite" style={styles.count}>{working.length} of {MAX_ATTACHMENTS} selected</Text><Button onPress={() => { searchOwner.invalidate(); onDone(working); }} size="md" style={styles.footerAction} variant="primary">Done</Button><Button onPress={closePicker} size="md" style={styles.footerAction} variant="secondary">Close</Button></View>}
    height="full"
    onOpenChange={(next) => { if (!next) closePicker(); }}
    open={open}
    title="Add attachments"
  >
    <Tabs accessibilityLabel="Attachment sources" accessibilityRole="tablist" style={styles.tabs}>
      <Button accessibilityRole="tab" accessibilityState={{ selected: tab === "archive" }} onPress={() => changeTab("archive")} size="md" style={styles.tab} variant={tab === "archive" ? "secondary" : "ghost"}>Archive</Button>
      <Button accessibilityRole="tab" accessibilityState={{ selected: tab === "gallery" }} onPress={() => changeTab("gallery")} size="md" style={styles.tab} variant={tab === "gallery" ? "secondary" : "ghost"}>Gallery</Button>
    </Tabs>
    <View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel={`Search ${tab}`} onChangeText={changeQuery} onSubmitEditing={() => void load(tab, query)} placeholder={tab === "archive" ? "Search files and documents" : "Search images"} ref={searchInputRef} returnKeyType="search" style={styles.searchInput} value={query} />{query.trim() ? <Button accessibilityLabel="Clear attachment search" contentMode="raw" iconOnly onPress={() => changeQuery("")} size="md" style={styles.sheetSearchClear} variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
    {working.length ? <ScrollView accessibilityLabel={`Selected attachments, ${working.length} items`} accessibilityRole="list" contentContainerStyle={styles.selectedListContent} nestedScrollEnabled showsVerticalScrollIndicator style={styles.selectedList}>{working.map((ref) => <View key={attachmentIdentity(ref)} style={styles.selectedPill}><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={styles.selectedText}>{labelFor(ref)}</Text><Button accessibilityLabel={`Remove ${labelFor(ref)}`} contentMode="raw" iconOnly onPress={() => toggle(ref)} size="md" style={styles.selectedRemove} variant="secondary"><CloseIcon size="sm" /></Button></View>)}</ScrollView> : null}
    {selectionNotice ? <Text accessibilityLiveRegion="assertive" style={styles.notice}>{selectionNotice}</Text> : null}
    {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text><Button onPress={() => void load(tab, query)} size="md" variant="secondary">Retry</Button></View> : null}
    <ScrollView accessibilityLabel={`${tab} attachment results`} accessibilityLiveRegion="polite" accessibilityState={{ busy: loading }} contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {loading ? <View accessibilityLabel="Loading attachment results" accessibilityRole="progressbar" style={tab === "gallery" ? styles.imageGrid : styles.documentResults}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} style={tab === "gallery" ? [styles.imageSkeleton, { width: imageSize, height: imageSize }] : styles.documentSkeleton} />)}</View> : tab === "archive" ? <View style={styles.documentResults}>{documents.map((document) => {
        const ref = { type: "document" as const, key: document.key }; const active = isSelected(ref);
        return <Button accessibilityLabel={`${active ? "Deselect" : "Select"} ${document.name}`} accessibilityState={{ selected: active }} contentMode="raw" key={document.key} onPress={() => toggle(ref)} size="md" style={[styles.document, active && styles.selected]} variant="secondary"><FileIcon size="md" variant={active ? "accent" : "muted"} /><View style={styles.documentCopy}><Text numberOfLines={1} style={styles.documentName}>{document.name}</Text><Text style={styles.documentMeta}>{document.extension?.toUpperCase() || "DOCUMENT"}</Text></View>{active ? <CheckIcon size="sm" variant="accent" /> : null}</Button>;
      })}</View> : <View onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.imageGrid}>{images.map((image) => {
        const ref = { type: "image" as const, key: image.key }; const active = isSelected(ref);
        return <Button accessibilityLabel={`${active ? "Deselect" : "Select"} ${image.caption || image.filename}`} accessibilityState={{ selected: active }} contentMode="raw" key={image.key} onPress={() => toggle(ref)} size="md" style={[styles.imageButton, { width: imageSize, height: imageSize }, active && styles.selected]} variant="ghost"><Image accessibilityLabel={image.caption || image.filename} contentFit="cover" source={image.url} style={styles.image} />{active ? <View style={styles.check}><CheckIcon size="sm" variant="inverse" /></View> : null}</Button>;
      })}</View>}
      {!loading && !error && (tab === "archive" ? documents.length === 0 : images.length === 0) ? <Text style={styles.empty}>No {tab === "archive" ? "documents" : "images"} found.</Text> : null}
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel, marginBottom: spacing.sm },
  tab: { flex: 1 },
  search: { minHeight: 44, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: palette.page, fontSize: 13 },
  sheetSearchClear: { width: 44, paddingHorizontal: 0 },
  selectedList: { maxHeight: 176, marginTop: spacing.sm },
  selectedListContent: { gap: spacing.xs, paddingRight: spacing.xxs },
  selectedPill: { minHeight: 44, paddingLeft: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: 999, backgroundColor: palette.panel },
  selectedText: { minWidth: 0, flex: 1, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  selectedRemove: { width: 44, paddingHorizontal: 0 },
  notice: { marginTop: spacing.xs, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12 },
  results: { flexGrow: 1, paddingVertical: spacing.md },
  documentResults: { gap: spacing.sm },
  document: { width: "100%", height: "auto", minHeight: 60, justifyContent: "flex-start", gap: spacing.sm },
  selected: { borderWidth: 1, borderColor: palette.silver300 },
  documentCopy: { minWidth: 0, flex: 1, alignItems: "flex-start" },
  documentName: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13 },
  documentMeta: { marginTop: 3, color: palette.silver700, fontFamily: fonts.medium, fontSize: 10 },
  imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  imageButton: { paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden", borderRadius: radii.md },
  image: { width: "100%", height: "100%" },
  check: { position: "absolute", top: 6, right: 6, width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: palette.silver100 },
  imageSkeleton: { borderRadius: radii.md },
  documentSkeleton: { width: "100%", height: 60, borderRadius: radii.md },
  empty: { paddingVertical: 60, color: palette.silver700, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  error: { marginTop: spacing.sm, padding: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" },
  errorText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.regular, fontSize: 12 },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  count: { minWidth: 112, flexGrow: 1, flexShrink: 1, color: palette.silver500, fontFamily: fonts.medium, fontSize: 12 },
  footerAction: { minWidth: 96, flexGrow: 1 },
});
