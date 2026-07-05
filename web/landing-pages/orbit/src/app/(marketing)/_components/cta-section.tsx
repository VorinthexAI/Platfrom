"use client";

import { motion } from "motion/react";

import { Reveal } from "./reveal";

export function CtaSection({ onJoinWaitlist }: { onJoinWaitlist: () => void }) {
  return (
    <section className="pb-24 sm:pb-32">
      <div className="cui-container">
        <Reveal
          as="section"
          className="rounded-dialog border border-border bg-secondary px-6 py-16 text-center sm:px-12 sm:py-20"
        >
          <h2 className="text-3xl font-normal text-foreground sm:text-4xl">
            Be the first to experience Orbit.
          </h2>

          <motion.button
            type="button"
            onClick={onJoinWaitlist}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mt-8 inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-button bg-accent px-6 text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-secondary"
          >
            Join Waitlist for Free
            <span aria-hidden="true">→</span>
          </motion.button>

          <p className="mt-5 text-sm text-muted">
            No credit card. No spam. Just early access.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
