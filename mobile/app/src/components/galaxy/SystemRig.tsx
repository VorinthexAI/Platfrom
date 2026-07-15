import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import {
  systemDragging,
  systemPitch,
  systemPitchLive,
  systemYaw,
  systemYawLive,
} from "@/components/galaxy/galaxy-refs";

/** Post-release glide damping — momentum eases out like a spun globe. */
const GLIDE_LAMBDA = 6;

/**
 * The swipe-steered mount for the whole solar system (brain core, orbit
 * rings, planets). The pan gesture writes yaw/pitch targets on the UI
 * thread (galaxy-refs mutables); this group reads them synchronously each
 * frame. While the finger is DOWN the targets are applied verbatim — the
 * system is glued to the finger with zero smoothing latency, any
 * direction, any speed — and only the fling after release is damped out.
 * The biome chamber lives OUTSIDE this group — interiors never inherit
 * the system's orientation.
 */
export function SystemRig({ children }: { children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    if (systemDragging.value) {
      group.rotation.y = systemYaw.value;
      group.rotation.x = systemPitch.value;
    } else {
      group.rotation.y = THREE.MathUtils.damp(
        group.rotation.y,
        systemYaw.value,
        GLIDE_LAMBDA,
        delta,
      );
      group.rotation.x = THREE.MathUtils.damp(
        group.rotation.x,
        systemPitch.value,
        GLIDE_LAMBDA,
        delta,
      );
    }
    // Publish the rendered orientation so a new touch can grab it
    // mid-glide instead of fighting leftover momentum.
    systemYawLive.value = group.rotation.y;
    systemPitchLive.value = group.rotation.x;
  });

  return <group ref={groupRef}>{children}</group>;
}
