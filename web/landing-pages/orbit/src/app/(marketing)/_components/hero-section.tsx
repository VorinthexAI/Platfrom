"use client";

import { motion, type Variants } from "motion/react";

import { OrbitSceneLoader } from "./orbit-scene-loader";

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

export function HeroSection({
  onJoinWaitlist,
  onSignIn,
}: {
  onJoinWaitlist: () => void;
  onSignIn: () => void;
}) {
  return (
    <section id="top" className="relative overflow-hidden pt-40 pb-16 sm:pt-48">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_70%_20%,rgba(255,255,255,0.06),transparent)]" />

      <div className="cui-container grid items-center gap-16 lg:grid-cols-2">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.div variants={item}>
            <span className="cui-label inline-flex rounded-full border border-border px-3 py-1.5">
              Introducing Orbit
            </span>
          </motion.div>

          <motion.h1
            variants={item}
            className="mt-6 max-w-xl text-4xl leading-[1.08] font-normal text-foreground sm:text-5xl lg:text-[3.5rem]"
          >
            The operating system for your intelligence.
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-5 max-w-md text-base leading-7 text-foreground-secondary"
          >
            Orbit brings all your AI intelligences, data and workflows
            together in one beautiful, powerful and private workspace.
          </motion.p>

          <motion.div variants={item} className="mt-9 flex flex-wrap items-center gap-4">
            <motion.button
              type="button"
              onClick={onJoinWaitlist}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-button bg-accent px-6 text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Join Waitlist for Free
              <span aria-hidden="true">→</span>
            </motion.button>

            <motion.button
              type="button"
              onClick={onSignIn}
              whileHover={{ x: 2 }}
              transition={{ duration: 0.2 }}
              className="inline-flex cursor-pointer items-center gap-2.5 rounded-full text-sm text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border">
                <PlayGlyph />
              </span>
              See it in action
            </motion.button>
          </motion.div>

          <motion.p variants={item} className="mt-8 text-sm text-muted">
            Already have access?{" "}
            <button
              type="button"
              onClick={onSignIn}
              className="cursor-pointer rounded-sm text-foreground-secondary underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Sign in
            </button>
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          className="relative h-[360px] sm:h-[440px] lg:h-[520px]"
        >
          <OrbitSceneLoader className="absolute inset-0" />
        </motion.div>
      </div>
    </section>
  );
}

function PlayGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 1.8v8.4l7-4.2-7-4.2Z" fill="currentColor" />
    </svg>
  );
}
