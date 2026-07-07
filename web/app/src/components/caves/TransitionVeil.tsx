"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Smooth surface punch-through: instead of a white flash, a soft obsidian
 * veil closes as the camera meets the rock (0.28s), the teleport happens
 * in the dark, and the veil lifts gently inside the chamber. Shared by
 * asteroid caves and world visits.
 */
export function TransitionVeil() {
  const mode = useGalaxyStore((s) => s.mode);
  const cavePhase = useGalaxyStore((s) => s.cavePhase);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const arriveInside = useGalaxyStore((s) => s.arriveInside);

  const kind: "cave" | "visit" | null =
    mode === "cave" ? "cave" : mode === "system" ? "visit" : null;
  const entering =
    kind === "cave"
      ? cavePhase === "enter"
      : kind === "visit"
        ? visitPhase === "enter"
        : false;

  // Backstop: if the closing animation is ever suppressed (exotic
  // environments, frozen compositors), arrival still happens.
  useEffect(() => {
    if (!entering || !kind) return;
    const timer = setTimeout(() => {
      const state = useGalaxyStore.getState();
      const phase = kind === "cave" ? state.cavePhase : state.visitPhase;
      if (phase === "enter") arriveInside(kind);
    }, 700);
    return () => clearTimeout(timer);
  }, [entering, kind, arriveInside]);

  return (
    <AnimatePresence>
      {entering && kind ? (
        <motion.div
          key={`veil-${kind}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.7, ease: "easeOut" } }}
          transition={{ duration: 0.28, ease: "easeIn" }}
          onAnimationComplete={() => {
            // Only the closing animation hands over; the exit fade doesn't.
            const state = useGalaxyStore.getState();
            const phase = kind === "cave" ? state.cavePhase : state.visitPhase;
            if (phase === "enter") arriveInside(kind);
          }}
          className="pointer-events-none absolute inset-0 z-40 bg-obsidian-990"
        />
      ) : null}
    </AnimatePresence>
  );
}
