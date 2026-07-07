"use client";

import { Button } from "@vorinthex/shared/ui/components";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * Bottom-center guidance that evolves with the journey:
 * - untouched: "Scroll to explore" nudge (like the reference art);
 * - after the first scroll: a softly pulsing primary CTA that carries the
 *   visitor beyond the solar system to ride the asteroid belt;
 * - in belt mode: a clear escape hatch back into the system.
 */
export function ScrollHint() {
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);
  const hasExplored = useGalaxyStore((s) => s.hasExplored);
  const drawerOpen = useGalaxyStore((s) => s.drawerOpen);
  const enterBelt = useGalaxyStore((s) => s.enterBelt);
  const exitBelt = useGalaxyStore((s) => s.exitBelt);

  if (mode === "cave" || mode === "jump" || mode === "intro") return null;
  // The drawer owns the bottom edge while it's open.
  if (mode === "system" && drawerOpen) return null;

  if (mode === "belt") {
    return (
      <div className="absolute inset-x-0 bottom-10 z-20 flex flex-col items-center gap-3 sm:bottom-12">
        <p className="font-mono text-[0.55rem] tracking-[0.3em] text-silver-500 uppercase">
          You are beyond the belt, scroll to ride it faster
        </p>
        <Button
          variant="secondary"
          onClick={exitBelt}
          className="min-h-0 px-6 py-2.5 text-[0.6rem] uppercase"
        >
          Return to your solar system
        </Button>
      </div>
    );
  }

  if (!hasExplored && step === 0) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-12 z-10 flex justify-center transition-opacity duration-700 sm:bottom-14"
      >
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/40 px-5 py-2.5 backdrop-blur-md">
          <span className="relative block h-6 w-3.5 rounded-full border border-silver-500/70">
            <span
              className="absolute top-1 left-1/2 h-1.5 w-0.5 -translate-x-1/2 rounded-full bg-silver-300"
              style={{ animation: "scroll-nudge 2.2s ease-in-out infinite" }}
            />
          </span>
          <span className="font-mono text-[0.55rem] tracking-[0.3em] text-silver-300 uppercase">
            Scroll to explore
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-10 z-10 flex justify-center sm:bottom-12">
      <Button
        variant="primary"
        onClick={enterBelt}
        className="min-h-0 animate-[ember-pulse_3.2s_ease-in-out_infinite] px-6 py-2.5 text-[0.6rem]"
      >
        Explore beyond our solar system
      </Button>
    </div>
  );
}
