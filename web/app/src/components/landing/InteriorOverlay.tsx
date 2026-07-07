"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { getEntityById } from "@/lib/galaxy/registry-helpers";
import { ORBIT_STEPS, useGalaxyStore } from "@/lib/galaxy-store";
import { WavyText } from "./WavyText";

/**
 * Screen-space layer shown while inside a world. The entity's logo floats in
 * 3D at the chamber's heart; this overlay carries its clear name and subtitle.
 */

function displayName(entity: GalaxyEntity): string {
  if (entity.type === "orchestrator") {
    return `${entity.name}${entity.role ? ` ${entity.role}` : ""} Agent`;
  }
  if (entity.type === "capability") {
    return `${entity.name} AI Brain Capability`;
  }
  return entity.name;
}

function displaySubtitle(entity: GalaxyEntity): string {
  return (
    entity.label ??
    entity.tagline ??
    entity.fullTitle ??
    entity.shortDescription
  );
}

export function InteriorOverlay() {
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const beginEnter = useGalaxyStore((s) => s.beginEnter);

  useEffect(() => {
    if (mode !== "system" || step === 0 || visitPhase !== "fly") return;
    const timer = setTimeout(() => beginEnter("visit"), 4500);
    return () => clearTimeout(timer);
  }, [mode, step, visitPhase, beginEnter]);

  const inside = mode === "system" && step > 0 && visitPhase === "inside";
  const entityId = ORBIT_STEPS[step]?.entityId;
  const entity = entityId ? getEntityById(entityId) : undefined;

  return (
    <AnimatePresence>
      {inside && entity ? (
        <motion.div
          key={`${entity.id}-${visitSeed}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.8, delay: 0.4 } }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          className="pointer-events-none absolute inset-0 z-20"
        >
          <div className="absolute inset-x-0 top-[60%] flex flex-col items-center gap-2 px-4 text-center">
            <h2 className="text-2xl font-light tracking-[0.14em] uppercase sm:text-3xl">
              <WavyText
                text={displayName(entity)}
                direction="ltr"
                eruptSeed={visitSeed}
              />
            </h2>
            <p className="font-mono text-[0.6rem] tracking-[0.24em] uppercase sm:text-[0.68rem]">
              <WavyText
                text={displaySubtitle(entity)}
                direction="rtl"
                eruptSeed={visitSeed ^ 0x515}
              />
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
