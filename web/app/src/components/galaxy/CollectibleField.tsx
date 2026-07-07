"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { CollectibleDef } from "@/lib/galaxy/registry-types";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import {
  createCrystalGeometry,
  crystalTintForRarity,
  CRYSTAL_VARIANTS,
} from "@/lib/three/crystal";
import { getDotTexture } from "@/lib/three/dot-texture";
import { hashString, mulberry32 } from "@/lib/three/procedural";

/**
 * Hidden Intelligence Fragments drifting through the galaxy — luminous
 * crystal clusters, unmistakably not asteroids: sharp hexagonal spikes,
 * inner glow, a soft halo, slow hovering drift. Click to inspect and
 * collect; collected crystals dissolve into light. Positions and rewards come
 * from the registry; collects are validated server-side.
 */

function CrystalShard({
  collectible,
  paused,
}: {
  collectible: CollectibleDef;
  paused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const crystalRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(collectible.position[0] * 0.7);
  const [gone, setGone] = useState(false);
  const [hovered, setHovered] = useState(false);
  const select = useFragmentsStore((s) => s.select);
  const collected = useFragmentsStore((s) =>
    s.collectedIds.includes(collectible.id),
  );
  const isSelected = useFragmentsStore(
    (s) => s.selected?.id === collectible.id,
  );

  const variant = hashString(collectible.id) % CRYSTAL_VARIANTS;
  const tint = crystalTintForRarity(collectible.rarity);

  const geometry = useMemo(() => createCrystalGeometry(variant), [variant]);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  const baseTilt = useMemo(() => {
    const random = mulberry32(hashString(collectible.id) ^ 0x71c7);
    return {
      x: (random() - 0.5) * 0.9,
      z: (random() - 0.5) * 0.9,
      spin: 0.25 + random() * 0.3,
    };
  }, [collectible.id]);

  useFrame((_, delta) => {
    if (paused || !groupRef.current) return;
    timeRef.current += delta;
    groupRef.current.rotation.y += delta * baseTilt.spin;
    groupRef.current.position.y =
      collectible.position[1] + Math.sin(timeRef.current * 0.6) * 0.22;
    // Collected crystals dissolve toward light, then unmount.
    const target = collected ? 0.001 : 1;
    const scale = THREE.MathUtils.lerp(
      groupRef.current.scale.x,
      target,
      delta * 3,
    );
    groupRef.current.scale.setScalar(scale);
    if (collected && scale < 0.01) setGone(true);

    if (crystalRef.current) {
      const material = crystalRef.current.material as THREE.MeshStandardMaterial;
      const emissiveTarget = isSelected ? 1.8 : hovered ? 1.3 : 0.85;
      material.emissiveIntensity = THREE.MathUtils.damp(
        material.emissiveIntensity,
        emissiveTarget + Math.sin(timeRef.current * 2.1) * 0.12,
        6,
        delta,
      );
    }
  });

  if (gone) return null;

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (!collected) select(collectible);
  };

  return (
    <group
      ref={groupRef}
      position={collectible.position}
      rotation={[baseTilt.x, 0, baseTilt.z]}
    >
      <mesh ref={crystalRef} geometry={geometry} scale={0.34}>
        <meshStandardMaterial
          color={tint.color}
          metalness={0.25}
          roughness={0.15}
          emissive={tint.emissive}
          emissiveIntensity={0.85}
          transparent
          opacity={0.96}
        />
      </mesh>
      {/* soft halo so explorers can spot the glint from afar */}
      <sprite scale={[1.15, 1.15, 1]}>
        <spriteMaterial
          map={getDotTexture()}
          color={tint.glow}
          transparent
          opacity={hovered || isSelected ? 0.4 : 0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <pointLight
        color={tint.glow}
        intensity={isSelected ? 1.6 : hovered ? 1 : 0.55}
        distance={3}
        decay={2}
      />
      {/* generous invisible hit target — fragments must be easy to collect */}
      <mesh
        visible={false}
        onClick={handleSelect}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[0.55, 12, 12]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

export function CollectibleField({ paused }: { paused: boolean }) {
  const collectibles = VORINTHEX_GALAXY_REGISTRY.collectibles.filter(
    (c) => c.isDiscoverable,
  );
  return (
    <group>
      {collectibles.map((collectible) => (
        <CrystalShard
          key={collectible.id}
          collectible={collectible}
          paused={paused}
        />
      ))}
    </group>
  );
}
