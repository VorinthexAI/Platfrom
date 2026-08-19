import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon, PauseIcon, PlayIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { useToast } from "@vorinthex/shared/ui/toast";

import { createGalleryCollectionHighlight, deleteGalleryCollectionHighlight, fetchGalleryCollectionHighlight, getGalleryContext, isGalleryClientErrorCode, isGalleryCollectionOwned, listGalleryCollectionHighlights, resolveGalleryHighlightSlides, type GalleryCollection, type GalleryHighlight, type GalleryHighlightDetail } from "@/lib/gallery-client";
import { HIGHLIGHT_SLIDE_DURATION_MS, initialHighlightPlaybackState, reduceHighlightPlayback } from "@/lib/gallery-highlight-playback";
import { galleryQueryKeys } from "@/lib/workspace-query-cache";
import { subscribeAppEvent } from "@/lib/app-events";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type GalleryHighlightsProps = {
  collection: GalleryCollection;
  onClose: () => void;
  open: boolean;
};

const COLUMNS = 3;
const GAP = 8;
type HighlightSheet = "player" | "actions" | "confirmDelete";

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
  const [activeSheet, setActiveSheet] = useState<HighlightSheet>("player");
  const [playback, dispatch] = useReducer(reduceHighlightPlayback, initialHighlightPlaybackState);
  const request = useRef(0);
  const createRequest = useRef(0);
  const listLoaded = useRef(false);
  const previousSlideIndex = useRef(0);
  const cubeProgress = useSharedValue(1);
  const cubeDirection = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const owner = isGalleryCollectionOwned(collection);
  const cardWidth = Math.floor(((gridWidth || width - 40) - GAP * (COLUMNS - 1)) / COLUMNS);
  const slides = detail ? resolveGalleryHighlightSlides(detail) : [];
  const activeSlide = slides[playback.index];
  const listEmpty = !creating && !listLoading && highlights.length === 0;

  async function loadList(invalidate = false) {
    const generation = ++request.current;
    if (!listLoaded.current) setListLoading(true);
    try {
      if (invalidate) await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" });
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), queryFn: () => listGalleryCollectionHighlights(collection.key), staleTime: 0 });
      if (generation === request.current) setHighlights(result.highlights);
    } catch {
      if (generation === request.current) notify("Highlights could not be loaded");
    } finally {
      if (generation === request.current) { listLoaded.current = true; setListLoading(false); }
    }
  }

  async function openHighlight(highlight: GalleryHighlight) {
    const generation = ++request.current;
    setOpening(true);
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.highlight(galleryContext, collection.key, highlight.key), queryFn: () => fetchGalleryCollectionHighlight(highlight.key), staleTime: 0 });
      if (generation !== request.current) return;
      setDetail(result.highlight);
      setActiveSheet("player");
      dispatch({ type: "load", slideCount: resolveGalleryHighlightSlides(result.highlight).length, autoplay: true });
    } catch (failure) {
      if (generation === request.current && isGalleryClientErrorCode(failure, "GALLERY_HIGHLIGHT_NOT_FOUND")) {
        setDetail(undefined);
        setActiveSheet("player");
        dispatch({ type: "pause" });
        void loadList();
      } else if (generation === request.current) notify("Highlight could not be opened");
    } finally {
      if (generation === request.current) setOpening(false);
    }
  }

  async function createHighlight() {
    if (!owner) return;
    const generation = ++createRequest.current;
    setCreating(true);
    try {
      const { highlight } = await createGalleryCollectionHighlight(collection.key);
      if (generation !== createRequest.current) return;
      queryClient.setQueryData(galleryQueryKeys.highlight(galleryContext, collection.key, highlight.key), { highlight });
      setHighlights((current) => [highlight, ...current.filter(({ key }) => key !== highlight.key)]);
      setCreating(false);
      notify("Highlight created");
      void queryClient.invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" }).catch(() => undefined);
    } catch {
      if (generation === createRequest.current) {
        setCreating(false);
        notify("Highlight could not be created");
      }
    }
  }

  async function deleteHighlight() {
    if (!owner || !detail) return;
    const highlightKey = detail.key;
    setDeleting(true);
    try {
      await deleteGalleryCollectionHighlight(highlightKey);
      setHighlights((current) => current.filter(({ key }) => key !== highlightKey));
      queryClient.removeQueries({ queryKey: galleryQueryKeys.highlight(galleryContext, collection.key, highlightKey), exact: true });
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" });
      setDetail(undefined);
      setActiveSheet("player");
      dispatch({ type: "pause" });
    } catch {
      notify("Highlight could not be deleted");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!open) { request.current += 1; return; }
    const timer = setTimeout(() => void loadList(true), 0);
    return () => clearTimeout(timer);
    // Opening or changing collections is the operation boundary; queryClient is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.key, open]);

  useEffect(() => {
    if (!open || !playback.playing || slides.length === 0) return;
    const timer = setInterval(() => dispatch({ type: "tick", elapsedMs: 100, slideCount: slides.length }), 100);
    return () => clearInterval(timer);
  }, [open, playback.playing, slides.length]);

  useEffect(() => {
    if (!open) return;
    const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") dispatch({ type: "pause" }); });
    return () => subscription.remove();
  }, [open]);

  useEffect(() => subscribeAppEvent((event) => {
    if (!open || deleting || event.type !== "gallery.changed" || !["highlight.changed", "image.changed", "collection.content.changed"].includes(event.slug)) return;
    if (detail) void openHighlight(detail);
    else void loadList();
    // Event handlers intentionally reopen the latest key; operation functions are render-local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [collection.key, deleting, detail?.key, open]);

  useEffect(() => {
    if (!open) return;
    const urls = (detail ? resolveGalleryHighlightSlides(detail) : []).slice(playback.index, playback.index + 3).map(({ url }) => url);
    void Promise.allSettled(urls.map((url) => Image.prefetch(url)));
  }, [detail, open, playback.index]);

  useEffect(() => {
    if (!detail?.key) return;
    cubeDirection.value = playback.index < previousSlideIndex.current ? -1 : 1;
    previousSlideIndex.current = playback.index;
    cubeProgress.value = reducedMotion ? 1 : 0;
    if (!reducedMotion) cubeProgress.value = withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) });
  }, [cubeDirection, cubeProgress, detail?.key, playback.index, reducedMotion]);

  const cubeStyle = useAnimatedStyle(() => {
    const angle = interpolate(cubeProgress.value, [0, 1], [cubeDirection.value * 88, 0]);
    return {
      opacity: interpolate(cubeProgress.value, [0, 0.2, 1], [0.35, 1, 1]),
      transform: [{ perspective: 900 }, { rotateY: `${angle}deg` }, { scale: interpolate(cubeProgress.value, [0, 1], [0.94, 1]) }],
    };
  });

  const close = () => { request.current += 1; createRequest.current += 1; setDetail(undefined); setCreating(false); setDeleting(false); setActiveSheet("player"); dispatch({ type: "pause" }); onClose(); };
  const listFooter = <>{owner ? <Button disabled={creating || listLoading || opening} onPress={() => void createHighlight()} size="lg" variant="primary">Create</Button> : null}<Button disabled={creating} onPress={close} size="lg" variant="secondary">Close</Button></>;
  const playerFooter = <Button onPress={close} size="lg" variant="secondary">Close</Button>;

  return <>
    <BottomSheet footer={listFooter} height="full" onOpenChange={(next) => { if (!next) close(); }} open={open && !detail} title="Highlights">
      <ScrollView contentContainerStyle={[styles.grid, listEmpty && styles.emptyGrid]} onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} showsVerticalScrollIndicator={false}>
        {creating ? <View accessibilityLabel="Creating highlight" accessibilityRole="progressbar"><Skeleton style={[styles.cardFrame, { width: cardWidth, height: cardWidth * 16 / 9 }]} /></View> : null}
        {listLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.cardFrame, { width: cardWidth, height: cardWidth * 16 / 9 }]} />) : highlights.map((highlight) => <Button accessibilityLabel={`${highlight.title}, ${highlight.slideCount} slides`} contentMode="raw" disabled={opening} key={highlight.key} onPress={() => void openHighlight(highlight)} shape="rounded" size="xl" style={[styles.cardFrame, styles.card, { width: cardWidth, height: cardWidth * 16 / 9 }]} variant="ghost">
          {highlight.coverUrl ? <Image contentFit="cover" source={highlight.coverUrl} style={StyleSheet.absoluteFill} transition={180} /> : null}
          <View style={styles.cardShade} />
          <View style={styles.cardCopy}><Text numberOfLines={2} style={styles.title}>{highlight.title}</Text><Text style={styles.cardCount}>{highlight.slideCount} slide{highlight.slideCount === 1 ? "" : "s"}</Text></View>
        </Button>)}
        {listEmpty ? <Text style={styles.empty}>No highlights yet.</Text> : null}
      </ScrollView>
    </BottomSheet>

    <BottomSheet footer={playerFooter} height="full" onOpenChange={(next) => { if (!next) close(); }} open={open && Boolean(detail)} title={detail?.title ?? "Highlight"}>
      <View style={styles.player}>
        <View style={styles.detailMenuRow}>{owner ? <Button accessibilityLabel="Open highlight actions" contentMode="raw" onPress={() => { dispatch({ type: "pause" }); setActiveSheet("actions"); }} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}</View>
        <View style={styles.stage}>{activeSlide ? <Animated.View style={[styles.cubeFace, cubeStyle]}><Image contentFit="contain" source={activeSlide.url} style={styles.image} /></Animated.View> : <Text style={styles.empty}>This highlight has no available slides.</Text>}</View>
        <View accessibilityLabel={`Slide ${slides.length ? playback.index + 1 : 0} of ${slides.length}`} accessibilityRole="progressbar" style={styles.progress}>{slides.map((slide, index) => <View key={slide.key} style={styles.progressTrack}><View style={[styles.progressFill, { width: index < playback.index ? "100%" : index > playback.index ? "0%" : `${Math.min(100, playback.progressMs / HIGHLIGHT_SLIDE_DURATION_MS * 100)}%` }]} /></View>)}</View>
        <View style={styles.controls}>
          <Button accessibilityLabel="Previous slide" contentMode="raw" disabled={playback.index === 0 || slides.length === 0} onPress={() => dispatch({ type: "previous" })} size="md" variant="icon"><ChevronLeftIcon /></Button>
          <Button accessibilityLabel={playback.playing ? "Pause highlight" : "Play highlight"} contentMode="raw" disabled={slides.length === 0} onPress={() => dispatch(playback.playing ? { type: "pause" } : { type: "play", slideCount: slides.length })} size="lg" variant="primary">{playback.playing ? <PauseIcon variant="inverse" /> : <PlayIcon variant="inverse" />}</Button>
          <Button accessibilityLabel="Next slide" contentMode="raw" disabled={playback.index >= slides.length - 1 || slides.length === 0} onPress={() => dispatch({ type: "next", slideCount: slides.length })} size="md" variant="icon"><ChevronRightIcon /></Button>
        </View>
        <Text style={styles.count}>{slides.length} slide{slides.length === 1 ? "" : "s"}</Text>
      </View>
    </BottomSheet>

    <BottomSheet hideHeading onOpenChange={(next) => { if (!next) setActiveSheet("player"); }} open={open && Boolean(detail) && activeSheet === "actions"} title="Highlight actions">
      <View style={styles.actionMenu}><BottomSheetItem disabled={deleting} onPress={() => setActiveSheet("confirmDelete")} size="lg" variant="secondary">Delete highlight</BottomSheetItem></View>
    </BottomSheet>

    <BottomSheet dismissible={!deleting} hideHeading onOpenChange={(next) => { if (!next) setActiveSheet("actions"); }} open={open && Boolean(detail) && activeSheet === "confirmDelete"} title="Delete highlight?">
      <View style={styles.compactActions}><Button disabled={deleting} loading={deleting} onPress={() => void deleteHighlight()} size="lg" variant="primary">Delete</Button><Button disabled={deleting} onPress={() => setActiveSheet("actions")} size="lg" variant="secondary">Close</Button></View>
    </BottomSheet>
  </>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingVertical: spacing.md },
  emptyGrid: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  cardFrame: { overflow: "hidden", borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  card: { alignItems: "stretch", justifyContent: "flex-end", padding: 0 },
  cardShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.35)" },
  cardCopy: { marginTop: "auto", padding: 8, gap: 2 },
  title: { color: palette.silver50, fontFamily: fonts.semibold, fontSize: 12 },
  cardCount: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 10 },
  player: { flex: 1, paddingVertical: spacing.md, gap: 14 },
  detailMenuRow: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  stage: { flex: 1, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: palette.voidBlack },
  cubeFace: { width: "100%", height: "100%" },
  image: { width: "100%", height: "100%" },
  progress: { minHeight: 3, flexDirection: "row", gap: 4 },
  progressTrack: { flex: 1, height: 3, overflow: "hidden", borderRadius: 2, backgroundColor: palette.silver700 },
  progressFill: { height: "100%", backgroundColor: palette.silver50 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  count: { textAlign: "center", color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  actionMenu: { gap: spacing.sm },
  compactActions: { gap: spacing.sm },
  empty: { width: "100%", paddingVertical: spacing.md, textAlign: "center", color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
});
