"use client";

import { useState } from "react";
import { Button } from "../button/button.web";
import { Slider } from "../slider/slider.web";
import { SoundwaveIcon } from "../../icons/soundwave/soundwave.web";
import { CloseIcon } from "../../icons/close/close.web";
import { PauseIcon } from "../../icons/pause/pause.web";
import { PlayIcon } from "../../icons/play/play.web";
import { colors, radii, spacing } from "../../tokens";
import type { AudioPlaybackProps } from "./audio-playback.types";

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function AudioPlayback({ title, position, duration, playing, error, onToggle, onSeek, onClose }: AudioPlaybackProps) {
  const [scrubValue, setScrubValue] = useState<number>();
  const total = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const current = scrubValue ?? position;
  const elapsed = Number.isFinite(current) ? Math.max(0, Math.min(total, current)) : 0;
  return <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingBottom: spacing.md }}>
    <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}><SoundwaveIcon size="hero" /></div>
    <div style={{ marginInline: spacing.md, marginBottom: spacing.xs, paddingInline: spacing.md, paddingBlock: spacing.sm, display: "flex", flexDirection: "column", gap: spacing.xs, borderRadius: radii.lg, border: `1px solid ${colors.hairline}`, background: colors.page }}>
      <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: colors.text, fontSize: 13, fontWeight: 500 }}>{title}</span><Button aria-label="Close audio player" onClick={onClose} size="xs" variant="icon"><CloseIcon size="sm" /></Button></div>
      <div style={{ display: "flex", alignItems: "center", gap: spacing.xs }}>
        <Button aria-label={playing ? "Pause listening" : "Play audio"} onClick={onToggle} size="sm" variant="icon">{playing ? <PauseIcon size="sm" /> : <PlayIcon size="sm" />}</Button>
        <span style={{ minWidth: 32, color: colors.muted, fontSize: 10, textAlign: "center" }}>{formatTime(elapsed)}</span>
        <Slider aria-label="Audio progress" disabled={total <= 0} max={Math.max(1, total)} onValueChange={([value]) => setScrubValue(value)} onValueCommit={([value]) => { if (value === undefined) return; setScrubValue(value); void Promise.resolve(onSeek(value)).catch(() => undefined).finally(() => setScrubValue(undefined)); }} style={{ flex: 1 }} value={[elapsed]} />
        <span style={{ minWidth: 32, color: colors.muted, fontSize: 10, textAlign: "center" }}>{formatTime(total)}</span>
      </div>
      {error ? <span role="alert" style={{ color: "#D98B8B", fontSize: 10, lineHeight: "14px" }}>{error}</span> : null}
    </div>
  </div>;
}
