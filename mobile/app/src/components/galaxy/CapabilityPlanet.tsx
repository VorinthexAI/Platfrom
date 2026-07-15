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
import { useCapabilityLogoTexture } from "@/components/three/entity-texture";
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
 * — same composition as the web PlanetLogoRing. The plane passes almost
 * through the sphere's center, so the front hemisphere pokes through and
 * occludes the mark's inner glyph while the ring's inner edge hugs the
 * planet's silhouette — the emblem WRAPS the world instead of floating
 * behind it. Billboarding is done against the full parent chain (orbit
 * plane + SystemRig rotation), so it stays screen-aligned however the
 * system is swiped around.
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
  const texture = useCapabilityLogoTexture(
    capabilityIconSource[slug] as number,
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
      {/* A whisker behind center (-z = away from the camera): the glyph
          stays safely occluded by the sphere without the plane z-fighting
          the crust, and the ring reads as wrapped around the planet. */}
      <mesh position={[0, 0, -planetRadius * 0.2]}>
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
        {/* 2.9× radius puts the ring's inner edge (≈39% of the texture
            width from center) just outside the sphere silhouette — the
            chrome ring hugs the planet like on the web landing. */}
        <PlanetLogo
          slug={orbit.slug}
          size={orbit.size * 2.9}
          planetRadius={orbit.size}
          focused={focused}
        />
      </group>
    </group>
  );
}
