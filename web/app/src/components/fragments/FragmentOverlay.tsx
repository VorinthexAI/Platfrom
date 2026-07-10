"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@vorinthex/shared/ui/components";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { trackCtaClick, trackLandingEvent } from "@/lib/analytics";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { CloseIcon } from "@/components/ui/icons";

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
      <CollectGateCard />
      <FragmentToast />
    </>
  );
}

/**
 * The join/sign-in gate: raised whenever a visitor without an explorer
 * profile tries to collect anything — registry treasure or biome loot.
 * The loot stays in the scene; the card offers the two doors in.
 */
function CollectGateCard() {
  const open = useFragmentsStore((s) => s.collectGateOpen);
  const dismissCollectGate = useFragmentsStore((s) => s.dismissCollectGate);
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const reducedMotion = useReducedMotion();

  const openDoor = () => {
    trackCtaClick("signin_gate_open", {
      placement: "collect_gate",
    });
    dismissCollectGate();
    enterCave("signin");
  };

  return (
    <AnimatePresence>
      {open ? (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center px-4">
          <motion.aside
            role="dialog"
            aria-label="Sign in to collect fragments"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="chrome-border card-depth pointer-events-auto relative w-full max-w-md rounded-3xl p-7 sm:p-9"
            style={{ background: "var(--gradient-panel)" }}
          >
            <button
              type="button"
              onClick={dismissCollectGate}
              aria-label="Dismiss"
              className="absolute top-4 right-4 rounded-full border border-white/10 p-2 text-silver-500 transition-colors hover:border-white/25 hover:text-silver-100"
            >
              <CloseIcon width={12} height={12} />
            </button>
            <p className="micro-label">The Hunt</p>
            <h2 className="font-display mt-3 text-2xl tracking-[0.1em] text-silver-50">
              Fragments need an explorer.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-silver-500">
              Sign in with your email to save this fragment. New explorers are
              created automatically.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Button
                variant="primary"
                onClick={openDoor}
                className="w-full px-5 py-3.5 text-xs uppercase"
              >
                Sign in
              </Button>
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
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
  const tooltipRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selected) return;

    const dismiss = () => select(null);
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const tooltip = tooltipRef.current;
      if (tooltip?.contains(event.target as Node)) return;
      dismiss();
    };

    document.addEventListener("pointerdown", dismissOnOutsidePointer, true);
    window.addEventListener("wheel", dismiss, { passive: true });
    window.addEventListener("scroll", dismiss, { passive: true });
    window.addEventListener("touchmove", dismiss, { passive: true });

    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer, true);
      window.removeEventListener("wheel", dismiss);
      window.removeEventListener("scroll", dismiss);
      window.removeEventListener("touchmove", dismiss);
    };
  }, [selected, select]);

  return (
    <AnimatePresence>
      {selected ? (
        <motion.aside
          ref={tooltipRef}
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
                <p className="text-[0.72rem] leading-relaxed text-silver-500">
                  Sign in with your email to save this fragment. New explorers
                  are created automatically.
                </p>
                <Button
                  variant="primary"
                  onClick={() => {
                    // Carry the treasure into sign-in; it is collected for
                    // this explorer the moment they submit their email.
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
                    enterCave("signin");
                  }}
                  className="mt-4 w-full min-h-0 px-5 py-3 text-[0.62rem] uppercase"
                >
                  Sign in
                </Button>
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
