"use client";

import dynamic from "next/dynamic";

const SunSurface = dynamic(() => import("@/app/nexus/SunSurface"), { ssr: false });

/**
 * Keep the authenticated workspace inside the same living sun surface as the
 * founder gate. SunSurface pauses itself for hidden tabs and reduced motion.
 */
export function FoundersBackdrop() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 100% at 50% 46%, #683009 0%, #351504 42%, #180703 76%, #080302 100%)",
        }}
      />
      <SunSurface />
      <div
        aria-hidden
        className="nexus-backdrop-drift pointer-events-none absolute -inset-[8%]"
        style={{
          background:
            "radial-gradient(72% 64% at 50% 42%, rgba(196, 76, 8, 0.18) 0%, transparent 54%), radial-gradient(92% 82% at 50% 50%, transparent 42%, rgba(10, 3, 1, 0.46) 78%, rgba(5, 1, 0, 0.7) 100%)",
        }}
      />
    </>
  );
}
