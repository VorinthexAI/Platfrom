import * as THREE from "three";
import { fbm3, hashString, mulberry32 } from "./procedural";

/**
 * Biome-driven procedural worlds. Each planet/moon gets a silhouette pass
 * (vertex displacement baked at build time, with a per-vertex height
 * attribute the shader can tint by) and a biome style consumed by the
 * PlanetSurface shader. Palette stays in-brand: obsidian, silver, cold
 * steel-blues, muted teal, and ember — no candy colors.
 */

export type PlanetBiome =
  | "steel" // fractured command plates
  | "marble" // flowing chrome marble
  | "gas" // banded gas giant
  | "ice" // pale crackled ice world
  | "ocean" // dark water world with graphite islands
  | "lava" // obsidian crust with glowing ember fissures
  | "cratered" // impact-scarred grey world
  | "mountain" // ridged rocky world with silver peaks
  | "lush"; // muted bioluminescent moss world

export interface BiomeStyle {
  base: string;
  deep: string;
  vein: string;
  accent: string;
  rim: string;
  atmosphere: string;
  bandFreq: number;
  bandWeight: number;
  crackWeight: number;
  craterWeight: number;
  /** Emissive glow along the crack network (lava fissures, lush glow). */
  glowWeight: number;
  /** How strongly per-vertex height tints toward `vein` (mountain snow caps). */
  heightWeight: number;
  specStrength: number;
  /** Procedural bump-normal strength (0 = smooth gas, 1 = harsh rock). */
  bump: number;
  /** Animated cloud-shell coverage (0 = airless). */
  clouds: number;
  noiseFreq: number;
  warp: number;
  accentWeight: number;
  flow: number;
  displacement: { amp: number; ridged: number; craters: number };
}

const BIOME_STYLES: Record<PlanetBiome, BiomeStyle> = {
  steel: {
    base: "#28313d", deep: "#0d1218", vein: "#aeb6bc", accent: "#9fb4c7",
    rim: "#9fb4c7", atmosphere: "#8fa3b5",
    bandFreq: 1.5, bandWeight: 0.14, crackWeight: 0.5, craterWeight: 0,
    glowWeight: 0, heightWeight: 0, specStrength: 0.55, bump: 0.65, clouds: 0,
    noiseFreq: 2.7, warp: 0.85, accentWeight: 0.08, flow: 0.008,
    displacement: { amp: 0.012, ridged: 0.35, craters: 0 },
  },
  marble: {
    base: "#222b36", deep: "#0b0f15", vein: "#dde2e5", accent: "#c9ced2",
    rim: "#c9ced2", atmosphere: "#aeb6bc",
    bandFreq: 8.5, bandWeight: 0.55, crackWeight: 0.24, craterWeight: 0,
    glowWeight: 0, heightWeight: 0, specStrength: 0.6, bump: 0.35, clouds: 0,
    noiseFreq: 2.2, warp: 1.7, accentWeight: 0.06, flow: 0.02,
    displacement: { amp: 0.006, ridged: 0, craters: 0 },
  },
  gas: {
    base: "#39434f", deep: "#11161d", vein: "#c9ced2", accent: "#8a97a6",
    rim: "#aeb6bc", atmosphere: "#9aa9b8",
    bandFreq: 14, bandWeight: 0.85, crackWeight: 0.05, craterWeight: 0,
    glowWeight: 0, heightWeight: 0, specStrength: 0.2, bump: 0.08, clouds: 0.35,
    noiseFreq: 1.8, warp: 2.6, accentWeight: 0.14, flow: 0.05,
    displacement: { amp: 0, ridged: 0, craters: 0 },
  },
  ice: {
    base: "#8fa3b3", deep: "#2a3743", vein: "#f5f7f8", accent: "#b8c8d4",
    rim: "#d7e2ea", atmosphere: "#c2d2dd",
    bandFreq: 2, bandWeight: 0.1, crackWeight: 0.65, craterWeight: 0.1,
    glowWeight: 0, heightWeight: 0.25, specStrength: 0.85, bump: 0.6, clouds: 0.2,
    noiseFreq: 3.1, warp: 0.7, accentWeight: 0.1, flow: 0.004,
    displacement: { amp: 0.015, ridged: 0.3, craters: 0.2 },
  },
  ocean: {
    base: "#1d3040", deep: "#08111a", vein: "#31424f", accent: "#6f838f",
    rim: "#9fb4c7", atmosphere: "#7f97a8",
    bandFreq: 1, bandWeight: 0.08, crackWeight: 0.12, craterWeight: 0,
    glowWeight: 0, heightWeight: 0.55, specStrength: 1.15, bump: 0.3, clouds: 0.5,
    noiseFreq: 2.4, warp: 1.2, accentWeight: 0.3, flow: 0.015,
    displacement: { amp: 0.01, ridged: 0.5, craters: 0 },
  },
  lava: {
    base: "#191d23", deep: "#07090c", vein: "#3a3f46", accent: "#c26a2c",
    rim: "#b06a38", atmosphere: "#8a5a30",
    bandFreq: 2.4, bandWeight: 0.18, crackWeight: 0.55, craterWeight: 0.08,
    glowWeight: 0.9, heightWeight: 0, specStrength: 0.35, bump: 0.95, clouds: 0,
    noiseFreq: 2.9, warp: 1.3, accentWeight: 0.12, flow: 0.02,
    displacement: { amp: 0.02, ridged: 0.55, craters: 0.15 },
  },
  cratered: {
    base: "#59606a", deep: "#20262d", vein: "#8f99a3", accent: "#767f89",
    rim: "#aeb6bc", atmosphere: "#8f99a3",
    bandFreq: 1, bandWeight: 0.05, crackWeight: 0.12, craterWeight: 0.75,
    glowWeight: 0, heightWeight: 0.2, specStrength: 0.25, bump: 1.0, clouds: 0,
    noiseFreq: 3.4, warp: 0.5, accentWeight: 0.08, flow: 0.002,
    displacement: { amp: 0.02, ridged: 0.25, craters: 1 },
  },
  mountain: {
    base: "#3b4249", deep: "#14181d", vein: "#e8edf0", accent: "#9fb4c7",
    rim: "#c2ccd3", atmosphere: "#9aa6b0",
    bandFreq: 1, bandWeight: 0.06, crackWeight: 0.22, craterWeight: 0,
    glowWeight: 0, heightWeight: 1, specStrength: 0.4, bump: 1.0, clouds: 0.15,
    noiseFreq: 2.8, warp: 0.9, accentWeight: 0.1, flow: 0.003,
    displacement: { amp: 0.05, ridged: 1, craters: 0 },
  },
  lush: {
    base: "#28382f", deep: "#0b1310", vein: "#5f7a63", accent: "#7fae8a",
    rim: "#9fc7a8", atmosphere: "#86b493",
    bandFreq: 1.6, bandWeight: 0.12, crackWeight: 0.45, craterWeight: 0,
    glowWeight: 0.35, heightWeight: 0.3, specStrength: 0.5, bump: 0.7, clouds: 0.45,
    noiseFreq: 2.6, warp: 1.4, accentWeight: 0.22, flow: 0.012,
    displacement: { amp: 0.018, ridged: 0.4, craters: 0 },
  },
};

/** Biomes eligible for hashed child-moon assignment (visual variety pool). */
const MOON_BIOME_POOL: PlanetBiome[] = [
  "ice", "ocean", "cratered", "mountain", "lush", "marble", "gas", "lava", "steel",
];

export function biomeForEntity(
  entityId: string,
  explicit?: string,
): PlanetBiome {
  if (explicit && explicit in BIOME_STYLES) return explicit as PlanetBiome;
  return MOON_BIOME_POOL[hashString(entityId) % MOON_BIOME_POOL.length] ?? "cratered";
}

/**
 * Per-entity style: the biome's palette, hue-jittered deterministically so
 * two moons sharing a biome still read as different worlds.
 */
export function biomeStyleFor(entityId: string, biome: PlanetBiome): BiomeStyle {
  const style = BIOME_STYLES[biome];
  const random = mulberry32(hashString(entityId) ^ 0x5eed);
  const jitter = (hex: string, amount: number) => {
    const color = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    color.setHSL(
      (hsl.h + (random() - 0.5) * amount + 1) % 1,
      Math.min(Math.max(hsl.s + (random() - 0.5) * amount * 0.9, 0), 1),
      Math.min(Math.max(hsl.l + (random() - 0.5) * amount * 0.5, 0.03), 0.92),
    );
    return `#${color.getHexString()}`;
  };
  return {
    ...style,
    base: jitter(style.base, 0.08),
    deep: jitter(style.deep, 0.05),
    vein: jitter(style.vein, 0.04),
    accent: jitter(style.accent, 0.08),
    bandFreq: style.bandFreq * (0.85 + random() * 0.3),
    noiseFreq: style.noiseFreq * (0.85 + random() * 0.3),
    warp: style.warp * (0.85 + random() * 0.3),
  };
}

/**
 * Sphere with baked biome displacement and an `aHeight` attribute in
 * [-1, 1] (relative displacement) for the shader's height tinting.
 */
export function createBiomePlanetGeometry(
  seed: number,
  biome: PlanetBiome,
  radius = 1,
  segments = 96,
): THREE.BufferGeometry {
  const { displacement } = BIOME_STYLES[biome];
  const geometry = new THREE.SphereGeometry(radius, segments, segments);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const heights = new Float32Array(position.count);

  if (displacement.amp > 0) {
    const random = mulberry32(seed);
    const craterList = Array.from(
      { length: Math.round(displacement.craters * 9) },
      () => ({
        dir: new THREE.Vector3(
          random() * 2 - 1,
          random() * 2 - 1,
          random() * 2 - 1,
        ).normalize(),
        radius: 0.12 + random() * 0.3,
        depth: 0.3 + random() * 0.7,
      }),
    );
    const dir = new THREE.Vector3();
    const noiseSeed = seed ^ 0x9e37;

    for (let i = 0; i < position.count; i++) {
      dir.fromBufferAttribute(position, i).normalize();
      let h = fbm3(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, noiseSeed);
      if (displacement.ridged > 0) {
        const ridge =
          1 -
          Math.abs(fbm3(dir.x * 4.6, dir.y * 4.6, dir.z * 4.6, noiseSeed + 7, 3));
        h += (ridge * 2 - 1) * displacement.ridged;
      }
      for (const crater of craterList) {
        const angle = Math.acos(Math.min(Math.max(dir.dot(crater.dir), -1), 1));
        const t = angle / crater.radius;
        if (t < 1) {
          const bowl = (1 - t * t) * (1 - t * t);
          h -= crater.depth * bowl * 1.6;
        }
      }
      h = Math.min(Math.max(h, -1.4), 1.4);
      heights[i] = h / 1.4;
      const r = radius * (1 + h * displacement.amp);
      position.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
    }
    geometry.computeVertexNormals();
  }

  geometry.setAttribute("aHeight", new THREE.BufferAttribute(heights, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
