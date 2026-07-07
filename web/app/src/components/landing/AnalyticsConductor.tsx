"use client";

import { useEffect, useRef } from "react";
import {
  getEntityById,
  getOwningProduct,
} from "@/lib/galaxy/registry-helpers";
import {
  ORBIT_STEPS,
  useGalaxyStore,
  type CaveKind,
} from "@/lib/galaxy-store";
import { trackLandingEvent } from "@/lib/analytics";

function caveEventMetadata(kind: CaveKind | null) {
  if (!kind) return {};
  return { cave_kind: kind };
}

export function AnalyticsConductor() {
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);
  const caveKind = useGalaxyStore((s) => s.caveKind);
  const cavePhase = useGalaxyStore((s) => s.cavePhase);
  const rockAnchor = useGalaxyStore((s) => s.rockAnchor);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const pageTracked = useRef(false);
  const lastEntityEntry = useRef<string | null>(null);
  const lastRockEntry = useRef<string | null>(null);
  const lastCave = useRef<CaveKind | null>(null);

  useEffect(() => {
    if (pageTracked.current) return;
    pageTracked.current = true;
    trackLandingEvent({ slug: "landing.page_viewed" });
  }, []);

  useEffect(() => {
    const previous = lastCave.current;
    if (mode === "cave" && caveKind && previous !== caveKind) {
      trackLandingEvent({
        slug: "landing.cave_opened",
        metadata: caveEventMetadata(caveKind),
      });
      if (caveKind === "signin") {
        trackLandingEvent({ slug: "auth.signin_opened" });
      } else if (caveKind === "members") {
        trackLandingEvent({ slug: "auth.member_gate_opened" });
      } else if (caveKind === "privacy" || caveKind === "terms") {
        trackLandingEvent({
          slug: "legal.opened",
          metadata: { legal_kind: caveKind },
        });
      }
      lastCave.current = caveKind;
    } else if (previous && mode !== "cave") {
      trackLandingEvent({
        slug: "landing.cave_closed",
        metadata: caveEventMetadata(previous),
      });
      lastCave.current = null;
    }
  }, [mode, caveKind]);

  useEffect(() => {
    if (mode !== "system" || visitPhase !== "inside") return;
    const stepDef = ORBIT_STEPS[step];
    if (!stepDef?.entityId) return;
    const entity = getEntityById(stepDef.entityId);
    if (!entity) return;

    const entryKey = `${visitSeed}:${entity.id}`;
    if (lastEntityEntry.current === entryKey) return;
    lastEntityEntry.current = entryKey;

    const owner = entity.type === "product" ? entity : getOwningProduct(entity);
    const metadata = {
      entity_id: entity.id,
      entity_slug: entity.slug,
      entity_name: entity.name,
      entity_type: entity.type,
      product_id: owner?.id ?? null,
      product_slug: owner?.slug ?? null,
      route: stepDef.path,
    };
    if (entity.type === "product") {
      trackLandingEvent({ slug: "landing.product_entered", metadata });
    } else if (entity.type === "orchestrator") {
      trackLandingEvent({ slug: "landing.orchestrator_entered", metadata });
    } else if (entity.type === "capability") {
      trackLandingEvent({ slug: "landing.capability_entered", metadata });
    }
  }, [mode, step, visitPhase, visitSeed]);

  useEffect(() => {
    if (mode !== "cave" || caveKind !== "rock" || cavePhase !== "inside") return;
    const entryKey = `${visitSeed}:${rockAnchor?.angle ?? "none"}:${rockAnchor?.radius ?? "none"}`;
    if (lastRockEntry.current === entryKey) return;
    lastRockEntry.current = entryKey;
    trackLandingEvent({
      slug: "landing.rock_entered",
      metadata: {
        rock_angle: rockAnchor?.angle ?? null,
        rock_radius: rockAnchor?.radius ?? null,
      },
    });
  }, [mode, caveKind, cavePhase, rockAnchor, visitSeed]);

  return null;
}
