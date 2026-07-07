"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  createAsteroidGeometry,
  createAsteroidMaterial,
  type AsteroidMaterial,
  type AsteroidTone,
} from "@/lib/three/asteroid";
import { mulberry32 } from "@/lib/three/procedural";

export type AsteroidState = "default" | "hover" | "selected" | "locked";

interface AsteroidRockProps {
  seed: number;
  /** World-space mean radius of the rock. */
  radius: number;
  detail?: number;
  tone?: AsteroidTone;
  state?: AsteroidState;
  paused?: boolean;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (event: ThreeEvent<PointerEvent>) => void;
}

/** Interaction states from the reference sheet (design/astriods.png). */
const STATE_TARGETS: Record<
  AsteroidState,
  { rim: number; emissive: number; tint: THREE.Color; roughness: number; spin: number }
> = {
  default: {
    rim: 0.24,
    emissive: 0.55,
    tint: new THREE.Color("#ffffff"),
    roughness: 0.55,
    spin: 1,
  },
  hover: {
    rim: 0.55,
    emissive: 0.85,
    tint: new THREE.Color("#ffffff"),
    roughness: 0.5,
    spin: 1.8,
  },
  selected: {
    rim: 0.95,
    emissive: 1.15,
    tint: new THREE.Color("#ffffff"),
    roughness: 0.45,
    spin: 1.2,
  },
  locked: {
    // Visible but desaturated with a soft silver tone.
    rim: 0.14,
    emissive: 0.32,
    tint: new THREE.Color("#98a1a9"),
    roughness: 0.72,
    spin: 0.55,
  },
};

/**
 * A single interactive procedural asteroid — the hero-rock building block
 * for collectible shards and orbiting satellite bodies.
 */
export function AsteroidRock({
  seed,
  radius,
  detail = 2,
  tone = "silver",
  state = "default",
  paused = false,
  onClick,
  onPointerOver,
  onPointerOut,
}: AsteroidRockProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(
    () => createAsteroidGeometry(seed, { detail, tone }),
    [seed, detail, tone],
  );
  const material = useMemo(
    () => createAsteroidMaterial({ tone }),
    [tone],
  );
  const spinAxis = useMemo(() => {
    const random = mulberry32(seed ^ 0x77aa);
    return {
      x: (random() - 0.5) * 0.5,
      y: 0.25 + random() * 0.45,
      z: (random() - 0.5) * 0.35,
    };
  }, [seed]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Mutate through the mesh ref — the material instance is shared state
    // owned by three, not React.
    const mat = mesh.material as AsteroidMaterial;
    const target = STATE_TARGETS[state];
    mat.userData.rimStrength.value = THREE.MathUtils.damp(
      mat.userData.rimStrength.value,
      target.rim,
      6,
      delta,
    );
    mat.emissiveIntensity = THREE.MathUtils.damp(
      mat.emissiveIntensity,
      target.emissive,
      6,
      delta,
    );
    mat.roughness = THREE.MathUtils.damp(mat.roughness, target.roughness, 6, delta);
    mat.color.lerp(target.tint, Math.min(delta * 6, 1));

    if (!paused) {
      const spin = delta * 0.2 * target.spin;
      mesh.rotation.x += spinAxis.x * spin;
      mesh.rotation.y += spinAxis.y * spin;
      mesh.rotation.z += spinAxis.z * spin;
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      scale={radius}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    />
  );
}
