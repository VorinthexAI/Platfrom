"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Direct slide-up entrance for cave cards: no shatter, no wait — the card
 * just rises into place the instant the biome is ready. When a biome
 * holds several cards, pass each one's position via `index` so they
 * cascade in 0.2s apart (card 1 @ 0s, card 2 @ 0.2s, ...) instead of
 * landing all at once.
 */
export function SlideUpCard({
  index = 0,
  className,
  style,
  children,
}: {
  index?: number;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      style={style}
      initial={reducedMotion ? { opacity: 0 } : { y: 36, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{
        delay: index * 0.2,
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
