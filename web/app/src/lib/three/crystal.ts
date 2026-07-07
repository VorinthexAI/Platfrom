import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./procedural";

/**
 * Intelligence Fragment crystals: clusters of sharp hexagonal spikes —
 * luminous, geometric, unmistakably NOT asteroids. 25 seeded cluster
 * variants (spike count, lengths, splay angles) so no two fragments in
 * the galaxy read identical.
 */

export const CRYSTAL_VARIANTS = 25;

/** One hexagonal quartz-like spike: body prism + pointed tip. */
function createSpike(
  length: number,
  radius: number,
): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(
    radius * 0.62,
    radius,
    length * 0.7,
    6,
    1,
  );
  body.translate(0, length * 0.35, 0);
  const tip = new THREE.ConeGeometry(radius * 0.62, length * 0.3, 6, 1);
  tip.translate(0, length * 0.85, 0);
  const merged = mergeGeometries([body, tip]);
  body.dispose();
  tip.dispose();
  return merged;
}

/**
 * A seeded crystal cluster with its base at the origin, main spike
 * pointing +Y, overall height ~1.
 */
export function createCrystalGeometry(variant: number): THREE.BufferGeometry {
  const random = mulberry32(0xc4157a1 ^ (variant * 2654435761));
  const spikes: THREE.BufferGeometry[] = [];

  // Main spike.
  const mainLength = 0.75 + random() * 0.35;
  const main = createSpike(mainLength, 0.14 + random() * 0.05);
  main.rotateY(random() * Math.PI);
  spikes.push(main);

  // 1–4 satellites splayed around the base.
  const satellites = 1 + Math.floor(random() * 4);
  for (let i = 0; i < satellites; i++) {
    const length = 0.28 + random() * 0.4;
    const spike = createSpike(length, 0.07 + random() * 0.05);
    const yaw = (i / satellites) * Math.PI * 2 + random() * 0.8;
    const tilt = 0.35 + random() * 0.55;
    spike.rotateZ(tilt);
    spike.rotateY(yaw);
    spike.translate(
      Math.cos(yaw) * 0.08,
      -0.02,
      Math.sin(yaw) * 0.08,
    );
    spikes.push(spike);
  }

  const cluster = mergeGeometries(spikes);
  for (const spike of spikes) spike.dispose();
  cluster.center();
  cluster.computeVertexNormals();
  cluster.computeBoundingSphere();
  return cluster;
}

export interface CrystalTint {
  color: string;
  emissive: string;
  glow: string;
}

/** Rarity → luminous tint. Violet is reserved for rare finds (reference palette). */
export function crystalTintForRarity(rarity: string): CrystalTint {
  switch (rarity) {
    case "founder":
    case "legendary":
      return { color: "#5a3c22", emissive: "#e8842e", glow: "#ffb25c" };
    case "rare":
      return { color: "#3a3352", emissive: "#8f7bd8", glow: "#b3a3f0" };
    case "uncommon":
      return { color: "#2c3a46", emissive: "#9fb4c7", glow: "#c2d5e4" };
    default:
      return { color: "#39424d", emissive: "#dde2e5", glow: "#f5f7f8" };
  }
}
