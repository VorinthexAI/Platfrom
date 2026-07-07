"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import {
  getDeepLinkTarget,
  getEntityById,
} from "@/lib/galaxy/registry-helpers";
import {
  galaxyMotion,
  ORBIT_STEPS,
  stepForEntity,
  syncEntityUrl,
  useGalaxyStore,
} from "@/lib/galaxy-store";
import { randomRockAnchor } from "@/lib/cave-config";
import { prewarmChamberTextures } from "@/lib/three/chamber";
import { useWebGLSupport } from "@/lib/use-webgl-support";
import { StaticHeroFallback } from "./StaticHeroFallback";

// The WebGL canvas is the only client-side-only piece of the page.
const GalaxyScene = dynamic(() => import("./GalaxyScene"), { ssr: false });

interface UniverseStageProps {
  /** Registry entity id resolved server-side from the URL (deep link). */
  initialEntityId?: string;
  /** Play the arrival flight on load (home route only). */
  intro?: boolean;
  /** Overlay UI (hero copy, rail, drawer, …) layered above the canvas. */
  children: ReactNode;
}

const STEP_COOLDOWN_MS = 900;
const WHEEL_THRESHOLD = 90;
const SWIPE_THRESHOLD = 60;
/**
 * Belt-mode pace compounds: the first scrolls add a gentle drift, but keep
 * scrolling and each push multiplies the last until the whole solar system
 * and belt smear into light strips — ~100× the idle circling speed.
 */
const BELT_MAX_VELOCITY = 2.2;

/**
 * The whole experience lives inside this single 100dvh stage — the page
 * never scrolls. In system mode wheel/swipe/keys step through the orbit
 * sequence (overview → each product → its moons) while sustained scrolling
 * builds spin momentum; in belt mode scrolling feeds the circling pace.
 */
export function UniverseStage({
  initialEntityId,
  intro = false,
  children,
}: UniverseStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const webgl = useWebGLSupport();
  const setStep = useGalaxyStore((s) => s.setStep);
  const stepBy = useGalaxyStore((s) => s.stepBy);
  const markExplored = useGalaxyStore((s) => s.markExplored);
  const startIntro = useGalaxyStore((s) => s.startIntro);

  // Paint every biome's rock textures during idle time so the first
  // entry into each chamber never hitches on canvas work.
  useEffect(() => {
    prewarmChamberTextures();
  }, []);

  // Adopt deep-link state once on mount, and follow browser history.
  useEffect(() => {
    // This effect re-runs when WebGL support resolves — never stomp a
    // cave story (verify links, legal vaults) that has already begun.
    const { mode } = useGalaxyStore.getState();
    const initialEntity = initialEntityId
      ? getEntityById(initialEntityId)
      : undefined;
    if (initialEntity) {
      setStep(stepForEntity(initialEntity), {
        visitPhase:
          initialEntity.type === "orchestrator" ||
          initialEntity.type === "capability"
            ? "inside"
            : "fly",
      });
    } else if (mode === "cave" || mode === "jump") {
      // A deep-linked cave owns the stage.
    } else if (intro && !reducedMotion && webgl === true) {
      // Fresh arrival: fly in from deep space before handing over control.
      startIntro();
    } else if (mode !== "intro") {
      setStep(0);
    }

    const onPopState = () => {
      const entity = getDeepLinkTarget({
        pathname: window.location.pathname,
        searchParams: new URLSearchParams(window.location.search),
      });
      setStep(stepForEntity(entity));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [initialEntityId, intro, reducedMotion, webgl, setStep, startIntro]);

  // Wheel / touch / keyboard input across all modes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let lastStep = 0;
    let wheelAccumulator = 0;
    let touchStartY: number | null = null;
    let touchConsumed = false;

    const syncStepPath = () => {
      const { step } = useGalaxyStore.getState();
      syncEntityUrl(ORBIT_STEPS[step]?.path ?? "/");
    };

    const step = (direction: 1 | -1) => {
      const now = Date.now();
      if (now - lastStep < STEP_COOLDOWN_MS) return;
      lastStep = now;
      // No bounds: the sequence wraps around in both directions.
      stepBy(direction);
      syncStepPath();
    };

    /** Inside an ordinary rock, scroll hurls you into a RANDOM asteroid. */
    const throwToRandomRock = () => {
      const now = Date.now();
      if (now - lastStep < STEP_COOLDOWN_MS) return;
      lastStep = now;
      useGalaxyStore.getState().enterRock(randomRockAnchor(), { warp: true });
    };

    /** True while standing inside an uncharted rock's chamber. */
    const insideRock = () => {
      const state = useGalaxyStore.getState();
      return (
        state.mode === "cave" &&
        state.caveKind === "rock" &&
        state.cavePhase === "inside"
      );
    };

    /** Feed scroll energy into the mode-appropriate motion system. */
    const applyScrollEnergy = (deltaY: number) => {
      const { mode } = useGalaxyStore.getState();
      galaxyMotion.lastScrollAt = performance.now();
      if (mode === "belt") {
        // Any scroll direction feeds the ride: multiplicative gain builds
        // slowly at first, then compounds toward lightning speed.
        galaxyMotion.beltVelocity = Math.min(
          (galaxyMotion.beltVelocity + 0.006) * 1.22,
          BELT_MAX_VELOCITY,
        );
        return;
      }
      if (mode !== "system") return;
      if (deltaY > 0) {
        // Momentum compounds: keep scrolling and the cosmos spins faster
        // and faster until everything smears into streaks.
        galaxyMotion.momentum = Math.min(
          1,
          galaxyMotion.momentum +
            (Math.min(deltaY, 240) / 1500) * (1 + galaxyMotion.momentum * 2.2),
        );
      } else {
        // Scrolling back up throttles the spin down hard.
        galaxyMotion.momentum *= 0.45;
      }
    };

    /** Gestures inside scrollable drawer/cave content keep native behavior. */
    const insideScrollSafe = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-scroll-safe]");

    const onWheel = (event: WheelEvent) => {
      if (insideScrollSafe(event.target)) return;
      event.preventDefault();
      const { mode } = useGalaxyStore.getState();
      if (mode === "intro") {
        // Impatient explorers skip straight to the landing.
        useGalaxyStore.getState().finishIntro();
        return;
      }
      markExplored();
      applyScrollEnergy(event.deltaY);
      if (insideRock()) {
        wheelAccumulator += event.deltaY;
        if (Math.abs(wheelAccumulator) >= WHEEL_THRESHOLD) {
          wheelAccumulator = 0;
          throwToRandomRock();
        }
        return;
      }
      if (mode !== "system") return;
      wheelAccumulator += event.deltaY;
      if (Math.abs(wheelAccumulator) >= WHEEL_THRESHOLD) {
        step(wheelAccumulator > 0 ? 1 : -1);
        wheelAccumulator = 0;
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (insideScrollSafe(event.target)) return;
      touchStartY = event.touches[0]?.clientY ?? null;
      touchConsumed = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (touchStartY === null || touchConsumed) return;
      if (insideScrollSafe(event.target)) return;
      const deltaY = touchStartY - (event.touches[0]?.clientY ?? touchStartY);
      if (Math.abs(deltaY) >= SWIPE_THRESHOLD) {
        touchConsumed = true;
        markExplored();
        applyScrollEnergy(deltaY);
        if (insideRock()) {
          throwToRandomRock();
        } else if (useGalaxyStore.getState().mode === "system") {
          step(deltaY > 0 ? 1 : -1);
        }
      }
    };

    const onTouchEnd = () => {
      touchStartY = null;
      touchConsumed = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const state = useGalaxyStore.getState();
      if (event.key === "Escape") {
        if (state.mode === "belt") {
          state.exitBelt();
          return;
        }
        if (state.mode === "cave") {
          state.exitCave();
          return;
        }
        // Inside (or flying into) a world biome: Escape returns to the
        // solar system overview.
        if (state.mode === "system" && state.step > 0) {
          setStep(0);
          syncEntityUrl("/");
          return;
        }
      }
      if (state.mode !== "system") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (event.key) {
        case "ArrowDown":
        case "PageDown":
          event.preventDefault();
          step(1);
          break;
        case "ArrowUp":
        case "PageUp":
          event.preventDefault();
          step(-1);
          break;
        case "Home":
          event.preventDefault();
          setStep(0);
          syncEntityUrl("/");
          break;
      }
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("touchstart", onTouchStart, { passive: true });
    stage.addEventListener("touchmove", onTouchMove, { passive: true });
    stage.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("touchstart", onTouchStart);
      stage.removeEventListener("touchmove", onTouchMove);
      stage.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [setStep, stepBy, markExplored]);

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 h-dvh overflow-hidden overscroll-none bg-obsidian-990"
    >
      {/* the cosmos */}
      <div className="absolute inset-0">
        {webgl === true ? (
          <GalaxyScene reducedMotion={reducedMotion} />
        ) : webgl === false ? (
          <StaticHeroFallback />
        ) : null}
      </div>

      {children}
    </div>
  );
}
