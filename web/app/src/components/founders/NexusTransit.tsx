"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";

interface NexusTransitProps {
  destination: string;
  reducedMotion: boolean;
  onComplete: () => void;
}

export function NexusTransit({ destination, reducedMotion, onComplete }: NexusTransitProps) {
  useEffect(() => {
    const timer = window.setTimeout(onComplete, reducedMotion ? 180 : 2400);
    return () => window.clearTimeout(timer);
  }, [onComplete, reducedMotion]);

  return (
    <motion.div
      className="absolute inset-0 z-50 overflow-hidden bg-[#020406]"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.12 : 0.65 }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {!reducedMotion ? (
        <div className="absolute top-1/2 left-1/2 h-0 w-0">
          {Array.from({ length: 42 }, (_, index) => {
            const angle = index * 137.508;
            const delay = (index % 9) * 0.055;
            const width = 12 + index % 7 * 4;
            return (
              <motion.span
                key={index}
                className="absolute top-0 left-0 h-px origin-left bg-gradient-to-r from-transparent via-[#d9873b] to-[#f5e4cb]"
                style={{ width: `${width}vw`, rotate: `${angle}deg` }}
                initial={{ scaleX: 0.05, opacity: 0 }}
                animate={{ scaleX: [0.05, 0.8, 2.8], opacity: [0, 0.72, 0] }}
                transition={{ duration: 1.25, delay, repeat: Infinity, ease: [0.22, 0.8, 0.28, 1] }}
              />
            );
          })}
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-[14%] text-center">
        <p className="font-mono text-[0.52rem] tracking-[0.42em] text-[#b47b4f] uppercase">Nexus transit</p>
        <p className="mt-2 text-sm tracking-[0.2em] text-silver-100 uppercase">{destination}</p>
        <motion.div className="mx-auto mt-4 h-px w-32 origin-left bg-gradient-to-r from-[#a65320] to-[#f1c18d]" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reducedMotion ? 0.12 : 2.1, ease: "easeInOut" }} />
      </div>
    </motion.div>
  );
}
