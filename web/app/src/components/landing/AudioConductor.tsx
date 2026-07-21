"use client";

import { useEffect } from "react";
import { useAudioStore } from "@/lib/audio/audio-store";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Conducts the galaxy's soundtrack (no UI of its own):
 * - the mission voice never auto-plays; only the hunt biome's Briefing
 *   button starts it (via the store's toggleMission), and it never loops;
 * - the master-brand ambient bed starts on the very first interaction
 *   (scroll, tap, click, or key) and loops subtly forever;
 * - entity briefings are always user-initiated, so entering a biome never
 *   interrupts the normal ambient bed.
 */

const FIRST_INTERACTION_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

export function AudioConductor() {
  const resumePending = useAudioStore((s) => s.resumePending);
  const startAmbient = useAudioStore((s) => s.startAmbient);
  const ambientStarted = useAudioStore((s) => s.ambientStarted);
  const stopForegroundAudio = useAudioStore((s) => s.stopForegroundAudio);
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);

  // The first gesture starts the ambient bed and releases whatever
  // autoplay held back. Listeners stay attached until a gesture the
  // browser accepts actually starts playback.
  useEffect(() => {
    if (ambientStarted) return;
    const release = () => {
      startAmbient();
      resumePending();
    };
    for (const event of FIRST_INTERACTION_EVENTS) {
      window.addEventListener(event, release, { passive: true });
    }
    return () => {
      for (const event of FIRST_INTERACTION_EVENTS) {
        window.removeEventListener(event, release);
      }
    };
  }, [ambientStarted, startAmbient, resumePending]);

  // Foreground audio belongs to the current biome. Scrolling or leaving the
  // system must not let a briefing continue over the next destination.
  useEffect(() => {
    stopForegroundAudio();
  }, [mode, step, stopForegroundAudio]);

  return null;
}
