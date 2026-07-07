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
  const vein = tone === "ember" ? VEIN_EMBER : VEIN_SILVER;
  const spark = tone === "ember" ? SPARK_EMBER : SPARK_SILVER;

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
      .copy(DEEP)
      .lerp(ROCK, Math.min(Math.max(0.5 + height * 0.42, 0), 1))
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
