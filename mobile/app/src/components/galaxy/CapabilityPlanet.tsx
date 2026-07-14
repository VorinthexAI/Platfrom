import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { CapabilityOrbit } from "@/components/galaxy/galaxy-config";
import {
  capabilityPositions,
  trackedVector,
} from "@/components/galaxy/galaxy-refs";
import { OrbitRing } from "@/components/galaxy/OrbitRing";
import { PlanetSurface } from "@/components/galaxy/PlanetSurface";
import { getCapabilityLogoTexture } from "@/components/three/entity-texture";
import { capabilityIconSource } from "@/data/capability-icons";
import type { CapabilitySlug } from "@/data/registry";

type CapabilityPlanetProps = {
  orbit: CapabilityOrbit;
  focused: boolean;
  paused: boolean;
};

/**
 * The capability's mark, billboarded at the planet's heart so the world
 * sits WITHIN its logo — port of the web PlanetLogoRing. Billboarding is
 * done against the full parent chain (orbit plane + SystemRig rotation),
 * not just the camera, so it stays screen-aligned however the system is
 * swiped around.
 */
function PlanetLogo({
  slug,
  size,
  focused,
}: {
  slug: CapabilitySlug;
  size: number;
  focused: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const scratchQuaternion = useRef(new THREE.Quaternion());
  const texture = useMemo(
    () => getCapabilityLogoTexture(capabilityIconSource[slug] as number),
    [slug],
  );

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.parent) return;
    mesh.parent.getWorldQuaternion(scratchQuaternion.current);
    mesh.quaternion
      .copy(scratchQuaternion.current.invert())
      .multiply(camera.quaternion);
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={focused ? 0.7 : 0.5}
        depthWrite={false}
      />
    </mesh>
  );
}

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
        <PlanetLogo slug={orbit.slug} size={orbit.size * 3.1} focused={focused} />
      </group>
    </group>
  );
}
