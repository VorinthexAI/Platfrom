import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fbm3, mulberry32 } from "./procedural";

/**
 * Procedural photoreal-leaning asteroids per design/astriods.png:
 * rocky noise-displaced silhouettes with impact craters, obsidian surfaces
 * threaded with metallic chrome veins, rare micro-light speckles, and a
 * soft fresnel edge glow. Everything is seeded and deterministic.
 */

export type AsteroidTone = "silver" | "ember";

export interface AsteroidGeometryOptions {
  /** Icosahedron subdivision: 1 for belt filler, 2–3 for hero rocks. */
  detail?: number;
  /** Noise displacement amplitude relative to radius 1. */
  amp?: number;
  /** Impact crater count. */
  craters?: number;
  /** Chrome-silver veins or warm ember veins (founder relics, inner belt). */
  tone?: AsteroidTone;
  /** Custom vertex-color palette (overrides the tone's obsidian default). */
  palette?: AsteroidPalette;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function randomUnitVector(random: () => number): THREE.Vector3 {
  const y = random() * 2 - 1;
  const theta = random() * Math.PI * 2;
  const h = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(Math.cos(theta) * h, y, Math.sin(theta) * h);
}

const ROCK = new THREE.Color("#1a212b");
const DEEP = new THREE.Color("#0a0e13");
const VEIN_SILVER = new THREE.Color("#c3ccd3");
const VEIN_EMBER = new THREE.Color("#b06a38");
const SPARK_SILVER = new THREE.Color("#ffffff");
const SPARK_EMBER = new THREE.Color("#ffcf9e");

/** Vertex-color palette baked into the rock geometry. */
export interface AsteroidPalette {
  rock: string;
  deep: string;
  vein: string;
  spark: string;
}

export function createAsteroidGeometry(
  seed: number,
  options: AsteroidGeometryOptions = {},
): THREE.BufferGeometry {
  const { detail = 2, amp = 0.26, craters = 4, tone = "silver" } = options;
  const random = mulberry32(seed);

  // Icosahedron faces come non-indexed; merging vertices lets
  // computeVertexNormals produce smooth rocky shading instead of facets.
  const raw = new THREE.IcosahedronGeometry(1, detail);
  raw.deleteAttribute("uv");
  raw.deleteAttribute("normal");
  const geometry = mergeVertices(raw);
  raw.dispose();

  // Irregular ellipsoid silhouette so no two rocks share a profile.
  const sx = 0.72 + random() * 0.56;
  const sy = 0.72 + random() * 0.56;
  const sz = 0.72 + random() * 0.56;

  const craterList = Array.from({ length: craters }, () => ({
    dir: randomUnitVector(random),
    radius: 0.35 + random() * 0.5,
    depth: (0.35 + random() * 0.65) * amp * 0.75,
  }));

  const sparkleRandom = mulberry32(seed ^ 0x51f15e);
  const noiseSeed = seed ^ 0x9e3779;

  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const dir = new THREE.Vector3();
  const color = new THREE.Color();
  const palette = options.palette;
  const rockColor = palette ? new THREE.Color(palette.rock) : ROCK;
  const deepColor = palette ? new THREE.Color(palette.deep) : DEEP;
  const vein = palette
    ? new THREE.Color(palette.vein)
    : tone === "ember" ? VEIN_EMBER : VEIN_SILVER;
  const spark = palette
    ? new THREE.Color(palette.spark)
    : tone === "ember" ? SPARK_EMBER : SPARK_SILVER;

  for (let i = 0; i < position.count; i++) {
    dir.fromBufferAttribute(position, i).normalize();

    // Large-scale lumps + ridged small detail = rocky surface.
    const lumps = fbm3(dir.x * 2.3, dir.y * 2.3, dir.z * 2.3, noiseSeed);
    const ridges = Math.abs(
      fbm3(dir.x * 5.4, dir.y * 5.4, dir.z * 5.4, noiseSeed + 7, 3),
    );
    let radius = 1 + lumps * amp + ridges * amp * 0.4;

    // Impact craters: smooth bowls with a faint raised rim.
    for (const crater of craterList) {
      const angle = Math.acos(
        Math.min(Math.max(dir.dot(crater.dir), -1), 1),
      );
      const t = angle / crater.radius;
      if (t < 1) {
        const bowl = (1 - t * t) * (1 - t * t);
        radius -= crater.depth * bowl;
      }
      radius +=
        crater.depth * 0.3 * Math.exp(-(((t - 1.05) / 0.18) ** 2));
    }

    position.setXYZ(i, dir.x * radius * sx, dir.y * radius * sy, dir.z * radius * sz);

    // Vertex colors: crevices fall to deep obsidian, high ground is
    // graphite rock, thin ridged bands read as metallic veins.
    const height = (radius - 1) / amp;
    const shade =
      0.82 + fbm3(dir.x * 3.1, dir.y * 3.1, dir.z * 3.1, noiseSeed + 31) * 0.3;
    color
      .copy(deepColor)
      .lerp(rockColor, Math.min(Math.max(0.5 + height * 0.42, 0), 1))
      .multiplyScalar(shade);

    const ridge =
      1 - Math.abs(fbm3(dir.x * 4.3, dir.y * 4.3, dir.z * 4.3, noiseSeed + 53, 3));
    const veinMask = smoothstep(0.86, 0.965, ridge);
    color.lerp(vein, veinMask * 0.9);

    // Micro lights: rare emissive-bright speckles ("small energy traces").
    if (sparkleRandom() > 0.988) {
      color.copy(spark);
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface AsteroidMaterialOptions {
  tone?: AsteroidTone;
  /** Initial fresnel edge-glow strength; animate via userData.rimStrength. */
  rim?: number;
  /** Locked/dormant rocks desaturate toward a soft silver tone. */
  dormant?: boolean;
}

export interface AsteroidMaterial extends THREE.MeshStandardMaterial {
  userData: {
    rimStrength: { value: number };
    rimColor: { value: THREE.Color };
  };
}

/**
 * Standard PBR rock material with an injected fresnel rim so edges catch
 * star/galaxy light. `material.userData.rimStrength.value` is a live shader
 * uniform — damp it for hover/selected states.
 */
export function createAsteroidMaterial(
  options: AsteroidMaterialOptions = {},
): AsteroidMaterial {
  const { tone = "silver", rim = 0.22, dormant = false } = options;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: dormant ? 0.28 : 0.45,
    roughness: dormant ? 0.72 : 0.55,
    emissive: new THREE.Color(tone === "ember" ? "#221408" : "#0d1116"),
    emissiveIntensity: dormant ? 0.3 : 0.55,
  }) as AsteroidMaterial;

  if (dormant) {
    // Visible but desaturated with a soft silver tone — sleeping, not black.
    material.color = new THREE.Color("#9aa3ab");
  }

  const rimStrength = { value: rim };
  const rimColor = {
    value: new THREE.Color(tone === "ember" ? "#c07a40" : "#aeb6bc"),
  };
  material.userData.rimStrength = rimStrength;
  material.userData.rimColor = rimColor;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimStrength = rimStrength;
    shader.uniforms.uRimColor = rimColor;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uRimStrength;
        uniform vec3 uRimColor;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float vxFresnel = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += uRimColor * vxFresnel * uRimStrength;`,
      );
  };
  material.customProgramCacheKey = () => `vx-asteroid-${tone}-${dormant}`;

  return material;
}

/* ------------------------------------------------------------------ */
/* Seeded asteroid looks: endless exterior variety                     */
/* ------------------------------------------------------------------ */

export type AsteroidArchetype =
  | "rocky"
  | "metallic"
  | "glossy"
  | "glass"
  | "icy"
  | "obsidian"
  | "copper"
  | "gold"
  | "emerald"
  | "lava";

const ARCHETYPES: AsteroidArchetype[] = [
  "rocky",
  "rocky", // rocky stays the most common — space is mostly stone
  "metallic",
  "glossy",
  "glass",
  "icy",
  "obsidian",
  "copper",
  "gold",
  "emerald",
  "lava",
];

export interface AsteroidLook {
  archetype: AsteroidArchetype;
  palette: AsteroidPalette;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  iridescence: number;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
  /** Geometry noise amplitude for this rock family. */
  amp: number;
  craters: number;
}

function hsl(h: number, s: number, l: number): string {
  return `#${new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l).getHexString()}`;
}

/**
 * Rolls a fully-seeded exterior look — archetype (rocky, glossy, glass,
 * metallic, …), a jittered color palette, PBR params, and geometry noise.
 * Every seed is a different rock family; nothing is hand-picked.
 */
export function rollAsteroidLook(seed: number): AsteroidLook {
  const random = mulberry32(seed ^ 0x100c5);
  const archetype = ARCHETYPES[Math.floor(random() * ARCHETYPES.length)]!;
  const hue = random();
  const jitter = () => (random() - 0.5) * 0.08;

  const base: Omit<AsteroidLook, "amp" | "craters"> = (() => {
    switch (archetype) {
      case "metallic":
        return {
          archetype,
          palette: {
            rock: hsl(hue, 0.06 + jitter(), 0.32),
            deep: hsl(hue, 0.08, 0.08),
            vein: hsl(hue + 0.04, 0.12, 0.78),
            spark: "#ffffff",
          },
          metalness: 0.92,
          roughness: 0.28 + random() * 0.2,
          clearcoat: 0.25,
          clearcoatRoughness: 0.3,
          iridescence: 0,
          opacity: 1,
          emissive: "#0d1116",
          emissiveIntensity: 0.4,
        };
      case "glossy":
        return {
          archetype,
          palette: {
            rock: hsl(hue, 0.28 + jitter(), 0.24),
            deep: hsl(hue, 0.32, 0.06),
            vein: hsl(hue + 0.5, 0.3, 0.72),
            spark: "#ffffff",
          },
          metalness: 0.25,
          roughness: 0.06 + random() * 0.1,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          iridescence: 0.25,
          opacity: 1,
          emissive: hsl(hue, 0.4, 0.05),
          emissiveIntensity: 0.5,
        };
      case "glass":
        return {
          archetype,
          palette: {
            rock: hsl(hue, 0.22, 0.5),
            deep: hsl(hue, 0.3, 0.2),
            vein: "#ffffff",
            spark: "#ffffff",
          },
          metalness: 0.05,
          roughness: 0.03 + random() * 0.06,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          iridescence: 0.6,
          opacity: 0.62,
          emissive: hsl(hue, 0.3, 0.12),
          emissiveIntensity: 0.5,
        };
      case "icy":
        return {
          archetype,
          palette: {
            rock: hsl(0.55 + jitter(), 0.22, 0.6),
            deep: hsl(0.58, 0.3, 0.22),
            vein: "#eaf6ff",
            spark: "#ffffff",
          },
          metalness: 0.08,
          roughness: 0.12 + random() * 0.12,
          clearcoat: 0.9,
          clearcoatRoughness: 0.14,
          iridescence: 0.35,
          opacity: 0.9,
          emissive: "#0c1c26",
          emissiveIntensity: 0.55,
        };
      case "obsidian":
        return {
          archetype,
          palette: {
            rock: hsl(hue, 0.08, 0.1),
            deep: "#020304",
            vein: hsl(hue + 0.02, 0.18, 0.62),
            spark: "#ffffff",
          },
          metalness: 0.5,
          roughness: 0.14 + random() * 0.12,
          clearcoat: 0.8,
          clearcoatRoughness: 0.12,
          iridescence: 0.15,
          opacity: 1,
          emissive: "#05070a",
          emissiveIntensity: 0.5,
        };
      case "copper":
        return {
          archetype,
          palette: {
            rock: hsl(0.06 + jitter(), 0.5, 0.3),
            deep: hsl(0.05, 0.55, 0.08),
            vein: hsl(0.45, 0.45, 0.5), // patina streaks
            spark: "#ffe2c4",
          },
          metalness: 0.85,
          roughness: 0.34 + random() * 0.2,
          clearcoat: 0.2,
          clearcoatRoughness: 0.35,
          iridescence: 0.1,
          opacity: 1,
          emissive: "#1a0d05",
          emissiveIntensity: 0.45,
        };
      case "gold":
        return {
          archetype,
          palette: {
            rock: hsl(0.115 + jitter() * 0.4, 0.62, 0.4),
            deep: hsl(0.1, 0.6, 0.12),
            vein: "#fff3d0",
            spark: "#ffffff",
          },
          metalness: 0.95,
          roughness: 0.22 + random() * 0.16,
          clearcoat: 0.3,
          clearcoatRoughness: 0.25,
          iridescence: 0,
          opacity: 1,
          emissive: "#201304",
          emissiveIntensity: 0.5,
        };
      case "emerald":
        return {
          archetype,
          palette: {
            rock: hsl(0.38 + jitter(), 0.5, 0.26),
            deep: hsl(0.4, 0.55, 0.07),
            vein: hsl(0.36, 0.4, 0.7),
            spark: "#eafff2",
          },
          metalness: 0.2,
          roughness: 0.08 + random() * 0.1,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          iridescence: 0.3,
          opacity: 0.85,
          emissive: hsl(0.38, 0.5, 0.06),
          emissiveIntensity: 0.6,
        };
      case "lava":
        return {
          archetype,
          palette: {
            rock: hsl(0.02 + jitter() * 0.3, 0.25, 0.12),
            deep: "#050302",
            vein: hsl(0.05, 0.95, 0.55), // molten cracks
            spark: "#ffd9a0",
          },
          metalness: 0.3,
          roughness: 0.6 + random() * 0.2,
          clearcoat: 0,
          clearcoatRoughness: 0.5,
          iridescence: 0,
          opacity: 1,
          emissive: hsl(0.04, 0.9, 0.2),
          emissiveIntensity: 1.1,
        };
      default: // rocky
        return {
          archetype: "rocky" as const,
          palette: {
            rock: hsl(hue, 0.05 + random() * 0.14, 0.16 + random() * 0.14),
            deep: hsl(hue, 0.1, 0.04),
            vein: hsl(hue + random() * 0.4, 0.15 + random() * 0.2, 0.6 + random() * 0.2),
            spark: "#ffffff",
          },
          metalness: 0.3 + random() * 0.25,
          roughness: 0.5 + random() * 0.3,
          clearcoat: random() * 0.15,
          clearcoatRoughness: 0.4,
          iridescence: 0,
          opacity: 1,
          emissive: "#0d1116",
          emissiveIntensity: 0.45,
        };
    }
  })();

  return {
    ...base,
    // Heavy per-family noise variance: smooth pebbles to torn shards.
    amp: 0.16 + random() * 0.3,
    craters: 2 + Math.floor(random() * 6),
  };
}

/**
 * Physical material for a rolled look — clearcoat/iridescence for the
 * glossy families, with the same live fresnel rim as the classic rock.
 */
export function createAsteroidLookMaterial(
  look: AsteroidLook,
  rim = 0.14,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    metalness: look.metalness,
    roughness: look.roughness,
    clearcoat: look.clearcoat,
    clearcoatRoughness: look.clearcoatRoughness,
    iridescence: look.iridescence,
    transparent: look.opacity < 1,
    opacity: look.opacity,
    emissive: new THREE.Color(look.emissive),
    emissiveIntensity: look.emissiveIntensity,
  });

  const rimStrength = { value: rim };
  const rimColor = { value: new THREE.Color(look.palette.vein) };
  material.userData.rimStrength = rimStrength;
  material.userData.rimColor = rimColor;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimStrength = rimStrength;
    shader.uniforms.uRimColor = rimColor;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uRimStrength;
        uniform vec3 uRimColor;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float vxFresnel = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.6);
        totalEmissiveRadiance += uRimColor * vxFresnel * uRimStrength;`,
      );
  };
  material.customProgramCacheKey = () =>
    `vx-asteroid-look-${look.opacity < 1 ? "t" : "o"}`;

  return material;
}
