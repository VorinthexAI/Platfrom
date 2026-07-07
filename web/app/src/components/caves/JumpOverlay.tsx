"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useGalaxyStore } from "@/lib/galaxy-store";

const JUMP_DURATION_MS = 1600;

/**
 * DOM side of the hyper jump: while the in-canvas streak tunnel fires,
 * this ramps a white-out and then routes into /galaxy/private (members)
 * or /galaxy/public (verified explorers).
 */
export function JumpOverlay() {
  const mode = useGalaxyStore((s) => s.mode);
  const jumpTarget = useGalaxyStore((s) => s.jumpTarget);
  const router = useRouter();

  useEffect(() => {
    if (mode !== "jump" || !jumpTarget) return;
    const timer = setTimeout(() => {
      router.push(jumpTarget === "private" ? "/galaxy/private" : "/galaxy/public");
    }, JUMP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [mode, jumpTarget, router]);

  return (
    <AnimatePresence>
      {mode === "jump" ? (
        <motion.div
          key="jump-flash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: JUMP_DURATION_MS / 1000, ease: [0.7, 0, 1, 1] }}
          className="pointer-events-none absolute inset-0 z-50 bg-silver-50"
        />
      ) : null}
    </AnimatePresence>
  );
}
