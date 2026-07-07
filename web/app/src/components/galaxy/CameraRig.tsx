"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { easing } from "maath";
import * as THREE from "three";
import { productByKey } from "@/data/products";
import {
  galaxyMotion,
  ORBIT_STEPS,
  useGalaxyStore,
} from "@/lib/galaxy-store";
import {
  BELT_CAMERA_HEIGHT,
  BELT_CAMERA_RADIUS,
  CAVE_CONFIGS,
} from "@/lib/cave-config";
import { visitInteriorPosition } from "@/lib/three/chamber";
import { hashString } from "@/lib/three/procedural";
import { planetPositions } from "./galaxy-refs";

const OVERVIEW_POSITION = new THREE.Vector3(0, 6.5, 15.5);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0.4, 0);
/** Where the camera retreats to as scroll momentum spins the cosmos into streaks. */
const MOMENTUM_POSITION = new THREE.Vector3(0, 13, 36);
const UP = new THREE.Vector3(0, 1, 0);

const scratchPosition = new THREE.Vector3();
const scratchTarget = new THREE.Vector3();
const scratchOffset = new THREE.Vector3();
const scratchTangent = new THREE.Vector3();
const scratchLift = new THREE.Vector3();
const scratchAnchor = new THREE.Vector3();
const scratchInterior = new THREE.Vector3();

/**
 * Cinematic camera director for all galaxy modes:
 * - intro: the arrival flight from deep space.
 * - system: overview at step 0; any focused world is approached from
 *   outside, then ENTERED — the veil closes at the surface and the camera
 *   wakes inside the world's seeded biome chamber.
 * - belt: parked outside the belt, circling, looking back in.
 * - cave: same enter-the-rock choreography for the auth stories.
 * - jump: accelerates forward while the hyper-streak tunnel fires.
 */
export function CameraRig({ reducedMotion }: { reducedMotion: boolean }) {
  const camera = useThree((state) => state.camera);
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);
  const focus = useGalaxyStore((s) => s.focus);
  const child = useGalaxyStore((s) => s.child);
  const caveKind = useGalaxyStore((s) => s.caveKind);
  const cavePhase = useGalaxyStore((s) => s.cavePhase);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const beginEnter = useGalaxyStore((s) => s.beginEnter);
  const finishIntro = useGalaxyStore((s) => s.finishIntro);
  const lookTarget = useRef(OVERVIEW_TARGET.clone());
  const jumpVelocity = useRef(0);
  const introElapsed = useRef(0);

  /**
   * Sway gently around a chamber interior; snap in if we're still far out.
   * Parked wide and slightly high, looking a touch down, so the whole
   * world reads: glowing walls all around, the floor's life below, the
   * emblem floating ahead.
   */
  const insideChamber = (ix: number, iy: number, iz: number, delta: number) => {
    scratchInterior.set(ix, iy, iz);
    if (camera.position.distanceTo(scratchInterior) > 40) {
      camera.position.set(ix + 0.7, iy + 1.2, iz + 4.5);
      lookTarget.current.set(ix, iy - 0.3, iz);
    }
    const t = performance.now() * 0.00022;
    scratchPosition.set(
      ix + Math.sin(t) * 0.55 + 0.7,
      iy + 1.2 + Math.sin(t * 1.7) * 0.15,
      iz + 4.5 + Math.cos(t * 0.8) * 0.35,
    );
    scratchTarget.set(ix, iy - 0.3, iz);
    easing.damp3(camera.position, scratchPosition, 1.4, delta);
    easing.damp3(lookTarget.current, scratchTarget, 0.9, delta);
    camera.lookAt(lookTarget.current);
  };

  useFrame((_, delta) => {
    if (mode === "intro") {
      // The arrival flight: from deep space, past foreign galaxies, a long
      // decelerating dive that settles into our solar system.
      introElapsed.current += delta;
      const duration = 3.1;
      const t = Math.min(introElapsed.current / duration, 1);
      if (reducedMotion || t >= 1) {
        camera.position.copy(OVERVIEW_POSITION);
        lookTarget.current.copy(OVERVIEW_TARGET);
        camera.lookAt(lookTarget.current);
        finishIntro();
        return;
      }
      // Ease-out cubic: fast entry that still leaves time to watch the
      // foreign galaxies stream past before the gentle landing.
      const e = 1 - (1 - t) ** 3;
      const sway = Math.sin(t * Math.PI) * (1 - t);
      camera.position.set(
        OVERVIEW_POSITION.x + (85 - OVERVIEW_POSITION.x) * (1 - e) + sway * 26,
        OVERVIEW_POSITION.y + (52 - OVERVIEW_POSITION.y) * (1 - e) + sway * 9,
        OVERVIEW_POSITION.z + (270 - OVERVIEW_POSITION.z) * (1 - e),
      );
      lookTarget.current.copy(OVERVIEW_TARGET);
      camera.lookAt(lookTarget.current);
      return;
    }
    introElapsed.current = 0;

    if (mode === "belt") {
      // Slow circle outside the belt, looking inward at the small system.
      galaxyMotion.beltAngle += galaxyMotion.beltVelocity * delta;
      // Velocity flows back toward the idle drift unless scrolling feeds
      // it — the faster it spins, the harder it bleeds off, so easing off
      // at lightning speed settles back to a comfortable glide quickly.
      galaxyMotion.beltVelocity = THREE.MathUtils.damp(
        galaxyMotion.beltVelocity,
        galaxyMotion.beltBaseVelocity,
        0.25 + galaxyMotion.beltVelocity * 0.45,
        delta,
      );
      scratchPosition.set(
        Math.cos(galaxyMotion.beltAngle) * BELT_CAMERA_RADIUS,
        BELT_CAMERA_HEIGHT,
        Math.sin(galaxyMotion.beltAngle) * BELT_CAMERA_RADIUS,
      );
      scratchTarget.set(0, 0.4, 0);
      easing.damp3(camera.position, scratchPosition, reducedMotion ? 0.01 : 1.1, delta);
      easing.damp3(lookTarget.current, scratchTarget, 0.7, delta);
      camera.lookAt(lookTarget.current);
      return;
    }

    if (mode === "cave" && caveKind) {
      const config = CAVE_CONFIGS[caveKind];
      const [ix, iy, iz] = config.interior;
      if (cavePhase === "inside") {
        insideChamber(ix, iy, iz, delta);
        return;
      }
      // fly / enter: glide toward the anchor rock; the veil takes over.
      // Ordinary rocks anchor at the exact rock the explorer clicked.
      const rockAnchor = useGalaxyStore.getState().rockAnchor;
      const anchorAngle =
        caveKind === "rock" && rockAnchor
          ? rockAnchor.angle
          : config.anchorAngle;
      const anchorRadius =
        caveKind === "rock" && rockAnchor
          ? rockAnchor.radius
          : config.anchorRadius;
      scratchAnchor.set(
        Math.cos(anchorAngle) * anchorRadius,
        0.3,
        Math.sin(anchorAngle) * anchorRadius,
      );
      easing.damp3(camera.position, scratchAnchor, reducedMotion ? 0.01 : 0.55, delta);
      easing.damp3(lookTarget.current, scratchAnchor, 0.3, delta);
      camera.lookAt(lookTarget.current);
      if (
        cavePhase === "fly" &&
        (camera.position.distanceTo(scratchAnchor) < 1.6 || reducedMotion)
      ) {
        beginEnter("cave");
      }
      return;
    }

    if (mode === "jump") {
      // Accelerate along the current view direction — the streak tunnel
      // and the route change sell the rest.
      jumpVelocity.current = Math.min(jumpVelocity.current + delta * 90, 160);
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      camera.position.addScaledVector(forward, jumpVelocity.current * delta);
      return;
    }
    jumpVelocity.current = 0;

    // --- system mode ---
    const focusData = focus ? productByKey.get(focus) : undefined;
    const planetPos = focus ? planetPositions.get(focus) : undefined;
    const momentum = galaxyMotion.momentum;
    const entityId = ORBIT_STEPS[step]?.entityId;

    if (focusData && planetPos && entityId && visitPhase === "inside") {
      // Inside the focused world's chamber.
      const [ix, iy, iz] = visitInteriorPosition(hashString(entityId));
      insideChamber(ix, iy, iz, delta);
      return;
    }

    if (focusData && planetPos) {
      // Approach from outside: swing toward the planet, then punch in.
      const hasSatellites = focus === "core" || focus === "command";
      const distance = hasSatellites ? (child ? 5.2 : 6.2) : 4.6;
      scratchOffset.copy(planetPos).normalize();
      scratchTangent
        .set(-planetPos.z, 0, planetPos.x)
        .normalize()
        .multiplyScalar(0.85);
      scratchOffset
        .add(scratchTangent)
        .normalize()
        .multiplyScalar(distance * focusData.scale);
      scratchLift.copy(UP).multiplyScalar(1.4 * focusData.scale);
      scratchPosition.copy(planetPos).add(scratchOffset).add(scratchLift);
      scratchTarget.copy(planetPos);
      if (
        visitPhase === "fly" &&
        (camera.position.distanceTo(scratchPosition) < 1.3 || reducedMotion)
      ) {
        beginEnter("visit");
      }
    } else {
      scratchPosition.copy(OVERVIEW_POSITION);
      scratchTarget.copy(OVERVIEW_TARGET);
    }

    // Scroll momentum pulls the whole frame back into the streak-spin view.
    if (momentum > 0.02) {
      scratchPosition.lerp(MOMENTUM_POSITION, momentum * 0.9);
      scratchTarget.lerp(OVERVIEW_TARGET, momentum);
    }

    if (reducedMotion) {
      camera.position.copy(scratchPosition);
      lookTarget.current.copy(scratchTarget);
    } else {
      easing.damp3(camera.position, scratchPosition, 0.9, delta);
      easing.damp3(lookTarget.current, scratchTarget, 0.7, delta);
    }
    camera.lookAt(lookTarget.current);
  });

  return null;
}
