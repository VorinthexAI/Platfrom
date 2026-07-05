"use client";

import { motion } from "motion/react";

import { Avatar } from "@vorinthex/shared/ui";

import { PlanetCurve } from "./planet-curve";
import { Reveal } from "./reveal";

export function TestimonialSection() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <PlanetCurve className="inset-0" />

      <div className="cui-container relative grid items-center gap-16 lg:grid-cols-[1.3fr_1fr]">
        <Reveal>
          <p className="max-w-xl text-2xl leading-snug font-normal text-foreground sm:text-3xl">
            &ldquo;Orbit changed the way we work. It&rsquo;s like having a
            team of experts, available 24/7.&rdquo;
          </p>

          <div className="mt-8 flex items-center gap-3">
            <Avatar alt="Sarah Chen" fallback="SC" />
            <div>
              <p className="text-sm font-medium text-foreground">Sarah Chen</p>
              <p className="text-sm text-muted">Head of Growth, Future Labs</p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1} className="flex flex-col items-center gap-4 justify-self-center">
          <motion.button
            type="button"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-border bg-secondary/60 backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Watch the film"
          >
            <PlayGlyph />
          </motion.button>
          <span className="cui-label">Watch the film</span>
        </Reveal>
      </div>
    </section>
  );
}

function PlayGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 2.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </svg>
  );
}
