import { usePathname, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";
import { PauseIcon, PlayIcon } from "@vorinthex/shared/ui/icons-mobile";

import { useBookPlayback } from "@/lib/book-playback";
import { palette, radii, spacing, fonts } from "@/theme/tokens";

export function BookMiniPlayer() {
  const playback = useBookPlayback();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!playback.detail || !playback.chapter) return null;
  const open = () => {
    playback.requestReader();
    if (pathname !== "/capability/ascend") router.replace("/capability/ascend");
  };
  return <View accessibilityLabel={`Now playing ${playback.chapter.title} from ${playback.detail.book.title}`} style={[styles.root, { bottom: Math.max(insets.bottom, spacing.sm) + 70 }]}>
    <Button accessibilityLabel="Open full reader" contentMode="raw" onPress={open} size="sm" style={styles.main} variant="ghost"><View style={styles.copy}><Text numberOfLines={1} style={styles.chapter}>{playback.chapter.title}</Text><Text numberOfLines={1} style={styles.book}>{playback.detail.book.title}{playback.audio.isBuffering ? " · Buffering" : playback.error || playback.audio.error ? " · Audio error" : ""}</Text></View></Button>
    <Button accessibilityLabel={playback.audio.playing ? "Pause audiobook" : "Play audiobook"} contentMode="raw" disabled={Boolean(playback.error) || !playback.chapter.audioUrl} onPress={() => void playback.toggle()} size="sm" variant="primary">{playback.audio.playing ? <PauseIcon size="sm" variant="inverse" /> : <PlayIcon size="sm" variant="inverse" />}</Button>
  </View>;
}

const styles = StyleSheet.create({
  root: { position: "absolute", right: spacing.md, left: spacing.md, minHeight: 58, padding: spacing.xs, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: 1, borderColor: palette.hairlineBright, borderRadius: radii.lg, backgroundColor: palette.panelRaised, zIndex: 20 },
  main: { minWidth: 0, flex: 1, height: 48, justifyContent: "flex-start", paddingHorizontal: spacing.xs, paddingVertical: 0 },
  copy: { minWidth: 0, flex: 1, alignItems: "flex-start" },
  chapter: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  book: { marginTop: 2, color: palette.silver500, fontFamily: fonts.regular, fontSize: 10 },
});
