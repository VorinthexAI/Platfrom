"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@vorinthex/shared/ui/components";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { trackLandingEvent } from "@/lib/analytics";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { useLiveStore } from "@/lib/live/live-store";
import { CloseIcon } from "@/components/ui/icons";

/**
 * Screen-space layer for the Intelligence Fragments system: the community
 * progress counter, the claim tooltip for a selected collectible, and the
 * reward toast. All copy is restrained and monochrome — this is discovery,
 * not arcade gamification.
 */
export function FragmentOverlay() {
  const hydrateProgress = useFragmentsStore((s) => s.hydrateProgress);

  useEffect(() => {
    void hydrateProgress();
  }, [hydrateProgress]);

  return (
    <>
      <FragmentBadge />
      <CollectibleTooltip />
      <FragmentToast />
    </>
  );
}

/**
 * The Intelligence Fragments count as a quiet badge below the nav — no
 * goal, no threshold, just the living number. It rides along everywhere
 * (solar system and belt); biome interiors, arrival, caves, and the hyper
 * jump fly without it.
 */
function FragmentBadge() {
  const localTotal = useFragmentsStore((s) => s.globalTotal);
  const liveTotal = useLiveStore((s) => s.fragmentsTotal);
  // The SSE stream is the durable ledger; the local ledger covers the
  // current session before the first live frame arrives.
  const globalTotal = Math.max(localTotal, liveTotal);
  const mode = useGalaxyStore((s) => s.mode);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);

  if (mode === "intro" || mode === "jump" || mode === "cave") return null;
  if (mode === "system" && visitPhase !== "fly") return null;

  return (
    <div
      role="status"
      className="pointer-events-none absolute top-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-black/40 px-4 py-2 backdrop-blur-md sm:top-24 sm:right-10 sm:left-auto sm:translate-x-0"
    >
      <span className="block h-1.5 w-1.5 rotate-45 bg-silver-100 shadow-[0_0_8px_rgba(221,226,229,0.8)]" />
      <span className="font-mono text-[0.55rem] tracking-[0.24em] text-silver-300 uppercase">
        {globalTotal.toLocaleString("en-US")} Intelligence Fragments
      </span>
    </div>
  );
}

function CollectibleTooltip() {
  const selected = useFragmentsStore((s) => s.selected);
  const select = useFragmentsStore((s) => s.select);
  const claim = useFragmentsStore((s) => s.claim);
  const claiming = useFragmentsStore((s) => s.claiming);
  const hasJoined = useFragmentsStore((s) => s.hasJoined);
  const setPendingClaim = useFragmentsStore((s) => s.setPendingClaim);
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {selected ? (
        <motion.aside
          key={selected.id}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="chrome-border card-depth absolute bottom-24 left-1/2 z-40 w-[calc(100vw-2.5rem)] max-w-xs -translate-x-1/2 rounded-2xl p-5 lg:bottom-32"
          style={{ background: "var(--gradient-panel)" }}
          aria-label={`${selected.name} — claim Intelligence Fragments`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="micro-label">{selected.rarity} discovery</p>
            <button
              type="button"
              onClick={() => select(null)}
              aria-label="Dismiss discovery"
              className="rounded-full border border-white/10 p-1.5 text-silver-500 transition-colors hover:border-white/25 hover:text-silver-100"
            >
              <CloseIcon width={10} height={10} />
            </button>
          </div>
          <h3 className="font-display mt-2 text-lg tracking-[0.16em] text-silver-50 uppercase">
            {selected.name}
          </h3>
          <p className="mt-1.5 text-[0.72rem] leading-relaxed text-silver-500">
            Contains {selected.fragments.toLocaleString("en-US")} Intelligence
            Fragments. Claiming adds them to your Explorer Balance and to the
            Nexus Construction.
          </p>
          <div className="mt-4">
            {hasJoined ? (
              <Button
                variant="primary"
                loading={claiming}
                onClick={() => void claim(selected)}
                className="w-full min-h-0 px-5 py-2.5 text-[0.6rem]"
              >
                Claim
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  // Carry the treasure into the join cave — it's claimed
                  // for this explorer the moment they submit their email.
                  trackLandingEvent({
                    slug: "landing.fragment_join_to_claim_clicked",
                    metadata: {
                      collectible_id: selected.id,
                      collectible_slug: selected.slug,
                      collectible_name: selected.name,
                      rarity: selected.rarity,
                      fragments: selected.fragments,
                    },
                  });
                  setPendingClaim(selected);
                  select(null);
                  enterCave("join");
                }}
                className="w-full min-h-0 px-5 py-2.5 text-[0.6rem]"
              >
                Join Waitlist to claim
              </Button>
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

function FragmentToast() {
  const toast = useFragmentsStore((s) => s.toast);
  const dismissToast = useFragmentsStore((s) => s.dismissToast);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 4200);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.title}
          role="status"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="chrome-border card-depth absolute top-24 left-1/2 z-40 -translate-x-1/2 rounded-2xl px-6 py-3.5 text-center"
          style={{ background: "var(--gradient-panel)" }}
        >
          <p className="font-display text-sm tracking-[0.18em] text-silver-50 uppercase">
            {toast.title}
          </p>
          <p className="mt-1 font-mono text-[0.55rem] tracking-[0.18em] text-silver-500 uppercase">
            {toast.detail}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
