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
 * The capability's LOGO is what orbits: the chrome ring emblem rides the
 * orbit, billboarded to the screen, with the planet baked into its center
 * — same composition as the web PlanetLogoRing. The plane sits slightly
 * BEHIND the sphere's center along the view axis, so the opaque planet
 * always occludes the mark's inner glyph and only the ring frames it.
 * Billboarding is done against the full parent chain (orbit plane +
 * SystemRig rotation), so it stays screen-aligned however the system is
 * swiped around.
 */
function PlanetLogo({
  slug,
  size,
  planetRadius,
  focused,
}: {
  slug: CapabilitySlug;
  size: number;
  planetRadius: number;
  focused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const scratchQuaternion = useRef(new THREE.Quaternion());
  const texture = useMemo(
    () => getCapabilityLogoTexture(capabilityIconSource[slug] as number),
    [slug],
  );

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group || !group.parent) return;
    group.parent.getWorldQuaternion(scratchQuaternion.current);
    group.quaternion
      .copy(scratchQuaternion.current.invert())
      .multiply(camera.quaternion);
  });

  return (
    <group ref={groupRef}>
      {/* -z in billboard space = away from the camera: the glyph hides
          behind the planet, the ring stays visible around it. */}
      <mesh position={[0, 0, -planetRadius * 0.55]}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={focused ? 0.92 : 0.72}
          depthWrite={false}
        />
      </mesh>
    </group>
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
        <PlanetLogo
          slug={orbit.slug}
          size={orbit.size * 3.4}
          planetRadius={orbit.size}
          focused={focused}
        />
      </group>
    </group>
  );
}
