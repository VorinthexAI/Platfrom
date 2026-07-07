"use client";

import { useEffect } from "react";
import { entityAudioUrl, useAudioStore } from "@/lib/audio/audio-store";
import { getEntityById } from "@/lib/galaxy/registry-helpers";
import { ORBIT_STEPS, useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Conducts the galaxy's soundtrack (no UI of its own):
 * - the mission music plays only on request — the "Hear the Mission"
 *   CTA in the header — then loops quietly underneath everything;
 * - every voiced world (product, orchestrator, capability) speaks its
 *   line the moment its biome is entered, ducking the music while it
 *   talks; leaving the biome cuts it off.
 */

const VOICED_TYPES = new Set(["product", "orchestrator", "capability"]);

export function AudioConductor() {
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const playVoice = useAudioStore((s) => s.playVoice);
  const stopVoice = useAudioStore((s) => s.stopVoice);
  const resumePending = useAudioStore((s) => s.resumePending);

  // The first gesture releases whatever autoplay held back.
  useEffect(() => {
    const release = () => resumePending();
    window.addEventListener("pointerdown", release);
    window.addEventListener("keydown", release);
    return () => {
      window.removeEventListener("pointerdown", release);
      window.removeEventListener("keydown", release);
    };
  }, [resumePending]);

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
