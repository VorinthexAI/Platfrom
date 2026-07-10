"use client";

import { useEffect, useRef } from "react";
import { Button } from "@vorinthex/shared/ui/components";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import { galaxyMotion, useGalaxyStore } from "@/lib/galaxy-store";
import { trackCtaClick } from "@/lib/analytics";
import { useAuthProfile } from "@/lib/auth/use-auth-profile";
import { OpenModalButton } from "./OpenModalButton";

const nexusContent = VORINTHEX_GALAXY_REGISTRY.nexus.content;

/** Below this the wrapper stops taking clicks — the copy is fading out. */
const POINTER_CUTOFF = 0.4;
/** rad/s where the fade begins; below this the hero is fully solid. */
const FADE_START = 0.15;
/** rad/s where the fade completes; at/above this the hero is gone. */
const FADE_END = 0.9;
/** Exponential damping so the fade-in trails the spin-down. */
const DAMP_K = 4;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Hero copy layered over the galaxy — registry-driven, visible on the
 * Nexus overview, stepping aside once the user glides into an orbit.
 * Server-rendered into the initial HTML so crawlers always see it.
 */
export function HeroContent() {
  const atOverview = useGalaxyStore(
    (s) => s.step === 0 && s.mode === "system",
  );
  const startJump = useGalaxyStore((s) => s.startJump);
  const { signedIn } = useAuthProfile();
  const [headlineTop, headlineRest] = splitHeadline(
    nexusContent?.headline ?? "The Nexus of Intelligence",
  );

  // §11: the title + CTAs dissolve while the solar system spins fast and
  // fade back in as it slows. We drive opacity DIRECTLY on the wrapper via
  // a rAF loop (never per-frame React state) and let it nest inside the
  // atOverview fade so the two opacities multiply instead of fighting.
  const fadeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = fadeRef.current;
    if (!el) return;
    let raf = 0;
    let last = performance.now();
    let opacity = 1;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      // A live drag counts as full-speed spin; otherwise read the leftover
      // free-orbit velocity the drag released.
      const velocity = galaxyMotion.dragging
        ? Number.POSITIVE_INFINITY
        : Math.abs(galaxyMotion.orbitVelocity);
      const target = clamp01(
        1 - (velocity - FADE_START) / (FADE_END - FADE_START),
      );
      opacity += (target - opacity) * (1 - Math.exp(-DAMP_K * dt));
      el.style.opacity = opacity.toFixed(3);
      el.style.pointerEvents = opacity < POINTER_CUTOFF ? "none" : "";
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-10 transition-opacity duration-700 ${
        atOverview ? "" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="mx-auto w-full max-w-7xl px-5 pt-36 sm:px-10 sm:pt-32">
        <div ref={fadeRef} className="max-w-xl">
          <h1 className="chrome-text text-4xl leading-[1.08] font-extralight tracking-[0.04em] uppercase sm:text-6xl">
            {headlineTop}
            <br />
            {headlineRest}
          </h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-silver-300">
            {nexusContent?.subheadline}
          </p>
          <div
            className={`mt-9 flex flex-wrap items-center gap-5 ${
              atOverview ? "pointer-events-auto" : ""
            }`}
          >
            {signedIn ? (
              <Button
                variant="primary"
                onClick={() => {
                  trackCtaClick("public_jump", { placement: "hero" });
                  startJump("public");
                }}
                className="px-8 py-4 text-xs"
              >
                Jump Galaxy
              </Button>
            ) : (
              <OpenModalButton
                modal="signin"
                variant="primary"
                className="px-8 py-4 text-xs"
              >
                Sign in
              </OpenModalButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "The Nexus of Intelligence" → ["The Nexus", "of Intelligence"]. */
function splitHeadline(headline: string): [string, string] {
  const words = headline.split(" ");
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}
