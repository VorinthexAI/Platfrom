import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { systemPitch, systemYaw } from "@/components/galaxy/galaxy-refs";

/**
 * The swipe-steered mount for the whole solar system (brain core, orbit
 * rings, planets). The pan gesture writes yaw/pitch targets on the UI
 * thread (galaxy-refs mutables); this group reads them synchronously each
 * frame and damps tightly toward them, so the system chases the finger in
 * any direction without ever feeling stepped. The biome chamber lives
 * OUTSIDE this group — interiors never inherit the system's orientation.
 */
export function SystemRig({ children }: { children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.y = THREE.MathUtils.damp(
      group.rotation.y,
      systemYaw.value,
      9,
      delta,
    );
    group.rotation.x = THREE.MathUtils.damp(
      group.rotation.x,
      systemPitch.value,
      9,
      delta,
    );
  });

  return <group ref={groupRef}>{children}</group>;
}
