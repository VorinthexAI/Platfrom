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
import { CloseIcon, LockIcon } from "@/components/ui/icons";
import { SpeakerIcon } from "@/components/ui/SpeakerIcon";
import { trackCtaClick } from "@/lib/analytics";
import {
  entityAudioUrl,
  orchestratorMessageUrl,
  useAudioStore,
} from "@/lib/audio/audio-store";
import { entityLogoUrl } from "@/lib/three/entity-logo";
import {
  ORBIT_STEPS,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";

export function ProductDrawer() {
  const step = useGalaxyStore((s) => s.step);
  const mode = useGalaxyStore((s) => s.mode);
  const drawerOpen = useGalaxyStore((s) => s.drawerOpen);
  const setStep = useGalaxyStore((s) => s.setStep);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const reducedMotion = useReducedMotion();

  const closeAndLeave = () => {
    trackCtaClick("product_drawer_close");
    setStep(0);
    syncEntityUrl("/");
  };

  const stepDef = ORBIT_STEPS[step];
  const entity = stepDef?.entityId ? getEntityById(stepDef.entityId) : undefined;
  const open = Boolean(
    entity && drawerOpen && mode === "system" && visitPhase === "inside",
  );

  return (
    <AnimatePresence>
      {entity && open ? (
        <motion.section
          key={entity.id}
          role="dialog"
          aria-label={`${entity.name} details`}
          // Slides up into place immediately; leaving slides it back down.
          initial={reducedMotion ? { opacity: 0 } : { y: "115%" }}
          animate={
            reducedMotion
              ? { opacity: 1, transition: { duration: 0.5 } }
              : { y: 0, transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] } }
          }
          exit={
            reducedMotion
              ? { opacity: 0, transition: { duration: 0.3 } }
              : {
                  y: "115%",
                  transition: { duration: 0.6, ease: [0.4, 0, 0.6, 1] },
                }
          }
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
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              className="chrome-border card-depth relative flex min-h-0 flex-1 flex-col rounded-3xl"
              style={{ background: "var(--gradient-panel)" }}
            >
              <div className="flex cursor-grab justify-center pt-2.5 pb-1 active:cursor-grabbing">
                <span className="block h-1 w-10 rounded-full bg-white/15" />
              </div>
              <button
                type="button"
                onClick={closeAndLeave}
                aria-label="Close"
                className="absolute top-3 right-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/12 text-silver-500 shadow-none transition-colors hover:border-white/25 hover:bg-white/[0.04] hover:text-silver-200"
                style={{
                  background: "rgba(255, 255, 255, 0.025)",
                  boxShadow: "none",
                }}
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
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

function EntityPanel({ entity }: { entity: GalaxyEntity }) {
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
            {owner.name}{" "}
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
          {entity.content?.drawerLine ??
            entity.content?.body ??
            entity.longDescription ??
            entity.shortDescription}
        </p>
      </div>

      <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-start">
        <Button
          variant="primary"
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
          className="min-h-0 max-w-full px-5 py-3 text-[0.62rem] uppercase sm:px-6"
        >
          Play Briefing
        </Button>
        {entity.type === "orchestrator" ? (
          <Button
            variant="secondary"
            onClick={() => {
              trackCtaClick("orchestrator_message", {
                placement: "entity_drawer",
                entity_id: entity.id,
                entity_type: entity.type,
                entity_slug: entity.slug,
              });
              playVoice(orchestratorMessageUrl(entity.slug));
            }}
            icon={<SpeakerIcon animated />}
            className="min-h-0 max-w-full px-5 py-3 text-[0.62rem] uppercase sm:px-6"
          >
            Meet {entity.name}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
