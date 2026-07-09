"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveStore } from "@/lib/live/live-store";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Big, live collector counter under the hero — every digit rolls into
 * place as new collectors join The Hunt, streamed over SSE in real time.
 */
export function WaitlistLiveCounter() {
  const atOverview = useGalaxyStore(
    (s) => s.step === 0 && s.mode === "system",
  );
  const count = useLiveStore((s) => s.waitlistCount);
  const ensureConnected = useLiveStore((s) => s.ensureConnected);

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  // A tiny number undermines the social proof — stay hidden until The
  // Hunt is past 10 collectors.
  if (count <= 10) return null;

  return (
    <div
      className={`mt-10 transition-opacity duration-700 ${
        atOverview ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-live="polite"
    >
      <div className="flex items-baseline gap-3">
        <RollingNumber value={count} />
        <span className="font-mono text-[0.6rem] tracking-[0.28em] text-silver-300 uppercase">
          collectors already hunting intelligence fragments
        </span>
      </div>
      <p className="mt-2 font-mono text-[0.55rem] tracking-[0.22em] text-silver-500 uppercase">
        The Hunt is gaining momentum — join now to keep up
      </p>
    </div>
  );
}

/** Odometer-style digits: each changed digit rolls in from below. */
function RollingNumber({ value }: { value: number }) {
  const chars = value.toLocaleString("en-US").split("");
  return (
    <span className="chrome-text flex text-4xl font-extralight tracking-[0.06em] tabular-nums sm:text-5xl">
      {chars.map((char, index) => (
        <span
          key={`${index}-${chars.length}`}
          className="relative inline-block overflow-hidden"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={char}
              initial={{ y: "0.9em", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "-0.9em", opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="inline-block"
            >
              {char}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
