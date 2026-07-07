"use client";

import { create } from "zustand";
import { products, type ProductKey } from "@/data/products";
import { caveKindAtAnchor } from "@/lib/cave-config";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { hashString } from "@/lib/three/procedural";
import {
  getChildren,
  getEntityRenderState,
  getOwningProduct,
} from "@/lib/galaxy/registry-helpers";

/**
 * Galaxy navigation v3.
 *
 * The universe is explored in modes:
 * - "system": discrete orbit steps through the solar system — overview,
 *   then each product followed by its children (moons), one parent
 *   expanded at a time.
 * - "belt": the camera leaves the system and slowly circles the asteroid
 *   belt from outside, looking in.
 * - "cave": the camera dives into a belt asteroid whose interior hosts an
 *   auth story (join / verify / sign-in / TOTP).
 * - "jump": hyper-jump transition into /galaxy/*.
 */

export type GalaxyMode = "intro" | "system" | "belt" | "cave" | "jump";

/** Which asteroid-cave story is playing. */
export type CaveKind =
  | "join" // join the waitlist (email form → check inbox)
  | "waitlist-verify" // arrived via /public/waitlist/verify?token_hash=…
  | "signin" // explorer sign-in: waitlist profile + fragments collected
  | "members" // members gate (email form → magic link → TOTP → private galaxy)
  | "magic" // arrived via /public/auth/token?token_hash=… (TOTP setup/verify)
  | "privacy" // the privacy policy, read inside the Records Vault
  | "terms" // the terms, read inside the Accord Vault
  | "leaderboard" // the galaxy leaderboard hall — live ranks + crystal cave
  | "rock"; // any ordinary belt asteroid — hollow, near-empty, a few fragments

/** Where the camera anchors when diving into an ordinary belt rock. */
export interface RockAnchor {
  angle: number;
  radius: number;
}

export type JumpTarget = "public" | "private";

/**
 * Interior approach phases (shared by asteroid caves and world visits):
 * "fly" toward the body, "enter" while the dark veil closes over the
 * surface punch-through, "inside" once within the chamber.
 */
export type InteriorPhase = "fly" | "enter" | "inside";

/** Fresh world-gen seed per visit — same world, never the same cavern. */
let visitNonce = 1;
function nextVisitSeed(): number {
  visitNonce = (visitNonce * 48271) % 2147483647;
  return visitNonce;
}

export interface OrbitStep {
  kind: "overview" | "product" | "child";
  product: ProductKey | null;
  child: string | null;
  /** Registry id of the focused entity (product or child), null at overview. */
  entityId: string | null;
  path: string;
}

function buildSteps(): OrbitStep[] {
  const steps: OrbitStep[] = [
    { kind: "overview", product: null, child: null, entityId: null, path: "/" },
  ];
  for (const product of products) {
    steps.push({
      kind: "product",
      product: product.key,
      child: null,
      entityId: product.entity.id,
      path: product.route,
    });
    const children = getChildren(product.entity.id).filter(
      (child) => getEntityRenderState(child) !== "hidden",
    );
    for (const child of children) {
      steps.push({
        kind: "child",
        product: product.key,
        child: child.slug,
        entityId: child.id,
        path: child.routes.path,
      });
    }
  }
  return steps;
}

export const ORBIT_STEPS: OrbitStep[] = buildSteps();
export const MAX_STEP = ORBIT_STEPS.length - 1;

export function stepIndexForFocus(
  focus: ProductKey | null,
  child: string | null = null,
): number {
  if (!focus) return 0;
  const index = ORBIT_STEPS.findIndex(
    (step) => step.product === focus && step.child === (child ?? null),
  );
  return index === -1 ? 0 : index;
}

/**
 * Live motion values shared between DOM input handlers and the r3f frame
 * loop without triggering React renders. Mutation is the point.
 */
export const galaxyMotion = {
  /** 0..1 — system-mode scroll momentum; high values spin the cosmos into streaks. */
  momentum: 0,
  /** rad/s — belt-mode circling speed (idles at beltBaseVelocity). */
  beltVelocity: 0.02,
  beltBaseVelocity: 0.02,
  /** Camera angle around the belt while in belt mode. */
  beltAngle: Math.PI * 0.35,
  /** Sideways drag/swipe: camera yaw offset around the solar system. */
  orbitAngle: 0,
  /** rad/s — free-orbit spin left over when a sideways drag lets go. */
  orbitVelocity: 0,
  /** True while a pointer is actively dragging — the camera follows 1:1. */
  dragging: false,
  /** ms timestamp of the last scroll input (for momentum decay). */
  lastScrollAt: 0,
  /** ms timestamp of the last interior-to-interior warp (streak burst). */
  warpAt: 0,
};

interface GalaxyState {
  mode: GalaxyMode;
  /** Index into ORBIT_STEPS while in system mode. */
  step: number;
  /** Product planet the camera is focused on; null = overview. */
  focus: ProductKey | null;
  /** Focused child slug of the focused product (moon). */
  child: string | null;
  drawerOpen: boolean;
  hovered: ProductKey | null;
  /** True once the visitor has scrolled at least once (swaps the hint CTA). */
  hasExplored: boolean;
  caveKind: CaveKind | null;
  cavePhase: InteriorPhase;
  /** Anchor of the clicked belt rock while a "rock" cave is playing. */
  rockAnchor: RockAnchor | null;
  /** Where leaving the current rock cave returns to (dive origin). */
  rockReturnMode: "belt" | "system";
  /**
   * Stable identity of the dived asteroid (quantized anchor). Loot inside
   * a biome keys off this, so a collected crystal never respawns when the
   * same asteroid is entered again.
   */
  rockBiomeSeed: number | null;
  /** Phase of the current world visit (entering a product/moon interior). */
  visitPhase: InteriorPhase;
  /** World-gen seed for the current interior — new on every visit. */
  visitSeed: number;
  jumpTarget: JumpTarget | null;
  setStep: (step: number, options?: { openDrawer?: boolean; visitPhase?: InteriorPhase }) => void;
  stepBy: (direction: 1 | -1) => void;
  /** Begin the arrival flight (page load, home route only). */
  startIntro: () => void;
  /** Land in the solar system (flight complete or skipped). */
  finishIntro: () => void;
  /** Camera is at the surface — close the veil. */
  beginEnter: (kind: "cave" | "visit") => void;
  /** Veil is closed — teleport inside. */
  arriveInside: (kind: "cave" | "visit") => void;
  setChild: (child: string | null) => void;
  setDrawerOpen: (open: boolean) => void;
  setHovered: (hovered: ProductKey | null) => void;
  markExplored: () => void;
  enterBelt: () => void;
  exitBelt: () => void;
  enterCave: (kind: CaveKind) => void;
  /** Dive into an ordinary belt asteroid at the clicked bearing. With
   * `warp` (already inside a rock) the veil punches straight through to
   * the next interior instead of flying back out. */
  enterRock: (anchor: RockAnchor, options?: { warp?: boolean }) => void;
  exitCave: () => void;
  resetToSystem: () => void;
  startJump: (target: JumpTarget) => void;
}

export const useGalaxyStore = create<GalaxyState>((set, get) => ({
  mode: "system",
  step: 0,
  focus: null,
  child: null,
  drawerOpen: false,
  hovered: null,
  hasExplored: false,
  caveKind: null,
  cavePhase: "fly",
  rockAnchor: null,
  rockReturnMode: "belt",
  rockBiomeSeed: null,
  visitPhase: "fly",
  visitSeed: 1,
  jumpTarget: null,
  setStep: (step, options) => {
    // The sequence wraps: scrolling past Launch's last moon returns to the
    // Nexus overview, and scrolling up from the overview lands on it.
    const total = ORBIT_STEPS.length;
    const wrapped = ((Math.round(step) % total) + total) % total;
    const target = ORBIT_STEPS[wrapped];
    // Already inside a world and heading to another? No exit-and-refly —
    // a hyperspeed warp punches straight through to the next interior.
    const state = get();
    const warping =
      state.mode === "system" &&
      state.visitPhase === "inside" &&
      state.step > 0 &&
      wrapped > 0 &&
      wrapped !== state.step;
    if (warping) {
      galaxyMotion.warpAt = performance.now();
    }
    set({
      mode: "system",
      step: wrapped,
      focus: target.product,
      child: target.child,
      drawerOpen: options?.openDrawer ?? wrapped > 0,
      // Every focused world is ENTERED — a fresh flight and a fresh
      // world-gen seed each time, like re-rolling a Minecraft world.
      visitPhase: options?.visitPhase ?? (warping ? "enter" : "fly"),
      visitSeed: nextVisitSeed(),
    });
  },
  stepBy: (direction) => {
    get().setStep(get().step + direction);
  },
  startIntro: () => {
    set({ mode: "intro", step: 0, focus: null, child: null, drawerOpen: false });
  },
  finishIntro: () => {
    if (get().mode === "intro") {
      set({ mode: "system" });
    }
  },
  setChild: (child) => {
    const { focus } = get();
    if (!focus) return;
    get().setStep(stepIndexForFocus(focus, child));
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setHovered: (hovered) => set({ hovered }),
  markExplored: () => {
    if (!get().hasExplored) set({ hasExplored: true });
  },
  enterBelt: () => {
    galaxyMotion.beltVelocity = galaxyMotion.beltBaseVelocity;
    set({ mode: "belt", drawerOpen: false, hovered: null });
  },
  exitBelt: () => {
    const { step } = get();
    get().setStep(step, { openDrawer: false });
  },
  enterCave: (kind) => {
    set({
      mode: "cave",
      caveKind: kind,
      cavePhase: "fly",
      rockAnchor: null,
      visitSeed: nextVisitSeed(),
      drawerOpen: false,
      hovered: null,
    });
  },
  enterRock: (anchor, options) => {
    // Some belt asteroids ARE the story vaults: diving into a rock that
    // sits on a special anchor opens that cave (terms/privacy/auth) —
    // this is how explorers stumble onto them.
    const special = caveKindAtAnchor(anchor);
    if (special) {
      get().enterCave(special);
      return;
    }
    const warping = Boolean(options?.warp);
    if (warping) {
      galaxyMotion.warpAt = performance.now();
    }
    const currentMode = get().mode;
    // Re-anchor the belt orbit at this rock, so leaving the cave circles
    // out right where you dove in.
    galaxyMotion.beltAngle = anchor.angle;
    set({
      mode: "cave",
      caveKind: "rock",
      cavePhase: warping ? "enter" : "fly",
      rockAnchor: anchor,
      // Dive origin decides where exit returns: system stays system,
      // everything else circles back out into the belt.
      rockReturnMode: currentMode === "system" ? "system" : "belt",
      // Quantized bearing = this asteroid's permanent identity.
      rockBiomeSeed:
        (Math.round(anchor.angle * 40) * 73856093) ^
        (Math.round(anchor.radius * 8) * 19349663),
      visitSeed: nextVisitSeed(),
      drawerOpen: false,
      hovered: null,
    });
  },
  beginEnter: (kind) => {
    if (kind === "cave") {
      if (get().cavePhase === "fly") set({ cavePhase: "enter" });
    } else if (get().visitPhase === "fly") {
      set({ visitPhase: "enter" });
    }
  },
  arriveInside: (kind) => {
    if (kind === "cave") {
      set({ cavePhase: "inside" });
    } else {
      set({ visitPhase: "inside" });
    }
  },
  exitCave: () => {
    // Leaving a rock returns to wherever the dive began — circling the
    // belt, or the solar system when the asteroid was clicked from there.
    // Auth-story caves always return to the solar system.
    const state = get();
    const wasRock = state.caveKind === "rock";
    const returnMode = wasRock ? state.rockReturnMode : "system";
    if (returnMode === "belt") {
      galaxyMotion.beltVelocity = galaxyMotion.beltBaseVelocity;
    }
    set({
      mode: returnMode,
      caveKind: null,
      cavePhase: "fly",
      rockAnchor: null,
      rockBiomeSeed: null,
    });
  },
  resetToSystem: () => {
    set({
      mode: "system",
      step: 0,
      focus: null,
      child: null,
      drawerOpen: false,
      hovered: null,
      caveKind: null,
      cavePhase: "fly",
      rockAnchor: null,
      visitPhase: "fly",
      jumpTarget: null,
    });
  },
  startJump: (target) => set({ mode: "jump", jumpTarget: target }),
}));

/**
 * The stable loot identity of the currently-open cave: quantized asteroid
 * bearing for rocks, the story kind for vault caves. Shared by the scene
 * (what spawns) and the overlay (what the drawer announces), so both
 * always describe the same crystal.
 */
export function caveLootIdentity(
  caveKind: CaveKind,
  rockBiomeSeed: number | null,
  visitSeed: number,
): { biomeKey: string; lootSeed: number } {
  if (caveKind === "rock") {
    const lootSeed = rockBiomeSeed ?? visitSeed;
    return { biomeKey: `rock-${(lootSeed >>> 0).toString(36)}`, lootSeed };
  }
  return { biomeKey: caveKind, lootSeed: hashString(`cave-${caveKind}`) };
}

/** Convert a registry entity into a step index. */
export function stepForEntity(entity: GalaxyEntity): number {
  if (entity.type === "star" || entity.type === "brand") return 0;
  const product = getOwningProduct(entity);
  if (!product) return 0;
  return stepIndexForFocus(
    product.slug as ProductKey,
    entity.id === product.id ? null : entity.slug,
  );
}

/**
 * Update the address bar to an entity's canonical path without a
 * navigation, so every focus state is a shareable, SSR-capable link.
 */
export function syncEntityUrl(
  path: string,
  mode: "push" | "replace" = "push",
) {
  if (typeof window === "undefined") return;
  const current = window.location.pathname + window.location.search;
  if (current === path) return;
  if (mode === "push") {
    window.history.pushState(null, "", path);
  } else {
    window.history.replaceState(null, "", path);
  }
}
