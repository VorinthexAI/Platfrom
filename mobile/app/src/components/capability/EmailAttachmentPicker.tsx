import { useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CheckIcon, CloseIcon, FileIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";

import { listContentDocumentsAtLocation, searchContentMatches, type ContentDocument } from "@/lib/content-client";
import { attachmentIdentity, isSelectableEmailDocument, toggleEmailAttachment } from "@/lib/email-attachment-picker";
import type { EmailAttachmentRef } from "@/lib/email-client";
import { fetchGalleryOverview, searchGalleryImages, type GalleryImage } from "@/lib/gallery-client";
import { fonts, palette, radii } from "@/theme/tokens";

type PickerTab = "archive" | "gallery";

export function EmailAttachmentPicker({ open, selection, onClose, onDone }: { open: boolean; selection: EmailAttachmentRef[]; onClose: () => void; onDone: (selection: EmailAttachmentRef[]) => void }) {
  const [tab, setTab] = useState<PickerTab>("archive");
  const [working, setWorking] = useState<EmailAttachmentRef[]>(() => selection);
  const [documents, setDocuments] = useState<ContentDocument[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const currentRequest = ++requestId.current;
    const request = tab === "archive"
      ? listContentDocumentsAtLocation().then((loadedDocuments) => { if (requestId.current === currentRequest) setDocuments(loadedDocuments.filter(isSelectableEmailDocument)); })
      : fetchGalleryOverview().then((overview) => { if (requestId.current === currentRequest) setImages(overview.images); });
    void request
      .catch((cause: unknown) => { if (requestId.current === currentRequest) setError(cause instanceof Error ? cause.message : "Attachments could not be loaded."); })
      .finally(() => { if (requestId.current === currentRequest) setLoading(false); });
  }, [open, tab]);

  async function search(searchValue = query) {
    const currentRequest = ++requestId.current;
    const value = searchValue.trim();
    if (!value) {
      setLoading(true); setError(undefined);
      try {
        if (tab === "archive") { const result = (await listContentDocumentsAtLocation()).filter(isSelectableEmailDocument); if (requestId.current === currentRequest) setDocuments(result); }
        else { const result = (await fetchGalleryOverview()).images; if (requestId.current === currentRequest) setImages(result); }
      } catch (cause) { if (requestId.current === currentRequest) setError(cause instanceof Error ? cause.message : "Attachments could not be loaded."); }
      finally { if (requestId.current === currentRequest) setLoading(false); }
      return;
    }
    setLoading(true); setError(undefined);
    try {
      if (tab === "archive") {
        const result = await searchContentMatches(value, undefined, undefined, false);
        if (requestId.current === currentRequest) setDocuments(result.documents.filter(isSelectableEmailDocument).map((document) => ({ key: document.documentKey, name: document.name, extension: document.extension, folderKey: document.folderKey, isFavorite: document.isFavorite, updatedAt: "" })));
      } else { const result = (await searchGalleryImages({ query: value, recordHistory: false, limit: 100 })).images; if (requestId.current === currentRequest) setImages(result); }
    } catch (cause) { if (requestId.current === currentRequest) setError(cause instanceof Error ? cause.message : "Attachment search could not be completed."); }
    finally { if (requestId.current === currentRequest) setLoading(false); }
  }

  function selected(ref: EmailAttachmentRef) { return working.some((item) => attachmentIdentity(item) === attachmentIdentity(ref)); }
  function toggle(ref: EmailAttachmentRef) { setWorking((current) => toggleEmailAttachment(current, ref)); }

  return <BottomSheet
    description="Choose individual files, documents, and images. Your selection stays while you search."
    footer={<View style={styles.footer}><Text style={styles.count}>{working.length} selected</Text><Button onPress={() => onDone(working)} size="md" variant="primary">Done</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></View>}
    height="full"
    onOpenChange={(next) => { if (!next) onClose(); }}
    open={open}
    title="Add attachments"
  >
    <Tabs accessibilityLabel="Attachment sources" accessibilityRole="tablist" style={styles.tabs}>
      <Button accessibilityRole="tab" accessibilityState={{ selected: tab === "archive" }} onPress={() => { setLoading(true); setError(undefined); setTab("archive"); setQuery(""); }} size="md" style={styles.tab} variant={tab === "archive" ? "secondary" : "ghost"}>Archive</Button>
      <Button accessibilityRole="tab" accessibilityState={{ selected: tab === "gallery" }} onPress={() => { setLoading(true); setError(undefined); setTab("gallery"); setQuery(""); }} size="md" style={styles.tab} variant={tab === "gallery" ? "secondary" : "ghost"}>Gallery</Button>
    </Tabs>
    <View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel={`Search ${tab}`} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder={tab === "archive" ? "Search files and documents" : "Search images"} returnKeyType="search" style={styles.searchInput} value={query} />{query ? <Button accessibilityLabel="Clear attachment search" contentMode="raw" onPress={() => { setQuery(""); void search(""); }} size="md" variant="icon"><CloseIcon size="sm" /></Button> : null}<Button accessibilityLabel="Search attachments" contentMode="raw" loading={loading} onPress={() => void search()} size="md" variant="icon"><SearchIcon size="sm" /></Button></View>
    {error ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
    <ScrollView accessibilityLabel={`${tab} attachment results`} contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {loading ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} style={tab === "gallery" ? styles.imageSkeleton : styles.documentSkeleton} />) : tab === "archive" ? documents.map((document) => {
        const ref = { type: "document" as const, key: document.key }; const active = selected(ref);
        return <Button accessibilityLabel={`${active ? "Deselect" : "Select"} ${document.name}`} accessibilityState={{ selected: active }} contentMode="raw" key={document.key} onPress={() => toggle(ref)} size="md" style={[styles.document, active && styles.selected]} variant="secondary"><FileIcon size="md" variant={active ? "accent" : "muted"} /><View style={styles.documentCopy}><Text numberOfLines={1} style={styles.documentName}>{document.name}</Text><Text style={styles.documentMeta}>{document.extension?.toUpperCase() || "DOCUMENT"}</Text></View>{active ? <CheckIcon size="sm" variant="accent" /> : null}</Button>;
      }) : <View style={styles.imageGrid}>{images.map((image) => {
        const ref = { type: "image" as const, key: image.key }; const active = selected(ref);
        return <Button accessibilityLabel={`${active ? "Deselect" : "Select"} ${image.caption || image.filename}`} accessibilityState={{ selected: active }} contentMode="raw" key={image.key} onPress={() => toggle(ref)} size="md" style={[styles.imageButton, active && styles.selected]} variant="ghost"><Image contentFit="cover" source={image.url} style={styles.image} />{active ? <View style={styles.check}><CheckIcon size="sm" variant="inverse" /></View> : null}</Button>;
      })}</View>}
      {!loading && (tab === "archive" ? documents.length === 0 : images.length === 0) ? <Text style={styles.empty}>No {tab === "archive" ? "documents" : "images"} found.</Text> : null}
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  tabs: { marginBottom: 12 }, tab: { flex: 1 }, search: { minHeight: 48, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panel }, searchInput: { minHeight: 42, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }, results: { flexGrow: 1, paddingVertical: 14, gap: 8 }, document: { width: "100%", height: "auto", minHeight: 64, justifyContent: "flex-start", gap: 12 }, selected: { borderWidth: 1, borderColor: palette.silver300 }, documentCopy: { minWidth: 0, flex: 1, alignItems: "flex-start" }, documentName: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 13 }, documentMeta: { marginTop: 3, color: palette.silver700, fontFamily: fonts.medium, fontSize: 9 }, imageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, imageButton: { width: "31%", aspectRatio: 1, height: "auto", paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden", borderRadius: radii.md }, image: { width: "100%", height: "100%" }, check: { position: "absolute", top: 6, right: 6, width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: palette.silver100 }, imageSkeleton: { width: "31%", aspectRatio: 1, borderRadius: radii.md }, documentSkeleton: { width: "100%", height: 64, borderRadius: radii.md }, empty: { paddingVertical: 60, color: palette.silver700, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" }, error: { marginTop: 10, padding: 10, borderRadius: radii.md, backgroundColor: "rgba(64,20,20,0.9)" }, errorText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 12 }, footer: { flexDirection: "row", alignItems: "center", gap: 8 }, count: { minWidth: 0, flex: 1, color: palette.silver500, fontFamily: fonts.medium, fontSize: 12 },
});
