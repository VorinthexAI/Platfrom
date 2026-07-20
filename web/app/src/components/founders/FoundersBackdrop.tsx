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
            "radial-gradient(90% 76% at 54% 46%, #281207 0%, #130904 50%, #050302 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25 [filter:saturate(.58)_brightness(.52)_contrast(1.1)]">
        <SunSurface />
      </div>
      <div
        aria-hidden
        className="nexus-backdrop-drift pointer-events-none absolute -inset-[8%]"
        style={{
          background:
            "radial-gradient(62% 54% at 54% 44%, rgba(218, 104, 20, 0.09) 0%, transparent 66%), radial-gradient(96% 88% at 50% 50%, transparent 34%, rgba(6, 2, 0, 0.72) 78%, rgba(2, 1, 0, 0.92) 100%)",
        }}
      />
    </>
  );
}
