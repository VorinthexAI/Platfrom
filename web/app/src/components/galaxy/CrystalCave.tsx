"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  useLeaderboardStore,
  type CaveEntry,
} from "@/lib/leaderboard/leaderboard-store";
import {
  createCrystalGeometry,
  createEdgyCrystalPieces,
  crystalTintForValue,
  CRYSTAL_VARIANTS,
  EDGY_CRYSTAL_GENERATOR,
} from "@/lib/three/crystal";
import { hashString, mulberry32 } from "@/lib/three/procedural";
import { CHAMBER_RADIUS } from "./BiomeChamber";

/**
 * The leaderboard asteroid's crystal cave: every piece the galaxy has
 * claimed (streamed live over SSE) mounts to the chamber's walls, floor,
 * and roof, pointing in toward the camera — together they line the whole
 * room with treasure. Each piece renders its EXACT persisted mesh recipe
 * at the spot its collection-time placement seed dictates, and its age
 * decides its life:
 *   < 1h   — glittering hard (fresh, enviable)
 *   1–24h  — the shimmer fades hour by hour
 *   > 24h  — gray, dim, locked into the rock forever
 */

const WALL_RADIUS = CHAMBER_RADIUS * 0.9;

function ageFactor(createdAt: string, nowMs: number): number {
  const ageMs = nowMs - Date.parse(createdAt);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const hours = ageMs / 3_600_000;
  if (hours <= 1) return 1;
  if (hours >= 24) return 0;
  // Linear fade across the remaining 23 hours.
  return 1 - (hours - 1) / 23;
}

function MountedPiece({ entry }: { entry: CaveEntry }) {
  const groupRef = useRef<THREE.Group>(null);
  const materialsRef = useRef<THREE.MeshStandardMaterial[]>([]);

  const seed = entry.placementSeed ?? hashString(entry.key);
  const mesh = entry.mesh ?? {};
  const generator = typeof mesh.generator === "string" ? mesh.generator : "crystal-v1";
  const meshSeed = typeof mesh.seed === "number" ? mesh.seed : seed;
  const value =
    mesh.params && typeof mesh.params === "object" &&
    typeof (mesh.params as Record<string, unknown>).value === "number"
      ? ((mesh.params as Record<string, unknown>).value as number)
      : entry.fragments;

  const placement = useMemo(() => {
    // The collection-time placement seed IS the spot: a direction over the
    // whole sphere (walls, floor, roof) plus a size tuned to its value.
    const random = mulberry32(seed);
    const y = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const h = Math.sqrt(Math.max(0, 1 - y * y));
    const direction = new THREE.Vector3(
      Math.cos(theta) * h,
      y,
      Math.sin(theta) * h,
    );
    const position = direction.clone().multiplyScalar(WALL_RADIUS);
    // Mount with the crystal's +Y pointing inward, toward the camera.
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.clone().negate(),
    );
    const scale = Math.min(0.16 + Math.log10(Math.max(value, 1) + 1) * 0.11, 0.85);
    const shimmerPhase = random() * Math.PI * 2;
    return { position, quaternion, scale, shimmerPhase };
  }, [seed, value]);

  const pieces = useMemo(
    () =>
      generator === EDGY_CRYSTAL_GENERATOR
        ? createEdgyCrystalPieces(meshSeed)
        : null,
    [generator, meshSeed],
  );
  const geometry = useMemo(() => {
    if (pieces) return null;
    const variant =
      typeof mesh.variant === "number" ? mesh.variant : meshSeed;
    return createCrystalGeometry(((variant % CRYSTAL_VARIANTS) + CRYSTAL_VARIANTS) % CRYSTAL_VARIANTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces, meshSeed]);
  useEffect(
    () => () => {
      geometry?.dispose();
      if (pieces) for (const piece of pieces) piece.geometry.dispose();
    },
    [geometry, pieces],
  );

  const freshTint = crystalTintForValue(value);

  useFrame(() => {
    // Age is applied imperatively (Date.now is impure for render): fresh
    // pieces glitter hard and breathe; day-old pieces sit gray and still.
    const now = Date.now();
    const age = ageFactor(entry.createdAt, now);
    const t = now * 0.004 + placement.shimmerPhase;
    const shimmer = age > 0 ? (Math.sin(t) * 0.5 + 0.5) * 1.6 * age : 0;
    for (const material of materialsRef.current) {
      if (!material) continue;
      material.emissiveIntensity = 0.15 + shimmer;
      material.color.set(age > 0 ? freshTint.color : "#4b5157");
      material.emissive.set(age > 0 ? freshTint.emissive : "#1a1e22");
      material.roughness = age > 0 ? 0.16 : 0.6;
      material.metalness = age > 0 ? 0.3 : 0.15;
    }
    const group = groupRef.current;
    if (group && age > 0.96) {
      // Newborn pieces also breathe for their first minutes on the wall.
      group.scale.setScalar(placement.scale * (1 + Math.sin(t * 1.4) * 0.05));
    }
  });

  const material = (index: number) => (
    <meshStandardMaterial
      ref={(node) => {
        if (node) materialsRef.current[index] = node;
      }}
      color={freshTint.color}
      metalness={0.3}
      roughness={0.16}
      emissive={freshTint.emissive}
      emissiveIntensity={0.6}
      flatShading={Boolean(pieces)}
    />
  );

  return (
    <group
      ref={groupRef}
      position={placement.position}
      quaternion={placement.quaternion}
      scale={placement.scale}
    >
      {pieces
        ? pieces.map((piece, index) => (
            <mesh
              key={index}
              geometry={piece.geometry}
              position={piece.position}
              rotation={piece.rotation}
            >
              {material(index)}
            </mesh>
          ))
        : geometry
          ? <mesh geometry={geometry}>{material(0)}</mesh>
          : null}
    </group>
  );
}

export function CrystalCave() {
  const entries = useLeaderboardStore((s) => s.entries);
  // Only pieces that carry a mesh recipe can render exactly; legacy
  // entries without one still count in the totals, just not on the walls.
  const mounted = useMemo(
    () => entries.filter((entry) => entry.mesh && typeof entry.mesh.generator === "string"),
    [entries],
  );

  return (
    <group>
      {mounted.map((entry) => (
        <MountedPiece key={entry.key} entry={entry} />
      ))}
    </group>
  );
}
