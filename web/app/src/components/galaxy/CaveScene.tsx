"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { CAVE_CONFIGS, ROCK_THEMES } from "@/lib/cave-config";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { useGalaxyStore } from "@/lib/galaxy-store";
import {
  createCrystalGeometry,
  crystalTintForRarity,
  CRYSTAL_VARIANTS,
} from "@/lib/three/crystal";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";
import { BiomeChamber, CHAMBER_RADIUS } from "./BiomeChamber";

/**
 * The asteroid caves: each auth flow opens the seeded interior of a belt
 * asteroid — and every ORDINARY belt rock is enterable too, a hollow,
 * near-empty pocket with a few loose fragments glittering in the dust.
 * The chamber regenerates from a fresh seed on every entry — the same
 * vault is never quite the same cavern twice.
 */

/** One loose fragment crystal: click to scavenge, watch it dissolve. */
function LooseCrystal({
  position,
  variant,
  onCollect,
}: {
  position: [number, number, number];
  variant: number;
  onCollect: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);
  const [taken, setTaken] = useState(false);
  const [gone, setGone] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tint = crystalTintForRarity("common");

  const geometry = useMemo(
    () => createCrystalGeometry(variant % CRYSTAL_VARIANTS),
    [variant],
  );
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    timeRef.current += delta;
    // Buried through the first blast, then grown from the floor; taken
    // treasure dissolves into light.
    const target = taken || timeRef.current < 0.9 + variant * 0.17 ? 0.001 : 1;
    const scale = THREE.MathUtils.lerp(group.scale.x, target, delta * 3);
    group.scale.setScalar(scale);
    if (taken && scale < 0.01) setGone(true);
  });

  if (gone) return null;

  const handleCollect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (taken) return;
    setTaken(true);
    document.body.style.cursor = "auto";
    onCollect();
  };

  return (
    <group ref={groupRef} position={position} scale={0.001}>
      <mesh geometry={geometry} scale={0.34}>
        <meshStandardMaterial
          color={tint.color}
          metalness={0.25}
          roughness={0.15}
          emissive={tint.emissive}
          emissiveIntensity={hovered ? 1.4 : 0.9}
          transparent
          opacity={0.96}
        />
      </mesh>
      <sprite scale={[1.2, 1.2, 1]}>
        <spriteMaterial
          map={getDotTexture()}
          color={tint.glow}
          transparent
          opacity={hovered ? 0.42 : 0.24}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <mesh
        visible={false}
        onClick={handleCollect}
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

/** The rock's meagre riches: 2–4 loose crystals scattered on the floor. */
function LooseFragments({ seed }: { seed: number }) {
  const collectLoose = useFragmentsStore((s) => s.collectLoose);

  const crystals = useMemo(() => {
    const random = mulberry32(seed ^ 0x10c5e);
    const count = 2 + Math.floor(random() * 3);
    return Array.from({ length: count }, (_, index) => {
      const angle = random() * Math.PI * 2;
      const radius = 1.1 + random() * (CHAMBER_RADIUS * 0.45);
      return {
        position: [
          Math.cos(angle) * radius,
          -CHAMBER_RADIUS * 0.52 + 0.22,
          Math.sin(angle) * radius,
        ] as [number, number, number],
        variant: Math.floor(random() * CRYSTAL_VARIANTS),
        amount: 3 + Math.floor(random() * 7),
        key: `${seed}-${index}`,
      };
    });
  }, [seed]);

  return (
    <group>
      {crystals.map((crystal) => (
        <LooseCrystal
          key={crystal.key}
          position={crystal.position}
          variant={crystal.variant}
          onCollect={() => collectLoose(crystal.amount)}
        />
      ))}
    </group>
  );
}

export function CaveScene() {
  const mode = useGalaxyStore((s) => s.mode);
  const caveKind = useGalaxyStore((s) => s.caveKind);
  const cavePhase = useGalaxyStore((s) => s.cavePhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  if (mode !== "cave" || !caveKind) return null;
  // Mount during the veil ("enter") so the world is ready on arrival.
  if (cavePhase === "fly") return null;
  const config = CAVE_CONFIGS[caveKind];
  // Uncharted rocks roll their chamber theme with the visit seed.
  const theme =
    caveKind === "rock"
      ? ROCK_THEMES[visitSeed % ROCK_THEMES.length]
      : config.theme;
  return (
    <BiomeChamber styleKey={theme} seed={visitSeed} position={config.interior}>
      {caveKind === "rock" ? <LooseFragments seed={visitSeed} /> : null}
    </BiomeChamber>
  );
}
