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

/**
 * Rare biome crystals: very noisy, edgy shard clusters — nothing globe-
 * like. Built as discrete pieces so the assembly animation can erupt each
 * shard from the floor and fuse it into its exact final slot; rendering
 * the same pieces afterwards preserves the exact mesh, and the (generator,
 * seed) pair is what gets persisted to the backend as the mesh recipe.
 */

export const EDGY_CRYSTAL_GENERATOR = "edgy-crystal-v1";

export interface CrystalPiece {
  geometry: THREE.BufferGeometry;
  /** Final resting position of the piece inside the cluster. */
  position: [number, number, number];
  rotation: [number, number, number];
}

/** One jagged shard: a low-poly spike with heavy random vertex jitter. */
function createJaggedShard(random: () => number, length: number, radius: number) {
  const sides = 4 + Math.floor(random() * 3);
  const body = new THREE.CylinderGeometry(
    radius * (0.2 + random() * 0.4),
    radius,
    length,
    sides,
    2,
  );
  body.translate(0, length * 0.5, 0);
  const position = body.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) + (random() - 0.5) * radius * 0.9,
      position.getY(i) + (random() - 0.5) * length * 0.14,
      position.getZ(i) + (random() - 0.5) * radius * 0.9,
    );
  }
  // Deliberately unwelded, flat-shaded facets: hard edges everywhere.
  body.computeVertexNormals();
  return body;
}

/**
 * A seeded edgy crystal cluster split into pieces. Deterministic: the same
 * seed always reproduces the exact same shards in the exact same slots.
 */
export function createEdgyCrystalPieces(seed: number): CrystalPiece[] {
  const random = mulberry32(seed ^ 0xed6ec1);
  const pieces: CrystalPiece[] = [];

  // Towering main shards.
  const mains = 2 + Math.floor(random() * 3);
  for (let i = 0; i < mains; i++) {
    const length = 0.7 + random() * 0.6;
    pieces.push({
      geometry: createJaggedShard(random, length, 0.12 + random() * 0.09),
      position: [
        (random() - 0.5) * 0.24,
        -0.05 + random() * 0.05,
        (random() - 0.5) * 0.24,
      ],
      rotation: [
        (random() - 0.5) * 0.5,
        random() * Math.PI * 2,
        (random() - 0.5) * 0.5,
      ],
    });
  }

  // A skirt of splayed satellites.
  const satellites = 5 + Math.floor(random() * 7);
  for (let i = 0; i < satellites; i++) {
    const yaw = (i / satellites) * Math.PI * 2 + random() * 0.9;
    const spread = 0.14 + random() * 0.22;
    pieces.push({
      geometry: createJaggedShard(
        random,
        0.22 + random() * 0.45,
        0.05 + random() * 0.07,
      ),
      position: [Math.cos(yaw) * spread, -0.04, Math.sin(yaw) * spread],
      rotation: [
        0.4 + random() * 0.8,
        yaw + (random() - 0.5) * 0.6,
        (random() - 0.5) * 0.5,
      ],
    });
  }

  // Chaotic debris chunks wedged between the shards.
  const chunks = 3 + Math.floor(random() * 5);
  for (let i = 0; i < chunks; i++) {
    const chunk = new THREE.TetrahedronGeometry(0.06 + random() * 0.1, 0);
    const position = chunk.getAttribute("position") as THREE.BufferAttribute;
    for (let v = 0; v < position.count; v++) {
      position.setXYZ(
        v,
        position.getX(v) * (0.7 + random() * 0.8),
        position.getY(v) * (0.7 + random() * 0.8),
        position.getZ(v) * (0.7 + random() * 0.8),
      );
    }
    chunk.computeVertexNormals();
    const yaw = random() * Math.PI * 2;
    const spread = 0.1 + random() * 0.3;
    pieces.push({
      geometry: chunk,
      position: [Math.cos(yaw) * spread, random() * 0.12, Math.sin(yaw) * spread],
      rotation: [random() * Math.PI, random() * Math.PI, random() * Math.PI],
    });
  }

  return pieces;
}

/** Crystal value → luminous tint tier. */
export function crystalTintForValue(value: number): CrystalTint {
  if (value >= 5000) return crystalTintForRarity("founder");
  if (value >= 1000) return crystalTintForRarity("rare");
  if (value >= 300) return crystalTintForRarity("uncommon");
  return crystalTintForRarity("common");
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
