"use client";

import { motion } from "motion/react";

export function SignInTriggerPill({ onOpen }: { onOpen: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 1, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className="fixed bottom-6 left-1/2 z-40 hidden -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full border border-border bg-secondary/80 px-4 py-2 text-xs text-foreground-secondary backdrop-blur-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex"
    >
      Psst&hellip; access the orbit
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current opacity-70" />
    </motion.button>
  );
}
