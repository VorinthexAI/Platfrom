import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../button/button.mobile";
import { Slider } from "../slider/slider.mobile";
import { SoundwaveIcon } from "../../icons/soundwave/soundwave.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { PauseIcon } from "../../icons/pause/pause.mobile";
import { PlayIcon } from "../../icons/play/play.mobile";
import { colors, radii, spacing } from "../../tokens";
import type { AudioPlaybackProps } from "./audio-playback.types";

export type { AudioPlaybackProps } from "./audio-playback.types";

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function AudioPlayback({ title, position, duration, playing, error, onToggle, onSeek, onClose }: AudioPlaybackProps) {
  const [scrubValue, setScrubValue] = useState<number>();
  const total = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const current = scrubValue ?? position;
  const elapsed = Number.isFinite(current) ? Math.max(0, Math.min(total, current)) : 0;
  return <View style={styles.root}>
    <View style={styles.artwork}><SoundwaveIcon size="hero" /></View>
    <View style={styles.player}>
      <View style={styles.heading}>
        <View style={styles.titleBlock}><Text numberOfLines={1} style={styles.title}>{title}</Text></View>
        <Button accessibilityLabel="Close audio player" contentMode="raw" onPress={onClose} size="xs" variant="icon"><CloseIcon size="sm" /></Button>
      </View>
      <View style={styles.controls}>
        <Button accessibilityLabel={playing ? "Pause listening" : "Play audio"} contentMode="raw" onPress={onToggle} size="sm" variant="icon">{playing ? <PauseIcon size="sm" /> : <PlayIcon size="sm" />}</Button>
        <Text style={styles.time}>{formatTime(elapsed)}</Text>
        <Slider accessibilityLabel="Audio progress" disabled={total <= 0} max={Math.max(1, total)} onSlidingComplete={(value) => { setScrubValue(value); void Promise.resolve(onSeek(value)).catch(() => undefined).finally(() => setScrubValue(undefined)); }} onValueChange={setScrubValue} style={styles.slider} value={elapsed} />
        <Text style={styles.time}>{formatTime(total)}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" numberOfLines={2} style={styles.error}>{error}</Text> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingBottom: spacing.md },
  artwork: { flex: 1, alignItems: "center", justifyContent: "center" },
  player: { marginHorizontal: spacing.md, marginBottom: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderRadius: radii.lg, borderColor: colors.hairline, borderWidth: 1, backgroundColor: colors.page },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  titleBlock: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 13, fontWeight: "500" },
  controls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  slider: { flex: 1 },
  time: { minWidth: 32, color: colors.muted, fontSize: 10, textAlign: "center" },
  error: { color: "#D98B8B", fontSize: 10, lineHeight: 14 },
});
