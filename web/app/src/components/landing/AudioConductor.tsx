"use client";

import { useEffect } from "react";
import { useAudioStore } from "@/lib/audio/audio-store";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Conducts foreground galaxy audio (no UI of its own):
 * - the mission voice never auto-plays; only the hunt biome's Briefing
 *   button starts it (via the store's toggleMission), and it never loops;
 * - entity briefings are always user-initiated;
 * - foreground audio stops when the visitor changes destination.
 */

export function AudioConductor() {
  const stopForegroundAudio = useAudioStore((s) => s.stopForegroundAudio);
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);

  // Foreground audio belongs to the current biome. Scrolling or leaving the
  // system must not let a briefing continue over the next destination.
  useEffect(() => {
    stopForegroundAudio();
  }, [mode, step, stopForegroundAudio]);

  return null;
}
