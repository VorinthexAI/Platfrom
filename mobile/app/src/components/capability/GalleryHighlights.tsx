import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, PauseIcon, PlayIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { useToast } from "@vorinthex/shared/ui/toast";

import { createGalleryCollectionHighlight, deleteGalleryCollectionHighlight, fetchGalleryCollectionHighlight, getGalleryContext, isGalleryClientErrorCode, isGalleryCollectionOwned, listGalleryCollectionHighlights, resolveGalleryHighlightSlides, type GalleryCollection, type GalleryHighlight, type GalleryHighlightDetail } from "@/lib/gallery-client";
import { HIGHLIGHT_SLIDE_DURATION_MS, initialHighlightPlaybackState, reduceHighlightPlayback } from "@/lib/gallery-highlight-playback";
import { galleryQueryKeys } from "@/lib/workspace-query-cache";
import { subscribeAppEvent } from "@/lib/app-events";
import { GalleryCollectionImagePicker } from "@/components/capability/GalleryCollectionImagePicker";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type GalleryHighlightsProps = {
  collection: GalleryCollection;
  onClose: () => void;
  open: boolean;
};

const COLUMNS = 3;
const GAP = 8;
type HighlightSheet = "player" | "confirmDelete";

export function GalleryHighlights({ collection, onClose, open }: GalleryHighlightsProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const notify = (title: string) => showToast({ title, duration: 2_000 });
  const galleryContext = getGalleryContext();
  const { width } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const [highlights, setHighlights] = useState<GalleryHighlight[]>([]);
  const [detail, setDetail] = useState<GalleryHighlightDetail>();
  const [listLoading, setListLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedHighlightKeys, setSelectedHighlightKeys] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<HighlightSheet>("player");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [customCreateOpen, setCustomCreateOpen] = useState(false);
  const [playback, dispatch] = useReducer(reduceHighlightPlayback, initialHighlightPlaybackState);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const createRequest = useRef(0);
  const listLoaded = useRef(false);
  const longPressedHighlight = useRef<string | undefined>(undefined);
  const listSheetOpen = useRef(open && !detail && !opening && activeSheet === "player");
  const fadeProgress = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const owner = isGalleryCollectionOwned(collection);
  const cardWidth = Math.floor(((gridWidth || width - 40) - GAP * (COLUMNS - 1)) / COLUMNS);
  const slides = detail ? resolveGalleryHighlightSlides(detail) : [];
  const activeSlide = slides[playback.index];
  const listEmpty = !creating && !listLoading && highlights.length === 0;

  async function loadList(invalidate = false) {
    const generation = ++listRequest.current;
    if (!listLoaded.current) setListLoading(true);
    try {
      if (invalidate) await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), queryFn: () => listGalleryCollectionHighlights(collection.key), staleTime: 0 });
      if (generation === listRequest.current) {
        const orderedHighlights = [...result.highlights].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        setHighlights(orderedHighlights);
        setSelectedHighlightKeys((current) => current.filter((key) => orderedHighlights.some((highlight) => highlight.key === key)));
      }
    } catch {
      if (generation === listRequest.current) notify("Highlights could not be loaded");
    } finally {
      if (generation === listRequest.current) { listLoaded.current = true; setListLoading(false); }
    }
  }

  async function openHighlight(highlight: GalleryHighlight) {
    listSheetOpen.current = false;
    const generation = ++detailRequest.current;
    setOpening(true);
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.highlight(galleryContext, collection.key, highlight.key), queryFn: () => fetchGalleryCollectionHighlight(highlight.key), staleTime: 0 });
      if (generation !== detailRequest.current) return;
      setDetail(result.highlight);
      setActiveSheet("player");
      dispatch({ type: "load", slideCount: resolveGalleryHighlightSlides(result.highlight).length, autoplay: true });
    } catch (failure) {
      if (generation === detailRequest.current && isGalleryClientErrorCode(failure, "GALLERY_HIGHLIGHT_NOT_FOUND")) {
        setDetail(undefined);
        setActiveSheet("player");
        dispatch({ type: "pause" });
        void loadList();
      } else if (generation === detailRequest.current) notify("Highlight could not be opened");
    } finally {
      if (generation === detailRequest.current) setOpening(false);
    }
  }

  async function createHighlight(imageKeys?: string[]) {
    if (!owner) return;
    const generation = ++createRequest.current;
    setCreating(true);
    try {
      const { highlight } = await createGalleryCollectionHighlight(collection.key, imageKeys);
      if (generation !== createRequest.current) return;
      queryClient.setQueryData(galleryQueryKeys.highlight(galleryContext, collection.key, highlight.key), { highlight });
      setHighlights((current) => [...current.filter(({ key }) => key !== highlight.key), highlight]);
      notify("Highlight created");
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" }).catch(() => undefined);
      if (listSheetOpen.current) void openHighlight(highlight);
    } catch {
      if (generation === createRequest.current) notify("Highlight could not be created");
    } finally {
      if (generation === createRequest.current) setCreating(false);
    }
  }

  function toggleHighlightSelection(highlightKey: string) {
    setSelectedHighlightKeys((current) => current.includes(highlightKey) ? current.filter((key) => key !== highlightKey) : [...current, highlightKey]);
  }

  function handleHighlightLongPress(highlightKey: string) {
    if (!owner) return;
    longPressedHighlight.current = highlightKey;
    setTimeout(() => { if (longPressedHighlight.current === highlightKey) longPressedHighlight.current = undefined; }, 50);
    toggleHighlightSelection(highlightKey);
    void Haptics.selectionAsync();
  }

  function handleHighlightPress(highlight: GalleryHighlight) {
    const longPress = longPressedHighlight.current;
    longPressedHighlight.current = undefined;
    if (longPress === highlight.key) return;
    if (selectedHighlightKeys.length && owner) toggleHighlightSelection(highlight.key);
    else void openHighlight(highlight);
  }

  async function deleteSelectedHighlights() {
    if (!owner || selectedHighlightKeys.length === 0) return;
    const highlightKeys = [...selectedHighlightKeys];
    setDeleting(true);
    try {
      const outcomes = await Promise.allSettled(highlightKeys.map((highlightKey) => deleteGalleryCollectionHighlight(highlightKey)));
      const deletedKeys = highlightKeys.filter((_, index) => outcomes[index]?.status === "fulfilled");
      const failedKeys = highlightKeys.filter((_, index) => outcomes[index]?.status === "rejected");
      setHighlights((current) => current.filter(({ key }) => !deletedKeys.includes(key)));
      deletedKeys.forEach((highlightKey) => queryClient.removeQueries({ queryKey: galleryQueryKeys.highlight(galleryContext, collection.key, highlightKey), exact: true }));
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" });
      setSelectedHighlightKeys(failedKeys);
      setActiveSheet("player");
      if (failedKeys.length) notify(failedKeys.length === 1 ? "Highlight could not be deleted" : `${failedKeys.length} highlights could not be deleted`);
      await loadList(true);
    } catch {
      notify(highlightKeys.length === 1 ? "Highlight could not be deleted" : "Highlights could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    listSheetOpen.current = open && !detail && !opening && activeSheet === "player" && !createMenuOpen && !customCreateOpen;
  }, [activeSheet, createMenuOpen, customCreateOpen, detail, open, opening]);

  useEffect(() => {
    if (!open) {
      listRequest.current += 1; detailRequest.current += 1; createRequest.current += 1;
      const timer = setTimeout(() => setCreating(false), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => void loadList(true), 0);
    return () => clearTimeout(timer);
    // Opening or changing collections is the operation boundary; queryClient is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.key, open]);

  useEffect(() => {
    if (owner) return;
    const timer = setTimeout(() => setSelectedHighlightKeys([]), 0);
    return () => clearTimeout(timer);
  }, [owner]);

  useEffect(() => {
    if (!open || !playback.playing || slides.length === 0 || AppState.currentState !== "active") return;
    let previous = performance.now();
    let frame = 0;
    let active = true;
    const tick = (now: number) => {
      if (!active) return;
      dispatch({ type: "tick", elapsedMs: now - previous, slideCount: slides.length });
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [open, playback.playing, slides.length]);

  useEffect(() => {
    if (!open) return;
    const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") dispatch({ type: "pause" }); });
    return () => subscription.remove();
  }, [open]);

  useEffect(() => subscribeAppEvent((event) => {
    if (!open || creating || deleting || opening) return;
    if (event.type !== "event-stream.connected" && (event.type !== "gallery.changed" || !["highlight.changed", "image.changed", "collection.content.changed"].includes(event.slug))) return;
    if (detail) void openHighlight(detail);
    else void loadList();
    // Event handlers intentionally reopen the latest key; operation functions are render-local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [collection.key, creating, deleting, detail?.key, open, opening]);

  useEffect(() => {
    if (!open) return;
    const urls = (detail ? resolveGalleryHighlightSlides(detail) : []).slice(playback.index, playback.index + 3).map(({ url }) => url);
    void Promise.allSettled(urls.map((url) => Image.prefetch(url)));
  }, [detail, open, playback.index]);

  useEffect(() => {
    if (!detail?.key) return;
    fadeProgress.value = reducedMotion ? 1 : 0;
    if (!reducedMotion) fadeProgress.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
  }, [detail?.key, fadeProgress, playback.index, reducedMotion]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeProgress.value }));

  const close = () => { listSheetOpen.current = false; listRequest.current += 1; detailRequest.current += 1; createRequest.current += 1; setDetail(undefined); setCreating(false); setDeleting(false); setSelectedHighlightKeys([]); setActiveSheet("player"); setCreateMenuOpen(false); setCustomCreateOpen(false); dispatch({ type: "pause" }); onClose(); };
  const listFooter = <>{owner ? <Button disabled={creating || listLoading || opening} onPress={() => { listSheetOpen.current = false; setCreateMenuOpen(true); }} size="md" variant="primary">Create</Button> : null}<Button disabled={creating} onPress={close} size="md" variant="secondary">Close</Button></>;
  const playerFooter = <Button onPress={close} size="md" variant="secondary">Close</Button>;

  return <>
    <BottomSheet footer={listFooter} height="full" onOpenChange={(next) => { if (!next && !createMenuOpen && !customCreateOpen) close(); }} open={open && !detail} title="Highlights">
      <ScrollView contentContainerStyle={[styles.grid, listEmpty && styles.emptyGrid]} onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>
        {selectedHighlightKeys.length ? <Tabs style={styles.bulkToolbar}>
          <View style={styles.bulkToolbarSelection}><Button accessibilityLabel="Clear highlight selection" contentMode="raw" disabled={deleting} onPress={() => setSelectedHighlightKeys([])} size="md" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button><Text style={styles.bulkSelectionText}>{selectedHighlightKeys.length} selected</Text></View>
          <Button disabled={deleting} onPress={() => { listSheetOpen.current = false; setActiveSheet("confirmDelete"); }} size="md" style={styles.bulkDeleteAction} textStyle={styles.bulkDeleteText} variant="secondary">Delete</Button>
        </Tabs> : null}
        {listLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.cardFrame, { width: cardWidth, height: cardWidth * 16 / 9 }]} />) : highlights.map((highlight) => { const selected = selectedHighlightKeys.includes(highlight.key); return <Button accessibilityActions={owner ? [{ name: "longpress", label: selected ? "Deselect highlight" : "Select highlight" }] : undefined} accessibilityLabel={`${highlight.title}, ${highlight.slideCount} slides`} accessibilityState={{ selected }} contentMode="raw" disabled={creating || opening || deleting} key={highlight.key} onAccessibilityAction={owner ? ({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") toggleHighlightSelection(highlight.key); } : undefined} onLongPress={owner ? () => handleHighlightLongPress(highlight.key) : undefined} onPress={() => handleHighlightPress(highlight)} shape="rounded" size="md" style={[styles.cardFrame, styles.card, selected && styles.cardSelected, { width: cardWidth, height: cardWidth * 16 / 9 }]} variant="ghost">
          {highlight.coverUrl ? <Image contentFit="cover" source={highlight.coverUrl} style={StyleSheet.absoluteFill} transition={180} /> : null}
          <View style={styles.cardShade} />
          <View style={styles.cardCopy}><Text numberOfLines={2} style={styles.title}>{highlight.title}</Text><Text style={styles.cardCount}>{highlight.slideCount} slide{highlight.slideCount === 1 ? "" : "s"}</Text></View>
          {selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
        </Button>; })}
        {creating ? <View accessibilityLabel="Creating highlight" accessibilityRole="progressbar"><Skeleton style={[styles.cardFrame, { width: cardWidth, height: cardWidth * 16 / 9 }]} /></View> : null}
        {listEmpty ? <Text style={styles.empty}>No highlights yet.</Text> : null}
      </ScrollView>
    </BottomSheet>

    <BottomSheet hideHeading onOpenChange={setCreateMenuOpen} open={open && createMenuOpen} title=""><BottomSheetMenu><BottomSheetItem disabled={creating} onPress={() => { setCreateMenuOpen(false); listSheetOpen.current = true; void createHighlight(); }} style={styles.menuItem} variant="secondary">Random</BottomSheetItem><BottomSheetItem disabled={creating} onPress={() => { setCreateMenuOpen(false); setCustomCreateOpen(true); }} style={styles.menuItem} variant="secondary">Custom</BottomSheetItem></BottomSheetMenu></BottomSheet>
    <GalleryCollectionImagePicker collection={collection} description="Tap to select 2–10 images, in the order you want them." mode="multiple" onClose={() => setCustomCreateOpen(false)} onSelect={(imageKeys) => { setCustomCreateOpen(false); listSheetOpen.current = true; void createHighlight(imageKeys); }} open={open && customCreateOpen} title="Custom highlight" />

    <BottomSheet footer={playerFooter} height="full" onOpenChange={(next) => { if (!next) close(); }} open={open && Boolean(detail)} title={detail?.title ?? "Highlight"}>
      <View style={styles.player}>
        <View style={styles.stage}>{activeSlide ? <Animated.View style={[styles.slideFrame, fadeStyle]}><Image contentFit="contain" source={activeSlide.url} style={styles.image} /></Animated.View> : <Text style={styles.empty}>This highlight has no available slides.</Text>}</View>
        <View accessibilityLabel={`Slide ${slides.length ? playback.index + 1 : 0} of ${slides.length}`} accessibilityRole="progressbar" style={styles.progress}>{slides.map((slide, index) => <View key={slide.key} style={styles.progressTrack}><View style={[styles.progressFill, { width: index < playback.index ? "100%" : index > playback.index ? "0%" : `${Math.min(100, playback.progressMs / HIGHLIGHT_SLIDE_DURATION_MS * 100)}%` }]} /></View>)}</View>
        <View style={styles.controls}>
          <Button accessibilityLabel="Previous slide" contentMode="raw" disabled={playback.index === 0 || slides.length === 0} onPress={() => dispatch({ type: "previous" })} size="md" variant="secondary"><ChevronLeftIcon /></Button>
          <Button accessibilityLabel={playback.playing ? "Pause highlight" : "Play highlight"} contentMode="raw" disabled={slides.length === 0} onPress={() => dispatch(playback.playing ? { type: "pause" } : { type: "play", slideCount: slides.length })} size="md" style={styles.playbackToggle} variant="secondary">{playback.playing ? <PauseIcon /> : <PlayIcon />}</Button>
          <Button accessibilityLabel="Next slide" contentMode="raw" disabled={playback.index >= slides.length - 1 || slides.length === 0} onPress={() => dispatch({ type: "next", slideCount: slides.length })} size="md" variant="secondary"><ChevronRightIcon /></Button>
        </View>
        <Text style={styles.count}>{slides.length} slide{slides.length === 1 ? "" : "s"}</Text>
      </View>
    </BottomSheet>

    <BottomSheet dismissible={!deleting} onOpenChange={(next) => { if (!next) setActiveSheet("player"); }} open={open && !detail && selectedHighlightKeys.length > 0 && activeSheet === "confirmDelete"} title={`Delete ${selectedHighlightKeys.length === 1 ? "highlight" : `${selectedHighlightKeys.length} highlights`}?`}>
      <View style={styles.compactActions}><Button disabled={deleting} loading={deleting} onPress={() => void deleteSelectedHighlights()} size="md" variant="primary">Delete</Button><Button disabled={deleting} onPress={() => setActiveSheet("player")} size="md" variant="secondary">Close</Button></View>
    </BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingVertical: spacing.md },
  emptyGrid: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  bulkToolbar: { width: "100%", minHeight: 36, marginBottom: spacing.xs, padding: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbarClose: { height: 30, minHeight: 30, width: 30, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  bulkDeleteAction: { height: 30, minHeight: 30, minWidth: 68, paddingHorizontal: 12, paddingVertical: 0 },
  bulkDeleteText: { fontFamily: fonts.regular, fontSize: 11, letterSpacing: 0.4 },
  cardFrame: { overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.sm, backgroundColor: palette.panelRaised },
  card: { alignItems: "stretch", justifyContent: "flex-end", padding: 0 },
  cardSelected: { borderColor: palette.silver50, borderWidth: 2 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  cardShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.35)" },
  cardCopy: { marginTop: "auto", padding: 8, gap: 2 },
  title: { color: palette.silver50, fontFamily: fonts.semibold, fontSize: 12 },
  cardCount: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 10 },
  player: { flex: 1, paddingVertical: spacing.md, gap: 14 },
  stage: { flex: 1, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: palette.voidBlack },
  slideFrame: { width: "100%", height: "100%", overflow: "hidden", borderRadius: radii.lg },
  image: { width: "100%", height: "100%", borderRadius: radii.lg },
  progress: { minHeight: 3, flexDirection: "row", gap: 4 },
  progressTrack: { flex: 1, height: 3, overflow: "hidden", borderRadius: 2, backgroundColor: palette.silver700 },
  progressFill: { height: "100%", backgroundColor: palette.silver50 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  playbackToggle: { height: 35, minHeight: 35, width: 35 },
  count: { textAlign: "center", color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  compactActions: { gap: spacing.sm },
  menuItem: { justifyContent: "center" },
  empty: { width: "100%", paddingVertical: spacing.md, textAlign: "center", color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
});
