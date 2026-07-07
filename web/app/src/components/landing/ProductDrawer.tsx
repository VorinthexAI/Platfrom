"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@vorinthex/shared/ui/components";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import {
  getEntityById,
  getEntityRenderState,
  getOwningProduct,
  getStatusPrefix,
} from "@/lib/galaxy/registry-helpers";
import { EruptAssembly } from "@/components/ui/EruptAssembly";
import { CloseIcon, LockIcon } from "@/components/ui/icons";
import { SpeakerIcon } from "@/components/ui/SpeakerIcon";
import { trackCtaClick } from "@/lib/analytics";
import { entityAudioUrl, useAudioStore } from "@/lib/audio/audio-store";
import { entityLogoUrl } from "@/lib/three/entity-logo";
import {
  ORBIT_STEPS,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";

/**
 * Bottom sheet presenting exactly ONE focused entity — the product or the
 * moon the camera is parked at. Since scrolling now steps through children
 * too (and the rail lists them), the drawer no longer carries a scrolling
 * catalog: one world, one story. Names live here (the 3D scene is
 * label-free). Slides up per orbit; drag down or close to tuck it away.
 */
export function ProductDrawer() {
  const step = useGalaxyStore((s) => s.step);
  const mode = useGalaxyStore((s) => s.mode);
  const drawerOpen = useGalaxyStore((s) => s.drawerOpen);
  const setStep = useGalaxyStore((s) => s.setStep);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const reducedMotion = useReducedMotion();

  // Dismissing the sheet doesn't just tuck it away — it LEAVES the world:
  // back out of the biome and into the solar system.
  const closeAndLeave = () => {
    trackCtaClick("product_drawer_close");
    setStep(0);
    syncEntityUrl("/");
  };

  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const stepDef = ORBIT_STEPS[step];
  const entity = stepDef?.entityId ? getEntityById(stepDef.entityId) : undefined;
  // The drawer presents once you're INSIDE the world, not during the dive.
  const open = Boolean(
    entity && drawerOpen && mode === "system" && visitPhase === "inside",
  );

  return (
    <>
      <AnimatePresence>
        {entity && open ? (
          <motion.section
            key={entity.id}
            role="dialog"
            aria-label={`${entity.name} details`}
            initial={false}
            animate={reducedMotion ? { opacity: 1 } : { y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { y: "110%" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            drag={reducedMotion ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 70 || info.velocity.y > 500) {
                closeAndLeave();
              }
            }}
            className="absolute inset-x-2 bottom-2 z-30 flex max-h-[70dvh] flex-col sm:inset-x-6 lg:inset-x-8 lg:bottom-12 lg:max-h-[32dvh]"
          >
            {/* the WHOLE sheet arrives like the world's emblem: shattered
                into shards, erupted from below, fused in place — a fresh
                scatter on every visit */}
            <EruptAssembly
              seed={visitSeed}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div
                className="chrome-border card-depth relative flex min-h-0 flex-1 flex-col rounded-3xl"
                style={{ background: "var(--gradient-panel)" }}
              >
                {/* drag handle */}
                <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing">
                  <span className="block h-1 w-10 rounded-full bg-white/15" />
                </div>
                <button
                  type="button"
                  onClick={closeAndLeave}
                  aria-label="Close and return to the solar system"
                  className="absolute top-3.5 right-4 z-10 rounded-full border border-white/10 p-2 text-silver-500 transition-colors hover:border-white/25 hover:text-silver-100"
                >
                  <CloseIcon width={12} height={12} />
                </button>

                <div
                  data-scroll-safe
                  className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 sm:px-8 lg:pb-5 [touch-action:pan-y]"
                >
                  <EntityPanel entity={entity} />
                </div>
              </div>
            </EruptAssembly>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* No manual reopen pill: the drawer re-presents itself on the next
          orbit step, rail click, or planet click. */}
    </>
  );
}

/** The single focused world: identity, story, status, and one clear CTA. */
function EntityPanel({ entity }: { entity: GalaxyEntity }) {
  const enterCave = useGalaxyStore((s) => s.enterCave);
  const playVoice = useAudioStore((s) => s.playVoice);
  const state = getEntityRenderState(entity);
  const active = state === "active";
  const statusPrefix = getStatusPrefix(entity);
  const owner = entity.type !== "product" ? getOwningProduct(entity) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:gap-10">
      <div>
        {owner ? (
          <p className="mb-1.5 font-mono text-[0.5rem] tracking-[0.3em] text-silver-700 uppercase">
            {owner.name} ·{" "}
            {entity.type === "capability" ? "Capability" : "Orchestrator"}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entityLogoUrl(entity.type, entity.slug)}
              alt=""
              width={34}
              height={34}
              className="h-[34px] w-[34px] rounded-full border border-white/12 bg-black/40 p-0.5"
            />
            <h2 className="font-display text-2xl tracking-[0.24em] text-silver-50 uppercase">
              {entity.name}
            </h2>
          </div>
          {active ? (
            entity.statusLabel ? (
              <span className="rounded-full border border-white/15 px-3 py-1 font-mono text-[0.5rem] tracking-[0.26em] text-silver-100 uppercase">
                {entity.statusLabel}
              </span>
            ) : null
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-white/12 px-3 py-1 font-mono text-[0.5rem] tracking-[0.26em] text-silver-500 uppercase">
              <LockIcon width={10} height={10} />
              {statusPrefix ?? entity.statusLabel ?? "Coming Soon"}
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[0.55rem] tracking-[0.26em] text-silver-500 uppercase">
          {entity.fullTitle ?? entity.label ?? entity.tagline}
        </p>
        <p className="mt-3 max-w-xl text-[0.85rem] leading-relaxed text-silver-300">
          {entity.content?.body ??
            entity.longDescription ??
            entity.shortDescription}
        </p>
      </div>

      <div className="flex flex-col justify-center gap-3">
        {!active && entity.content?.statusNote ? (
          <p className="text-[0.7rem] leading-relaxed text-silver-700">
            {entity.content.statusNote}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
        {/* One truth: you're on the waitlist or you're not. */}
        <Button
          variant="primary"
          onClick={() => {
            trackCtaClick("waitlist_open", {
              placement: "entity_drawer",
              entity_id: entity.id,
              entity_type: entity.type,
              entity_slug: entity.slug,
            });
            enterCave("join");
          }}
          className="min-h-0 flex-1 px-5 py-3 text-[0.62rem] sm:flex-none sm:px-6"
        >
          {entity.content?.primaryCta ?? "Join Waitlist"}
        </Button>
        {/* the world speaks on entry — this replays its line */}
        <Button
          variant="secondary"
          onClick={() => {
            trackCtaClick("entity_audio", {
              placement: "entity_drawer",
              entity_id: entity.id,
              entity_type: entity.type,
              entity_slug: entity.slug,
            });
            playVoice(entityAudioUrl(entity.type, entity.slug));
          }}
          icon={<SpeakerIcon animated />}
          className="min-h-0 flex-1 px-5 py-3 text-[0.62rem] uppercase sm:flex-none sm:px-6"
        >
          Hear the Story
        </Button>
        </div>
      </div>
    </div>
  );
}
