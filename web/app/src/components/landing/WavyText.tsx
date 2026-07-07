"use client";

import { motion } from "framer-motion";
import { mulberry32 } from "@/lib/three/procedural";

/**
 * Subtle living type: each letter floats on its own gentle wave while a
 * chrome sheen travels through the gradient. The wave (and sheen) run
 * left-to-right or right-to-left — titles flow one way, subtitles the
 * other. Quiet, endless.
 *
 * With `eruptSeed` set, the letters arrive VOLCANICALLY: each one is
 * blasted up from below as scattered debris (random offset, rotation,
 * blur of pieces) and gets pulled into its place in the line — chaos
 * assembling into words. A new seed re-erupts the text.
 */
export function WavyText({
  text,
  direction = "ltr",
  className = "",
  letterClassName = "",
  eruptSeed,
}: {
  text: string;
  direction?: "ltr" | "rtl";
  className?: string;
  letterClassName?: string;
  /** Seed for the eruption scatter; omit for calm static entry. */
  eruptSeed?: number;
}) {
  const letters = Array.from(text);
  const count = letters.length;
  const random =
    eruptSeed !== undefined ? mulberry32(eruptSeed ^ 0x7e47) : null;
  return (
    <span className={`inline-block whitespace-pre ${className}`} aria-label={text}>
      {letters.map((letter, index) => {
        const order = direction === "ltr" ? index : count - 1 - index;
        const inner = (
          <span
            aria-hidden
            className={`chrome-text inline-block ${letterClassName}`}
            style={{
              animation:
                "wavy-float 3s ease-in-out infinite, chrome-sheen 7s linear infinite",
              animationDelay: `${order * 0.085}s, ${order * 0.085}s`,
            }}
          >
            {letter}
          </span>
        );
        if (!random) return <span key={index}>{inner}</span>;
        // Erupted debris: every letter gets its own launch scatter.
        const scatterX = (random() - 0.5) * 240;
        const scatterY = 90 + random() * 160;
        const scatterRotate = (random() - 0.5) * 320;
        const delay = 0.55 + random() * 0.75;
        return (
          <motion.span
            key={`${eruptSeed}-${index}`}
            className="inline-block"
            initial={{
              x: scatterX,
              y: scatterY,
              rotate: scatterRotate,
              scale: 0.4 + random() * 0.5,
              opacity: 0,
            }}
            animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }}
            transition={{
              delay,
              duration: 1.05,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {inner}
          </motion.span>
        );
      })}
    </span>
  );
}
