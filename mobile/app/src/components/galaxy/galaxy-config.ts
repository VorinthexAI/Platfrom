import type { PlanetBiome } from "@/lib/three/planet";
import type { CapabilitySlug } from "@/data/registry";

/**
 * Orbit + biome assignment for each capability world. Orbit planes
 * alternate between near-equatorial and near-polar so together they cage
 * the brain in a 3D globe of rings (the web galaxy orbits in one plane;
 * this is the deliberate mobile difference).
 */
export type CapabilityOrbit = {
  slug: CapabilitySlug;
  biome: PlanetBiome;
  orbitRadius: number;
  orbitSpeed: number;
  initialAngle: number;
  /** Planet sphere radius in scene units. */
  size: number;
  /** Euler rotation of the orbit plane (XYZ order). */
  plane: [number, number, number];
};

const POLAR = Math.PI / 2;

export const CAPABILITY_ORBITS: readonly CapabilityOrbit[] = [
  {
    slug: "archive",
    biome: "marble",
    orbitRadius: 2.7,
    orbitSpeed: 0.22,
    initialAngle: 0.6,
    size: 0.4,
    plane: [0.14, 0, 0.06],
  },
  {
    slug: "gallery",
    biome: "lush",
    orbitRadius: 3.3,
    orbitSpeed: 0.17,
    initialAngle: 2.4,
    size: 0.44,
    plane: [POLAR - 0.16, 0.55, 0],
  },
  {
    slug: "signal",
    biome: "ice",
    orbitRadius: 3.9,
    orbitSpeed: 0.13,
    initialAngle: 4.2,
    size: 0.38,
    plane: [0.4, 0, -0.22],
  },
  {
    slug: "compass",
    biome: "ocean",
    orbitRadius: 4.5,
    orbitSpeed: 0.105,
    initialAngle: 1.5,
    size: 0.46,
    plane: [POLAR + 0.12, 2.15, 0],
  },
  {
    slug: "ascend",
    biome: "mountain",
    orbitRadius: 5.1,
    orbitSpeed: 0.085,
    initialAngle: 5.3,
    size: 0.42,
    plane: [-0.3, 0, 0.32],
  },
];

export function orbitForSlug(slug: CapabilitySlug): CapabilityOrbit {
  const orbit = CAPABILITY_ORBITS.find((entry) => entry.slug === slug);
  if (!orbit) throw new Error(`No orbit configured for ${slug}`);
  return orbit;
}
