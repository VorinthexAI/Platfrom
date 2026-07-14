import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { CHAMBER_POSITION } from "@/components/galaxy/chamber-config";
import { capabilityPositions } from "@/components/galaxy/galaxy-refs";
import { useGalaxyStore, type GalaxyPhase } from "@/state/galaxy";

export const OVERVIEW_POSITION = new THREE.Vector3(0, 2.1, 9.4);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 0);
const APPROACH_DISTANCE = 2.05;
const ENTER_RADIUS = 0.4;

/** Exponential per-axis damping — the same easing family the web rig uses. */
function dampVector(
  current: THREE.Vector3,
  target: THREE.Vector3,
  lambda: number,
  delta: number,
) {
  current.x = THREE.MathUtils.damp(current.x, target.x, lambda, delta);
  current.y = THREE.MathUtils.damp(current.y, target.y, lambda, delta);
  current.z = THREE.MathUtils.damp(current.z, target.z, lambda, delta);
}

/**
 * Ported from the web CameraRig: overview framing, damped fly-in toward
 * the live planet position, the "enter" flip when the camera reaches the
 * crust, and the parked interior sway. Teleports (into and out of the
 * chamber) happen while the TransitionVeil is dark.
 */
export function CameraRig() {
  const lookTargetRef = useRef(OVERVIEW_TARGET.clone());
  const lastPhaseRef = useRef<GalaxyPhase>("overview");
  const scratchApproach = useRef(new THREE.Vector3());
  const scratchTangent = useRef(new THREE.Vector3());
  const scratchTarget = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    const { camera } = state;
    const { phase, targetSlug, beginEnter } = useGalaxyStore.getState();
    const lookTarget = lookTargetRef.current;

    // Teleports under the veil: entering parks inside the chamber,
    // exiting snaps back to the system overview.
    if (lastPhaseRef.current !== phase) {
      if (phase === "inside") {
        camera.position.set(
          CHAMBER_POSITION.x + 0.6,
          CHAMBER_POSITION.y + 0.9,
          CHAMBER_POSITION.z + 3.6,
        );
        lookTarget.set(
          CHAMBER_POSITION.x,
          CHAMBER_POSITION.y + 0.3,
          CHAMBER_POSITION.z,
        );
      }
      if (phase === "overview" && lastPhaseRef.current === "exit") {
        camera.position.copy(OVERVIEW_POSITION);
        lookTarget.copy(OVERVIEW_TARGET);
      }
      lastPhaseRef.current = phase;
    }

    if (phase === "overview") {
      dampVector(camera.position, OVERVIEW_POSITION, 2.2, delta);
      dampVector(lookTarget, OVERVIEW_TARGET, 2.6, delta);
    } else if ((phase === "fly" || phase === "enter") && targetSlug) {
      const planet = capabilityPositions.get(targetSlug);
      if (planet) {
        // Approach point: outside the planet along its radial direction,
        // slid sideways along the orbit tangent and lifted for parallax.
        const approach = scratchApproach.current.copy(planet);
        const outward = scratchTangent.current
          .copy(planet)
          .normalize()
          .multiplyScalar(1);
        approach.add(outward);
        approach.x += -planet.z * 0.12;
        approach.z += planet.x * 0.12;
        approach.y += 0.4;
        // Keep the approach at a fixed standoff from the surface.
        const standoff = scratchTarget.current
          .copy(approach)
          .sub(planet)
          .setLength(APPROACH_DISTANCE);
        approach.copy(planet).add(standoff);

        dampVector(camera.position, approach, 2.6, delta);
        dampVector(lookTarget, planet, 3.2, delta);

        if (phase === "fly" && camera.position.distanceTo(approach) < ENTER_RADIUS) {
          beginEnter();
        }
      }
    } else if (phase === "inside") {
      // Gentle parked sway, looking slightly down into the chamber heart.
      const t = state.clock.elapsedTime;
      const park = scratchApproach.current.set(
        CHAMBER_POSITION.x + 0.6 + Math.sin(t * 0.32) * 0.22,
        CHAMBER_POSITION.y + 0.9 + Math.sin(t * 0.21) * 0.14,
        CHAMBER_POSITION.z + 3.6 + Math.cos(t * 0.26) * 0.2,
      );
      dampVector(camera.position, park, 1.6, delta);
      const heart = scratchTarget.current.set(
        CHAMBER_POSITION.x,
        CHAMBER_POSITION.y + 0.3,
        CHAMBER_POSITION.z,
      );
      dampVector(lookTarget, heart, 2.4, delta);
    }
    // phase === "exit": hold still while the veil closes.

    camera.lookAt(lookTarget);
  });

  return null;
}
