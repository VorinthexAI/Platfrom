"use client";

import dynamic from "next/dynamic";

const SunSurface = dynamic(() => import("@/app/nexus/SunSurface"), { ssr: false });

/**
 * Founders Gate lives inside the star: the sun's own burning surface is the
 * primary visual surface. A painted radial fallback shows while WebGL loads
 * (and stays without it), and a soft edge veil keeps text readable without
 * covering the texture.
 */
export function FoundersBackdrop() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 46%, #7a2d05 0%, #4a1503 44%, #1c0701 78%, #0a0301 100%)",
        }}
      />
      <SunSurface />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(92% 82% at 50% 50%, transparent 42%, rgba(10, 3, 1, 0.46) 78%, rgba(5, 1, 0, 0.7) 100%)",
        }}
      />
    </>
  );
}
