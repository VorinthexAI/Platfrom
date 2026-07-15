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
import type { CapabilitySlug } from "@/data/registry";

type CapabilityPlanetProps = {
  orbit: CapabilityOrbit;
  focused: boolean;
  paused: boolean;
};

/**
 * The capability's LOGO is what orbits: the chrome ring emblem rides the
 * orbit, billboarded to the screen, at the very center of its gaseous
 * world — the ring's inner edge hugs the sphere's silhouette and the
 * glyph glows INSIDE the translucent planet (web PlanetLogoRing
 * composition, "the planet sits within its logo"). The plane draws in the
 * opaque pass via alphaTest and writes depth, so the gas shell (drawn
 * after, in the transparent pass) veils it naturally. Billboarding is
 * done against the full parent chain (orbit plane + SystemRig rotation),
 * so it stays screen-aligned however the system is swiped around.
 */
function PlanetLogo({
  slug,
  size,
}: {
  slug: CapabilitySlug;
  size: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const scratchQuaternion = useRef(new THREE.Quaternion());
  const { texture, ready } = useCapabilityLogoTexture(slug);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group || !group.parent) return;
    group.parent.getWorldQuaternion(scratchQuaternion.current);
    group.quaternion
      .copy(scratchQuaternion.current.invert())
      .multiply(camera.quaternion);
  });

  // Never draw the plane before the texture has pixels: an incomplete
  // texture samples opaque black on GLES — a black box, not a logo.
  if (!ready) return null;

  return (
    <group ref={groupRef}>
      <mesh>
        <planeGeometry args={[size, size]} />
        {/* alphaTest keeps the emblem in the opaque pass (no transparent-
            sort battles with the shells) and cuts the PNG's clear pixels
            so only the chrome mark itself exists in the depth buffer. */}
        <meshBasicMaterial map={texture} alphaTest={0.28} />
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
      {/* The path line dissolves around the planet's live angle — the gas
          shells don't write depth, so a full circle would slice straight
          through its own translucent world. */}
      <OrbitRing
        radius={orbit.orbitRadius}
        planetAngleRef={angleRef}
        gapHalfWidth={(orbit.size * 2.6) / orbit.orbitRadius}
        opacity={0.14}
      />
      <group ref={bodyRef}>
        {/* Spin axis = this orbit's own axis (the plane group's local Y):
            an equatorial world turns like the system, a polar one rolls
            with its polar orbit — and fast enough to actually read. */}
        <PlanetSurface
          entityId={`capability.${orbit.slug}`}
          biome={orbit.biome}
          radius={orbit.size}
          spinSpeed={0.3 + orbit.orbitSpeed}
          paused={paused}
          focused={focused}
        />
        {/* 2.9× radius puts the ring's inner edge (≈39% of the texture
            width from center) just outside the sphere silhouette — the
            chrome ring hugs the planet like on the web landing. */}
        <PlanetLogo slug={orbit.slug} size={orbit.size * 2.9} />
      </group>
    </group>
  );
}
