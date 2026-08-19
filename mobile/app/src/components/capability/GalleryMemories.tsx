import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CheckIcon, CloseIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { useToast } from "@vorinthex/shared/ui/toast";

import { createGalleryCollectionMemory, deleteGalleryCollectionMemory, fetchGalleryCollectionMemory, getGalleryContext, isGalleryClientErrorCode, isGalleryCollectionOwned, isGalleryMemoryExhaustion, listGalleryCollectionMemories, type GalleryCollection, type GalleryMemory } from "@/lib/gallery-client";
import { galleryMemoryTypedText, galleryMemoryTypingDuration, splitGalleryMemoryText } from "@/lib/gallery-memory-typing";
import { subscribeAppEvent } from "@/lib/app-events";
import { galleryQueryKeys } from "@/lib/workspace-query-cache";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type GalleryMemoriesProps = { collection: GalleryCollection; onClose: () => void; open: boolean };
type MemorySheet = "list" | "confirmDelete";
const COLUMNS = 4;
const GAP = 5;

export function GalleryMemories({ collection, onClose, open }: GalleryMemoriesProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const galleryContext = getGalleryContext();
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const [memories, setMemories] = useState<GalleryMemory[]>([]);
  const [detail, setDetail] = useState<GalleryMemory>();
  const [typedText, setTypedText] = useState("");
  const [typingText, setTypingText] = useState("");
  const [typingRun, setTypingRun] = useState(0);
  const [showImage, setShowImage] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedMemoryKeys, setSelectedMemoryKeys] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<MemorySheet>("list");
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const createRequest = useRef(0);
  const listLoaded = useRef(false);
  const listSheetOpen = useRef(open && !detail && !opening && activeSheet === "list");
  const longPressedMemory = useRef<string | undefined>(undefined);
  const owner = isGalleryCollectionOwned(collection);
  const cardWidth = Math.floor(((gridWidth || width - 40) - GAP * (COLUMNS - 1)) / COLUMNS);
  const listEmpty = !creating && !listLoading && memories.length === 0;
  listSheetOpen.current = open && !detail && !opening && activeSheet === "list";

  const notify = (title: string) => showToast({ title, duration: 2_000 });

  async function loadList(invalidate = false) {
    const generation = ++listRequest.current;
    if (!listLoaded.current) setListLoading(true);
    try {
      const queryKey = galleryQueryKeys.memories(galleryContext, collection.key);
      if (invalidate) await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey, queryFn: () => listGalleryCollectionMemories(collection.key), staleTime: 0 });
      if (generation !== listRequest.current || !open) return;
      setMemories(result.memories);
      setSelectedMemoryKeys((current) => current.filter((key) => result.memories.some((memory) => memory.key === key)));
    } catch {
      if (generation === listRequest.current && open) notify("Memories could not be loaded");
    } finally {
      if (generation === listRequest.current) { listLoaded.current = true; setListLoading(false); }
    }
  }

  function restartTyping(text: string) {
    setTypingText(text);
    setTypedText(reducedMotion ? text : "");
    setTypingRun((current) => current + 1);
  }

  async function openMemory(memory: Pick<GalleryMemory, "key">) {
    listSheetOpen.current = false;
    const generation = ++detailRequest.current;
    setOpening(true);
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.memory(galleryContext, collection.key, memory.key), queryFn: () => fetchGalleryCollectionMemory(memory.key), staleTime: 0 });
      if (generation !== detailRequest.current || !open) return;
      setDetail(result.memory);
      setShowImage(false);
      restartTyping(result.memory.text);
    } catch (failure) {
      if (generation === detailRequest.current && open && isGalleryClientErrorCode(failure, "GALLERY_MEMORY_NOT_FOUND")) { setDetail(undefined); void loadList(); }
      else if (generation === detailRequest.current && open) notify("Memory could not be opened");
    } finally {
      if (generation === detailRequest.current) setOpening(false);
    }
  }

  async function refreshDetail(memoryKey: string) {
    const generation = ++detailRequest.current;
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.memory(galleryContext, collection.key, memoryKey), queryFn: () => fetchGalleryCollectionMemory(memoryKey), staleTime: 0 });
      if (generation === detailRequest.current && open) setDetail(result.memory);
    } catch (failure) {
      if (generation === detailRequest.current && open && isGalleryClientErrorCode(failure, "GALLERY_MEMORY_NOT_FOUND")) { setDetail(undefined); void loadList(); }
    }
  }

  async function createMemory() {
    if (!owner || creating) return;
    const generation = ++createRequest.current;
    setCreating(true);
    try {
      const { memory } = await createGalleryCollectionMemory(collection.key);
      if (generation !== createRequest.current || !open) return;
      queryClient.setQueryData(galleryQueryKeys.memory(galleryContext, collection.key, memory.key), { memory });
      setMemories((current) => [memory, ...current.filter(({ key }) => key !== memory.key)]);
      notify("Memory created");
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.memories(galleryContext, collection.key), exact: true, refetchType: "none" }).catch(() => undefined);
      if (listSheetOpen.current) void openMemory(memory);
    } catch (failure) {
      if (generation === createRequest.current && open) notify(isGalleryMemoryExhaustion(failure) && failure instanceof Error ? failure.message : "Memory could not be created");
    } finally {
      if (generation === createRequest.current) setCreating(false);
    }
  }

  function toggleSelection(memoryKey: string) {
    setSelectedMemoryKeys((current) => current.includes(memoryKey) ? current.filter((key) => key !== memoryKey) : [...current, memoryKey]);
  }

  function handleLongPress(memoryKey: string) {
    if (!owner) return;
    longPressedMemory.current = memoryKey;
    setTimeout(() => { if (longPressedMemory.current === memoryKey) longPressedMemory.current = undefined; }, 50);
    toggleSelection(memoryKey);
    void Haptics.selectionAsync();
  }

  function handlePress(memory: GalleryMemory) {
    const longPress = longPressedMemory.current;
    longPressedMemory.current = undefined;
    if (longPress === memory.key) return;
    if (selectedMemoryKeys.length && owner) toggleSelection(memory.key);
    else void openMemory(memory);
  }

  async function deleteSelectedMemories() {
    if (!owner || !selectedMemoryKeys.length) return;
    const memoryKeys = [...selectedMemoryKeys];
    setDeleting(true);
    try {
      const outcomes = await Promise.allSettled(memoryKeys.map((memoryKey) => deleteGalleryCollectionMemory(memoryKey, collection.key)));
      const deletedKeys = memoryKeys.filter((_, index) => outcomes[index]?.status === "fulfilled");
      const failedKeys = memoryKeys.filter((_, index) => outcomes[index]?.status === "rejected");
      setMemories((current) => current.filter(({ key }) => !deletedKeys.includes(key)));
      deletedKeys.forEach((memoryKey) => queryClient.removeQueries({ queryKey: galleryQueryKeys.memory(galleryContext, collection.key, memoryKey), exact: true }));
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.memories(galleryContext, collection.key), exact: true, refetchType: "none" });
      setSelectedMemoryKeys(failedKeys);
      setActiveSheet("list");
      if (failedKeys.length) notify(failedKeys.length === 1 ? "Memory could not be deleted" : `${failedKeys.length} memories could not be deleted`);
      await loadList(true);
    } catch {
      notify(memoryKeys.length === 1 ? "Memory could not be deleted" : "Memories could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!open) { listRequest.current += 1; detailRequest.current += 1; createRequest.current += 1; setCreating(false); return; }
    const timer = setTimeout(() => void loadList(true), 0);
    return () => clearTimeout(timer);
    // Opening the feature is the list freshness boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.key, open]);

  useEffect(() => {
    if (owner) return;
    const timer = setTimeout(() => setSelectedMemoryKeys([]), 0);
    return () => clearTimeout(timer);
  }, [owner]);

  useEffect(() => {
    if (reducedMotion) { setTypedText(typingText); return; }
    const duration = galleryMemoryTypingDuration(typingText);
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      setTypedText(galleryMemoryTypedText(typingText, elapsed, duration));
      if (elapsed >= duration) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [reducedMotion, typingRun, typingText]);

  useEffect(() => subscribeAppEvent((event) => {
    if (!open || creating || deleting || opening) return;
    if (event.type !== "event-stream.connected" && (event.type !== "gallery.changed" || !["memory.created", "memory.deleted", "image.changed", "collection.content.changed"].includes(event.slug))) return;
    if (detail) void refreshDetail(detail.key);
    else void loadList();
    // Refreshing detail deliberately does not call restartTyping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [collection.key, creating, deleting, detail?.key, open, opening]);

  const close = () => { listSheetOpen.current = false; listRequest.current += 1; detailRequest.current += 1; createRequest.current += 1; setDetail(undefined); setCreating(false); setDeleting(false); setSelectedMemoryKeys([]); setActiveSheet("list"); onClose(); };
  const listFooter = <>{owner ? <Button disabled={creating || listLoading || opening} loading={creating} onPress={() => void createMemory()} size="md" variant="primary">Create</Button> : null}<Button disabled={creating} onPress={close} size="md" variant="secondary">Close</Button></>;
  const detailFooter = <><Button onPress={() => setShowImage((current) => !current)} size="md" variant="primary">{showImage ? "Read memory" : "Show image"}</Button><Button onPress={close} size="md" variant="secondary">Close</Button></>;

  return <>
    <BottomSheet footer={listFooter} height="full" onOpenChange={(next) => { if (!next) close(); }} open={open && !detail} title="Memories">
      <ScrollView contentContainerStyle={[styles.grid, listEmpty && styles.emptyGrid]} onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>
        {selectedMemoryKeys.length ? <Tabs style={styles.bulkToolbar}><View style={styles.bulkSelection}><Button accessibilityLabel="Clear memory selection" contentMode="raw" disabled={deleting} onPress={() => setSelectedMemoryKeys([])} size="md" style={styles.bulkClose} variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.bulkText}>{selectedMemoryKeys.length} selected</Text></View><Button disabled={deleting} onPress={() => { listSheetOpen.current = false; setActiveSheet("confirmDelete"); }} size="md" variant="secondary">Delete</Button></Tabs> : null}
        {creating ? <View accessibilityLabel="Creating memory" accessibilityRole="progressbar"><Skeleton style={[styles.cardFrame, { width: cardWidth, height: cardWidth }]} /></View> : null}
        {listLoading ? Array.from({ length: 4 }, (_, index) => <Skeleton key={index} style={[styles.cardFrame, { width: cardWidth, height: cardWidth }]} />) : memories.map((memory) => { const selected = selectedMemoryKeys.includes(memory.key); return <Button accessibilityActions={owner ? [{ name: "longpress", label: selected ? "Deselect memory" : "Select memory" }] : undefined} accessibilityLabel="Open memory" accessibilityState={{ selected }} contentMode="raw" disabled={creating || opening || deleting} key={memory.key} onAccessibilityAction={owner ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") toggleSelection(memory.key); } : undefined} onLongPress={owner ? () => handleLongPress(memory.key) : undefined} onPress={() => handlePress(memory)} shape="rounded" size="md" style={[styles.cardFrame, styles.card, selected && styles.cardSelected, { width: cardWidth, height: cardWidth }]} variant="ghost"><Image contentFit="cover" source={memory.image.url} style={StyleSheet.absoluteFill} transition={150} />{selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</Button>; })}
        {listEmpty ? <Text style={styles.empty}>No memories yet.</Text> : null}
      </ScrollView>
    </BottomSheet>

    <BottomSheet footer={detailFooter} height="full" onOpenChange={(next) => { if (!next) close(); }} open={open && Boolean(detail)} title="Memory">
      {detail ? <ScrollView contentContainerStyle={styles.detail} showsVerticalScrollIndicator={false}><View style={[styles.detailImageFrame, showImage && styles.detailImageFrameZoom]}><Image contentFit={showImage ? "contain" : "cover"} source={detail.image.url} style={styles.detailImage} transition={180} /></View><View style={styles.memoryCopy}>{splitGalleryMemoryText(typedText).map((section, index) => <Text key={`${index}:${section.length}`} style={styles.memoryText}>{section}</Text>)}</View></ScrollView> : null}
    </BottomSheet>

    <BottomSheet dismissible={!deleting} onOpenChange={(next) => { if (!next) setActiveSheet("list"); }} open={open && !detail && selectedMemoryKeys.length > 0 && activeSheet === "confirmDelete"} title={`Delete ${selectedMemoryKeys.length === 1 ? "memory" : `${selectedMemoryKeys.length} memories`}?`}>
      <View style={styles.confirmActions}><Button disabled={deleting} loading={deleting} onPress={() => void deleteSelectedMemories()} size="md" variant="primary">Delete</Button><Button disabled={deleting} onPress={() => setActiveSheet("list")} size="md" variant="secondary">Close</Button></View>
    </BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingVertical: spacing.md },
  emptyGrid: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  cardFrame: { overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.sm, backgroundColor: palette.panelRaised },
  card: { padding: 0 },
  cardSelected: { borderColor: palette.silver50, borderWidth: 2 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  bulkToolbar: { width: "100%", minHeight: 40, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 },
  bulkText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  empty: { width: "100%", paddingVertical: spacing.md, textAlign: "center", color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
  detail: { flexGrow: 1, alignItems: "center", paddingVertical: spacing.lg, gap: spacing.xl },
  detailImageFrame: { width: 120, height: 120, overflow: "hidden", borderRadius: radii.md, backgroundColor: palette.voidBlack },
  detailImageFrameZoom: { width: "100%", height: 420, borderRadius: radii.lg },
  detailImage: { width: "100%", height: "100%" },
  memoryCopy: { width: "100%", gap: spacing.md, paddingBottom: spacing.xl },
  memoryText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 17, lineHeight: 27 },
  confirmActions: { gap: spacing.sm },
});
