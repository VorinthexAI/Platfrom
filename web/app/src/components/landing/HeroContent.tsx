"use client";

import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { OpenModalButton } from "./OpenModalButton";
import { WaitlistLiveCounter } from "./WaitlistLiveCounter";

const nexusContent = VORINTHEX_GALAXY_REGISTRY.nexus.content;

/**
 * Hero copy layered over the galaxy — registry-driven, visible on the
 * Nexus overview, stepping aside once the user glides into an orbit.
 * Server-rendered into the initial HTML so crawlers always see it.
 */
export function HeroContent() {
  const atOverview = useGalaxyStore(
    (s) => s.step === 0 && s.mode === "system",
  );
  const [headlineTop, headlineRest] = splitHeadline(
    nexusContent?.headline ?? "The Nexus of Intelligence",
  );

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-10 transition-opacity duration-700 ${
        atOverview ? "" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="mx-auto w-full max-w-7xl px-5 pt-36 sm:px-10 sm:pt-32">
        <div className="max-w-xl">
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
            <OpenModalButton
              modal="waitlist"
              variant="primary"
              className="px-8 py-4 text-xs"
            >
              {nexusContent?.primaryCta ?? "Join Waitlist"}
            </OpenModalButton>
            <OpenModalButton
              modal="signin"
              variant="secondary"
              className="px-8 py-4 text-xs"
            >
              Sign in
            </OpenModalButton>
          </div>
          <WaitlistLiveCounter />
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
