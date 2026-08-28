import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { PlayIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ChapterCard, Cover, Reader } from "@/components/capability/AscendWorkspace";
import { pauseOwnedPlayer } from "@/lib/audio-player-lifecycle";
import { BOOK_AUDIO_MODE, clampBookSeek } from "@/lib/book-audio";
import { useBookPlayback } from "@/lib/book-playback";
import { BookClientError, fetchPublicBookShare, publicBookShareReadRequestSchema, type BookChapter, type BookDetail } from "@/lib/books-client";
import { subscribePublicBookShareAccess } from "@/lib/public-book-share-stream";
import { fonts, palette, spacing } from "@/theme/tokens";

const COLUMNS = 3;
const GRID_GAP = 8;
const UNAVAILABLE = "This shared audio book is no longer available.";

function isUnavailable(error: unknown) {
  return error instanceof BookClientError && (error.status !== undefined && [400, 401, 403, 404, 410].includes(error.status) || /(?:SHARE.*(?:INACTIVE|NOT_FOUND|INVALID|REVOKED)|NOT_FOUND)/i.test(error.code));
}

export default function PublicBookShareRoute() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const tokenResult = publicBookShareReadRequestSchema.shape.token.safeParse(Array.isArray(params.token) ? params.token[0] : params.token);
  const token = tokenResult.success ? tokenResult.data : undefined;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [detail, setDetail] = useState<BookDetail>();
  const [chapterKey, setChapterKey] = useState<string>();
  const [readerOpen, setReaderOpen] = useState(false);
  const [loading, setLoading] = useState(Boolean(token));
  const [unavailable, setUnavailable] = useState(!token);
  const [error, setError] = useState<string>();
  const [gridWidth, setGridWidth] = useState(0);
  const requestGeneration = useRef(0);
  const authenticatedPlayback = useBookPlayback();
  const pendingPlayback = useRef<{ autoplay: boolean; seek: number } | undefined>(undefined);
  const player = useAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true });
  const audio = useAudioPlayerStatus(player);
  const chapters = [...(detail?.chapters ?? [])].sort((left, right) => left.position - right.position);
  const playable = chapters.filter((chapter) => chapter.content && chapter.audioUrl);
  const chapterIndex = playable.findIndex(({ key }) => key === chapterKey);
  const chapter = chapterIndex >= 0 ? playable[chapterIndex] : undefined;
  const cardWidth = Math.floor(((gridWidth || width - spacing.md * 2) - GRID_GAP * (COLUMNS - 1)) / COLUMNS);

  function clearAudio() {
    pendingPlayback.current = undefined;
    pauseOwnedPlayer(player);
    player.replace(null);
    player.clearLockScreenControls();
    setChapterKey(undefined);
    setReaderOpen(false);
  }

  function revokeAccess() {
    requestGeneration.current += 1;
    clearAudio();
    setDetail(undefined);
    setLoading(false);
    setError(undefined);
    setUnavailable(true);
  }

  async function load() {
    if (!token) { revokeAccess(); return; }
    const request = ++requestGeneration.current;
    setLoading(true);
    setError(undefined);
    try {
      const next = await fetchPublicBookShare(token);
      if (request !== requestGeneration.current) return;
      setDetail(next);
      setUnavailable(false);
    } catch (failure) {
      if (request !== requestGeneration.current) return;
      if (isUnavailable(failure)) revokeAccess();
      else setError("The shared audio book could not be loaded.");
    } finally {
      if (request === requestGeneration.current) setLoading(false);
    }
  }

  function playChapter(next: BookChapter, autoplay = true, seek = 0) {
    if (!next.audioUrl) return;
    setChapterKey(next.key);
    setReaderOpen(true);
    pendingPlayback.current = { autoplay, seek };
    player.replace(next.audioUrl);
  }

  const loadEvent = useEffectEvent(load);
  const revokeAccessEvent = useEffectEvent(revokeAccess);
  const clearAuthenticatedPlaybackEvent = useEffectEvent(() => authenticatedPlayback.clear());
  const playChapterEvent = useEffectEvent(playChapter);
  const advanceChapterEvent = useEffectEvent(() => {
    if (chapterIndex < 0) return;
    const next = playable[chapterIndex + 1];
    if (next) playChapterEvent(next);
  });

  useEffect(() => { void setAudioModeAsync(BOOK_AUDIO_MODE).catch(() => setError("Audio could not be initialized.")); }, []);
  useEffect(() => {
    if (!audio.isLoaded || !pendingPlayback.current) return;
    const pending = pendingPlayback.current;
    pendingPlayback.current = undefined;
    void player.seekTo(clampBookSeek(pending.seek, audio.duration)).then(() => { if (pending.autoplay) player.play(); });
  }, [audio.isLoaded, audio.duration, player]);
  useEffect(() => {
    if (!audio.didJustFinish) return;
    const timer = setTimeout(() => advanceChapterEvent(), 0);
    return () => clearTimeout(timer);
  }, [audio.didJustFinish]);
  useEffect(() => {
    if (!detail || !chapter) return;
    player.setActiveForLockScreen(true, { title: chapter.title, artist: "Vorinthex Ascend", albumTitle: detail.book.title, ...(detail.book.coverUrl ? { artworkUrl: detail.book.coverUrl } : {}) }, { showSeekBackward: true, showSeekForward: true });
  }, [chapter, detail, player]);
  useEffect(() => {
    clearAuthenticatedPlaybackEvent();
    if (!token) {
      const timer = setTimeout(() => revokeAccessEvent(), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => void loadEvent(), 0);
    const unsubscribe = subscribePublicBookShareAccess(token, (status) => { if (status === "inactive") revokeAccessEvent(); });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [token]);
  useEffect(() => () => {
    requestGeneration.current += 1;
    pendingPlayback.current = undefined;
    pauseOwnedPlayer(player);
    player.replace(null);
    player.clearLockScreenControls();
  }, [player]);

  if (!token || unavailable) return <View style={[styles.state, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><Text accessibilityRole="alert" style={styles.stateText}>{UNAVAILABLE}</Text></View>;
  if (loading && !detail) return <View accessibilityLabel="Loading shared audio book" accessibilityRole="progressbar" style={[styles.loading, { paddingTop: insets.top + spacing.lg }]}><Skeleton style={styles.heroSkeleton} /><View style={styles.skeletonGrid}>{Array.from({ length: COLUMNS }, (_, index) => <Skeleton key={index} style={{ width: cardWidth, height: cardWidth * 16 / 9 }} />)}</View></View>;
  if (error && !detail) return <View style={[styles.state, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><Text accessibilityRole="alert" style={styles.stateText}>{error}</Text><Button onPress={() => void load()} size="md" variant="primary">Retry</Button></View>;
  if (!detail) return null;

  if (readerOpen && chapter) return <View style={[styles.readerPage, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}><Text style={styles.readerTitle}>{chapter.title}</Text><Reader chapter={chapter} /><Button onPress={() => { pauseOwnedPlayer(player); setReaderOpen(false); }} size="md" variant="secondary">Close</Button></View>;

  const current = chapters.find(({ key }) => key === detail.book.currentChapterKey);
  const first = current && current.audioUrl && current.content ? current : playable.find(({ isCompleted }) => !isCompleted) ?? playable[0];
  return <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xl }]} showsVerticalScrollIndicator={false}>
    <View style={styles.hero}><Cover book={detail.book} /><View style={styles.heroShade} /><View style={styles.heroCopy}><Text style={styles.title}>{detail.book.title}</Text>{current ? <><Text style={styles.currentLabel}>CURRENT CHAPTER</Text><Text style={styles.currentChapter}>{current.title}</Text></> : null}<Text style={styles.meta}>{detail.book.narrator?.name ?? "Narrator"} · {detail.book.estimatedMinutes} min</Text><Text style={styles.meta}>{Math.round(detail.book.progressPercent)}% complete</Text><Button disabled={!first} icon={<PlayIcon size="sm" variant="inverse" />} onPress={() => { if (first) playChapter(first); }} size="md" variant="primary">{detail.book.progressPercent ? "Resume" : "Play"}</Button></View></View>
    {error ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.noticeText}>{error}</Text><Button onPress={() => setError(undefined)} size="md" variant="secondary">Close</Button></View> : null}
    <View onLayout={({ nativeEvent }) => setGridWidth(nativeEvent.layout.width)} style={styles.grid}>{chapters.map((item) => <ChapterCard chapter={item} key={item.key} onPress={item.content && item.audioUrl ? () => playChapter(item) : undefined} reducedMotion width={cardWidth} />)}</View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, gap: spacing.lg, paddingHorizontal: spacing.md, backgroundColor: palette.page },
  hero: { position: "relative", minHeight: 320, marginHorizontal: -spacing.md, overflow: "hidden", justifyContent: "flex-end" },
  heroShade: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0, 0, 0, 0.58)" },
  heroCopy: { width: "100%", alignItems: "flex-start", gap: spacing.xs, padding: spacing.md, paddingTop: spacing.xl },
  title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 26, lineHeight: 31 },
  currentLabel: { marginTop: spacing.xs, color: palette.silver300, fontFamily: fonts.medium, fontSize: 8, letterSpacing: 1 },
  currentChapter: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  meta: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 11 },
  grid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  state: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl, backgroundColor: palette.page },
  stateText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  loading: { flex: 1, gap: spacing.lg, paddingHorizontal: spacing.md, backgroundColor: palette.page },
  heroSkeleton: { width: "100%", height: 320 },
  skeletonGrid: { flexDirection: "row", gap: GRID_GAP },
  notice: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  noticeText: { flex: 1, color: palette.danger, fontFamily: fonts.medium, fontSize: 12 },
  readerPage: { flex: 1, gap: spacing.md, paddingHorizontal: spacing.md, backgroundColor: palette.page },
  readerTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 20, lineHeight: 26 },
});
