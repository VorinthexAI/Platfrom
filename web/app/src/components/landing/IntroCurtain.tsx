"use client";

import { useEffect, useState } from "react";

/**
 * Server-rendered obsidian cover for the very first paint of the home
 * route. Without it the hero copy and CTAs flash for the few hundred
 * milliseconds between the SSR paint and hydration starting the arrival
 * flight. The curtain ships in the initial HTML — nothing can flash
 * beneath it — and lifts the instant React takes over, straight into
 * the intro flight with no content spoiler.
 */
export function IntroCurtain() {
  const [phase, setPhase] = useState<"held" | "lifting" | "gone">("held");

  useEffect(() => {
    let timer: number | undefined;
    (async () => {
      await Promise.resolve();
      setPhase("lifting");
      timer = window.setTimeout(() => setPhase("gone"), 700);
    })();
    return () => window.clearTimeout(timer);
  }, []);

  if (phase === "gone") return null;
  return (
    <>
      {/* No JS, no lift: let non-JS visitors read the page instead. */}
      <noscript>
        <style>{".intro-curtain{display:none}"}</style>
      </noscript>
      <div
        aria-hidden
        className={`intro-curtain absolute inset-0 z-[70] bg-obsidian-990 transition-opacity duration-500 ${
          phase === "held" ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
    </>
  );
}
