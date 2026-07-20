"use client";

import dynamic from "next/dynamic";

const SunSurface = dynamic(() => import("@/app/nexus/SunSurface"), { ssr: false });

/**
 * The original living Nexus surface, subdued beneath the workspace so its
 * amber motion remains visible without competing with interactive content.
 */
export function FoundersBackdrop() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 76% at 54% 46%, #100b08 0%, #070606 50%, #020304 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-10 [filter:saturate(.38)_brightness(.34)_contrast(1.18)]">
        <SunSurface />
      </div>
      <div
        aria-hidden
        className="nexus-backdrop-drift pointer-events-none absolute -inset-[8%]"
        style={{
          background:
            "radial-gradient(62% 54% at 54% 44%, rgba(195, 121, 62, 0.045) 0%, transparent 66%), radial-gradient(96% 88% at 50% 50%, transparent 28%, rgba(2, 3, 4, 0.78) 76%, rgba(0, 1, 2, 0.96) 100%)",
        }}
      />
    </>
  );
}
