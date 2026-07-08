"use client";

import { useEffect } from "react";
import { entityAudioUrl, useAudioStore } from "@/lib/audio/audio-store";
import { getEntityById } from "@/lib/galaxy/registry-helpers";
import { ORBIT_STEPS, useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Conducts the galaxy's soundtrack (no UI of its own):
 * - the mission voice never auto-plays; only the hunt biome's Briefing
 *   button starts it (via the store's toggleMission), and it never loops;
 * - the master-brand ambient bed starts on the very first interaction
 *   (scroll, tap, click, or key) and loops subtly forever;
 * - every voiced world (product, orchestrator, capability) speaks its
 *   line the moment its biome is entered, ducking the ambient while it
 *   talks and pausing for the mission; leaving the biome cuts it off.
 */

const VOICED_TYPES = new Set(["product", "orchestrator", "capability"]);

const FIRST_INTERACTION_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

export function AudioConductor() {
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const playVoice = useAudioStore((s) => s.playVoice);
  const stopVoice = useAudioStore((s) => s.stopVoice);
  const resumePending = useAudioStore((s) => s.resumePending);
  const startAmbient = useAudioStore((s) => s.startAmbient);
  const ambientStarted = useAudioStore((s) => s.ambientStarted);

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

  // Each voiced world speaks on biome entry; leaving cuts it off.
  const inside = mode === "system" && step > 0 && visitPhase === "inside";
  const entityId = inside ? (ORBIT_STEPS[step]?.entityId ?? null) : null;
  useEffect(() => {
    if (!entityId) {
      stopVoice();
      return;
    }
    const entity = getEntityById(entityId);
    if (!entity || !VOICED_TYPES.has(entity.type)) return;
    playVoice(entityAudioUrl(entity.type, entity.slug));
    // visitSeed keys the replay: re-entering the same world speaks again.
  }, [entityId, visitSeed, playVoice, stopVoice]);

  return null;
}
