import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { ArrowLeftIcon, ArrowRightIcon, PauseIcon, PlayIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";

import { createGalleryCollectionHighlight, fetchGalleryCollectionHighlight, getGalleryContext, listGalleryCollectionHighlights, resolveGalleryHighlightSlides, type GalleryCollection, type GalleryHighlight, type GalleryHighlightDetail } from "@/lib/gallery-client";
import { HIGHLIGHT_SLIDE_DURATION_MS, initialHighlightPlaybackState, reduceHighlightPlayback } from "@/lib/gallery-highlight-playback";
import { galleryQueryKeys } from "@/lib/workspace-query-cache";
import { subscribeAppEvent } from "@/lib/app-events";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type GalleryHighlightsProps = {
  collection: GalleryCollection;
  mode: "create" | "list";
  onClose: () => void;
  open: boolean;
};

const COLUMNS = 3;
const GAP = 8;

export function GalleryHighlights({ collection, mode, onClose, open }: GalleryHighlightsProps) {
  const queryClient = useQueryClient();
  const galleryContext = getGalleryContext();
  const { width } = useWindowDimensions();
  const [highlights, setHighlights] = useState<GalleryHighlight[]>([]);
  const [detail, setDetail] = useState<GalleryHighlightDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [playback, dispatch] = useReducer(reduceHighlightPlayback, initialHighlightPlaybackState);
  const request = useRef(0);
  const cardWidth = Math.floor((width - spacing.md * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const slides = detail ? resolveGalleryHighlightSlides(detail) : [];
  const activeSlide = slides[playback.index];

  async function loadList() {
    const generation = ++request.current;
    setLoading(true);
    setError(undefined);
    setDetail(undefined);
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), queryFn: () => listGalleryCollectionHighlights(collection.key), staleTime: 0 });
      if (generation === request.current) setHighlights(result.highlights);
    } catch (failure) {
      if (generation === request.current) setError(failure instanceof Error ? failure.message : "Highlights could not be loaded.");
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }

  async function openHighlight(highlight: GalleryHighlight) {
    const generation = ++request.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await queryClient.fetchQuery({ queryKey: galleryQueryKeys.highlight(galleryContext, collection.key, highlight.key), queryFn: () => fetchGalleryCollectionHighlight(highlight.key), staleTime: 0 });
      if (generation !== request.current) return;
      setDetail(result.highlight);
      dispatch({ type: "load", slideCount: resolveGalleryHighlightSlides(result.highlight).length, autoplay: true });
    } catch (failure) {
      if (generation === request.current) setError(failure instanceof Error ? failure.message : "The highlight could not be opened.");
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) { request.current += 1; setDetail(undefined); dispatch({ type: "pause" }); return; }
    let cancelled = false;
    setError(undefined);
    if (mode === "list") { void loadList(); return; }
    setLoading(true);
    void createGalleryCollectionHighlight(collection.key).then(async ({ highlight }) => {
      if (cancelled) return;
      queryClient.setQueryData(galleryQueryKeys.highlight(galleryContext, collection.key, highlight.key), { highlight });
      await queryClient.invalidateQueries({ queryKey: galleryQueryKeys.highlights(galleryContext, collection.key), exact: true, refetchType: "none" });
      if (cancelled) return;
      setDetail(highlight);
      dispatch({ type: "load", slideCount: resolveGalleryHighlightSlides(highlight).length, autoplay: true });
    }).catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "A highlight could not be created."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Opening or changing collections is the operation boundary; queryClient is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.key, mode, open]);

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
    if (!open || event.type === "gallery.changed" && !["highlight.changed", "image.changed", "collection.content.changed"].includes(event.slug)) return;
    if (detail) void openHighlight(detail);
    else void loadList();
  }), [collection.key, detail?.key, open]);

  useEffect(() => {
    if (!open) return;
    const urls = (detail ? resolveGalleryHighlightSlides(detail) : []).slice(playback.index, playback.index + 3).map(({ url }) => url);
    void Promise.allSettled(urls.map((url) => Image.prefetch(url)));
  }, [detail, open, playback.index]);

  const close = () => { request.current += 1; dispatch({ type: "pause" }); onClose(); };
  const back = detail ? <Button accessibilityLabel="Back to highlights" contentMode="raw" onPress={() => { setDetail(undefined); dispatch({ type: "pause" }); void loadList(); }} size="sm" variant="icon"><ArrowLeftIcon size="sm" /></Button> : undefined;

  return <BottomSheet headerLeading={back} height="full" onOpenChange={(next) => { if (!next) close(); }} open={open} title={detail?.title ?? (mode === "create" ? "Create highlight" : "Highlights")}>
    {loading ? <View accessibilityLabel="Loading highlights" accessibilityRole="progressbar" style={styles.loading}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={{ width: cardWidth, height: cardWidth * 16 / 9 }} />)}</View>
      : detail ? <View style={styles.player}>
        <View style={styles.stage}>{activeSlide ? <Image contentFit="contain" source={activeSlide.url} style={styles.image} /> : <Text style={styles.empty}>This highlight has no available slides.</Text>}</View>
        <View accessibilityLabel={`Slide ${slides.length ? playback.index + 1 : 0} of ${slides.length}`} accessibilityRole="progressbar" style={styles.progress}>{slides.map((slide, index) => <View key={slide.key} style={styles.progressTrack}><View style={[styles.progressFill, { width: index < playback.index ? "100%" : index > playback.index ? "0%" : `${Math.min(100, playback.progressMs / HIGHLIGHT_SLIDE_DURATION_MS * 100)}%` }]} /></View>)}</View>
        <View style={styles.controls}>
          <Button accessibilityLabel="Previous slide" contentMode="raw" disabled={playback.index === 0 || slides.length === 0} onPress={() => dispatch({ type: "previous" })} size="md" variant="icon"><ArrowLeftIcon /></Button>
          <Button accessibilityLabel={playback.playing ? "Pause highlight" : "Play highlight"} contentMode="raw" disabled={slides.length === 0} onPress={() => dispatch(playback.playing ? { type: "pause" } : { type: "play", slideCount: slides.length })} size="lg" variant="primary">{playback.playing ? <PauseIcon variant="inverse" /> : <PlayIcon variant="inverse" />}</Button>
          <Button accessibilityLabel="Next slide" contentMode="raw" disabled={playback.index >= slides.length - 1 || slides.length === 0} onPress={() => dispatch({ type: "next", slideCount: slides.length })} size="md" variant="icon"><ArrowRightIcon /></Button>
        </View>
        <Text style={styles.count}>{slides.length} slide{slides.length === 1 ? "" : "s"}</Text>
      </View> : <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {highlights.map((highlight) => <Button accessibilityLabel={`${highlight.title}, ${highlight.slideCount} slides`} contentMode="raw" key={highlight.key} onPress={() => void openHighlight(highlight)} shape="rounded" size="xl" style={[styles.card, { width: cardWidth, height: cardWidth * 16 / 9 }]} variant="ghost">
          {highlight.coverUrl ? <Image contentFit="cover" source={highlight.coverUrl} style={StyleSheet.absoluteFill} /> : null}
          <View style={styles.cardShade} />
          <View style={styles.cardCopy}><Text numberOfLines={2} style={styles.title}>{highlight.title}</Text><Text style={styles.cardCount}>{highlight.slideCount} slide{highlight.slideCount === 1 ? "" : "s"}</Text></View>
        </Button>)}
        {highlights.length === 0 && !error ? <Text style={styles.empty}>No highlights yet.</Text> : null}
      </ScrollView>}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  loading: { flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingVertical: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingVertical: spacing.md },
  card: { overflow: "hidden", alignItems: "stretch", justifyContent: "flex-end", padding: 0, borderWidth: 1, borderColor: palette.hairline, borderRadius: radii.lg, backgroundColor: palette.panelRaised },
  cardShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.35)" },
  cardCopy: { marginTop: "auto", padding: 8, gap: 2 },
  title: { color: palette.silver50, fontFamily: fonts.semibold, fontSize: 12 },
  cardCount: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 10 },
  player: { flex: 1, paddingVertical: spacing.md, gap: 14 },
  stage: { flex: 1, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: palette.voidBlack },
  image: { width: "100%", height: "100%" },
  progress: { minHeight: 3, flexDirection: "row", gap: 4 },
  progressTrack: { flex: 1, height: 3, overflow: "hidden", borderRadius: 2, backgroundColor: palette.silver700 },
  progressFill: { height: "100%", backgroundColor: palette.silver50 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  count: { textAlign: "center", color: palette.silver500, fontFamily: fonts.regular, fontSize: 12 },
  empty: { width: "100%", paddingVertical: spacing.md, textAlign: "center", color: palette.silver500, fontFamily: fonts.regular, fontSize: 13 },
  error: { paddingVertical: spacing.sm, color: palette.silver100, fontFamily: fonts.regular, fontSize: 13 },
});
