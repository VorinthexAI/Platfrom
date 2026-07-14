import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { systemRotation } from "@/components/galaxy/galaxy-refs";

/**
 * The swipe-steered mount for the whole solar system (brain core, orbit
 * rings, planets). Finger pans write yaw/pitch targets into galaxy-refs;
 * this group exponentially damps toward them every frame so the rotation
 * always feels fluid, never stepped. The biome chamber lives OUTSIDE this
 * group — interiors never inherit the system's orientation.
 */
export function SystemRig({ children }: { children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.y = THREE.MathUtils.damp(
      group.rotation.y,
      systemRotation.yaw,
      4,
      delta,
    );
    group.rotation.x = THREE.MathUtils.damp(
      group.rotation.x,
      systemRotation.pitch,
      4,
      delta,
    );
  });

  return <group ref={groupRef}>{children}</group>;
}
