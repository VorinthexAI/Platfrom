"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@vorinthex/shared/ui/components";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { trackCtaClick, trackLandingEvent } from "@/lib/analytics";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { ChevronRightIcon, CloseIcon } from "@/components/ui/icons";

/**
 * Screen-space layer for the Intelligence Fragments system: the community
 * progress counter, the collect tooltip for a selected collectible, and the
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
      {/* The floating fragments-count badge is gone — the Galaxy
          Leaderboard asteroid is the home of the numbers now. */}
      <CollectibleTooltip />
      <FragmentToast />
    </>
  );
}

function CollectibleTooltip() {
  const selected = useFragmentsStore((s) => s.selected);
  const select = useFragmentsStore((s) => s.select);
  const collect = useFragmentsStore((s) => s.collect);
  const collecting = useFragmentsStore((s) => s.collecting);
  const hasJoined = useFragmentsStore((s) => s.hasJoined);
  const setPendingCollect = useFragmentsStore((s) => s.setPendingCollect);
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
          aria-label={`${selected.name}, collect Intelligence Fragments`}
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
            Fragments. Collecting adds them to your Explorer Balance and to the
            Nexus Construction.
          </p>
          <div className="mt-4">
            {hasJoined ? (
              <Button
                variant="primary"
                loading={collecting}
                onClick={() => void collect(selected)}
                className="w-full min-h-0 px-5 py-2.5 text-[0.6rem]"
              >
                Collect
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={() => {
                    // Carry the treasure into the join cave — it's collected
                    // for this explorer the moment they submit their email.
                    trackLandingEvent({
                      slug: "landing.fragment_join_to_collect_clicked",
                      metadata: {
                        collectible_id: selected.id,
                        collectible_slug: selected.slug,
                        collectible_name: selected.name,
                        rarity: selected.rarity,
                        fragments: selected.fragments,
                      },
                    });
                    setPendingCollect(selected);
                    select(null);
                    enterCave("join");
                  }}
                  className="w-full min-h-0 px-5 py-2.5 text-[0.6rem]"
                >
                  Join to collect
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    // Same treasure, other door: sign-in also stores the
                    // collect immediately, so the fragment is never lost.
                    trackCtaClick("signin_to_collect", {
                      collectible_id: selected.id,
                    });
                    setPendingCollect(selected);
                    select(null);
                    enterCave("signin");
                  }}
                  className="mt-2.5 flex w-full items-center justify-center gap-1 text-center font-mono text-[0.55rem] tracking-[0.2em] text-silver-500 uppercase transition-colors hover:text-silver-100"
                >
                  Already on waitlist? Tap here to sign in
                  <ChevronRightIcon size="sm" />
                </button>
              </>
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
