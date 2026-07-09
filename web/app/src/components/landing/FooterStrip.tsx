"use client";

import { syncEntityUrl, useGalaxyStore } from "@/lib/galaxy-store";
import { trackCtaClick } from "@/lib/analytics";

/**
 * Slim fixed footer along the bottom edge, mirroring the reference art.
 * Desktop only. Privacy and Terms open their asteroid vaults instead of
 * flat pages — and the whole strip hides while you're inside any world,
 * so nothing outside the cavern can be clicked.
 */
export function FooterStrip() {
  const mode = useGalaxyStore((s) => s.mode);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const step = useGalaxyStore((s) => s.step);
  const enterCave = useGalaxyStore((s) => s.enterCave);

  const insideWorld =
    mode === "cave" ||
    mode === "jump" ||
    (mode === "system" && step > 0 && visitPhase !== "fly");
  if (insideWorld) return null;

  const openLegal = (kind: "privacy" | "terms") => {
    trackCtaClick("legal_open", { legal_kind: kind });
    enterCave(kind);
    syncEntityUrl(kind === "privacy" ? "/privacy" : "/terms");
  };

  return (
    <footer className="absolute inset-x-0 bottom-0 z-20 hidden lg:block">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center justify-between px-10">
        <p className="font-mono text-[0.58rem] tracking-[0.12em] text-silver-700">
          © {new Date().getFullYear()} Vorinthex AI. All rights reserved.
        </p>
        <nav aria-label="Legal" className="flex items-center gap-8">
          <button
            type="button"
            onClick={() => openLegal("privacy")}
            className="font-mono text-[0.58rem] tracking-[0.24em] text-silver-500 uppercase transition-colors hover:text-silver-100"
          >
            Privacy
          </button>
          <button
            type="button"
            onClick={() => openLegal("terms")}
            className="font-mono text-[0.58rem] tracking-[0.24em] text-silver-500 uppercase transition-colors hover:text-silver-100"
          >
            Terms
          </button>
        </nav>
      </div>
    </footer>
  );
}
