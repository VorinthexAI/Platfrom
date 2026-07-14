import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { CapabilityOrbit } from "@/components/galaxy/galaxy-config";
import {
  capabilityPositions,
  trackedVector,
} from "@/components/galaxy/galaxy-refs";
import { OrbitRing } from "@/components/galaxy/OrbitRing";
import { PlanetSurface } from "@/components/galaxy/PlanetSurface";

type CapabilityPlanetProps = {
  orbit: CapabilityOrbit;
  focused: boolean;
  paused: boolean;
};

/**
 * One capability world on its own (possibly polar) orbit plane. Same
 * cos/sin orbit math as the web's ProductPlanet; the plane rotation wraps
 * the whole thing, and the live world position is written to galaxy-refs
 * every frame for the camera rig.
 */
export function CapabilityPlanet({
  orbit,
  focused,
  paused,
}: CapabilityPlanetProps) {
  const bodyRef = useRef<THREE.Group>(null);
  const angleRef = useRef(orbit.initialAngle);
  const throttleRef = useRef(1);

  useFrame((_, delta) => {
    if (!bodyRef.current) return;
    // Orbit eases to a halt while its world is focused (web parity).
    const throttleTarget = focused ? 0 : 1;
    throttleRef.current = THREE.MathUtils.damp(
      throttleRef.current,
      throttleTarget,
      3.5,
      delta,
    );
    if (!paused) {
      angleRef.current += delta * orbit.orbitSpeed * throttleRef.current;
    }
    const x = Math.cos(angleRef.current) * orbit.orbitRadius;
    const z = Math.sin(angleRef.current) * orbit.orbitRadius;
    bodyRef.current.position.set(x, 0, z);
    bodyRef.current.getWorldPosition(
      trackedVector(capabilityPositions, orbit.slug),
    );
  });

  return (
    <group rotation={orbit.plane}>
      <OrbitRing radius={orbit.orbitRadius} opacity={0.12} />
      <group ref={bodyRef}>
        <PlanetSurface
          entityId={`capability.${orbit.slug}`}
          biome={orbit.biome}
          radius={orbit.size}
          paused={paused}
          focused={focused}
        />
      </group>
    </group>
  );
}
