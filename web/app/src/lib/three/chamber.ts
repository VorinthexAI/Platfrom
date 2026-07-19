import * as THREE from "three";
import type { PlanetBiome } from "./planet";
import { fbm3, mulberry32 } from "./procedural";

/**
 * Interior chamber system — the hollowed hearts of asteroids, planets,
 * and moons. Every chamber is generated from a SEED (a new one on every
 * visit, Minecraft-style) and dressed by a STYLE: rock palette, crystal
 * light, and a living ecosystem. Walls carry real painted rock textures
 * with bump relief so an interior never reads as open space.
 */

export type ChamberStyleKey =
  | "gem" // silver diamond vault
  | "ember" // magma vault
  | "lush" // bioluminescent grove
  | "violet" // spore cipher chamber
  | "ice" // frozen hollow
  | "ocean"; // drowned grotto

export interface ChamberStyle {
  crystal: string;
  emissive: string;
  glow: string;
  wallTint: string;
  /** Rock texture painting colors. */
  rockBase: string;
  rockHigh: string;
  rockCrack: string;
  /** Ecosystem: free-floating organisms. */
  swarmCount: number;
  swarmColor: string;
  swarmSize: number;
  swarmSpeed: number;
  swarmLift: number;
  /** Ecosystem: floor growth colony. */
  growthKind: "mushroom" | "coral" | "vent" | "pod";
  growthCount: number;
  growthColor: string;
  growthEmissive: string;
  /** Ecosystem: pulsing wall colonies. */
  colonyCount: number;
  colonyColor: string;
  /** Hanging glow-berry vines (the grove's signature). */
  vines: boolean;
  /** Signature particle feature: embers rise, snow falls, spores orbit. */
  feature: "rise" | "fall" | "orbit";
  featureColor: string;
  /** The molten color that erupts from the floor on every entry. */
  lava: string;
}

export const CHAMBER_STYLES: Record<ChamberStyleKey, ChamberStyle> = {
  gem: {
    crystal: "#39424d", emissive: "#dde2e5", glow: "#f5f7f8",
    wallTint: "#3a4149", rockBase: "#23282f", rockHigh: "#59616b",
    rockCrack: "#0b0e12",
    swarmCount: 60, swarmColor: "#f5f7f8", swarmSize: 0.045, swarmSpeed: 0.5,
    swarmLift: -0.05,
    growthKind: "coral", growthCount: 26, growthColor: "#39424d",
    growthEmissive: "#dde2e5",
    colonyCount: 7, colonyColor: "#c2ccd3", vines: false, feature: "fall", featureColor: "#f5f7f8",
    lava: "#eef2f5",
  },
  ember: {
    crystal: "#4a3a2a", emissive: "#e8842e", glow: "#ffb25c",
    wallTint: "#4a3627", rockBase: "#2a1d12", rockHigh: "#6b4a2e",
    rockCrack: "#120b06",
    swarmCount: 80, swarmColor: "#ffb25c", swarmSize: 0.05, swarmSpeed: 0.9,
    swarmLift: 0.35,
    growthKind: "vent", growthCount: 14, growthColor: "#1a130c",
    growthEmissive: "#e8842e",
    colonyCount: 6, colonyColor: "#c26a2c", vines: false, feature: "rise", featureColor: "#ffb25c",
    lava: "#ff9636",
  },
  lush: {
    crystal: "#28382f", emissive: "#7fae8a", glow: "#a8d8b4",
    wallTint: "#33413a", rockBase: "#1c2620", rockHigh: "#4e6455",
    rockCrack: "#0a100c",
    swarmCount: 90, swarmColor: "#a8d8b4", swarmSize: 0.05, swarmSpeed: 0.7,
    swarmLift: 0.06,
    growthKind: "mushroom", growthCount: 34, growthColor: "#28382f",
    growthEmissive: "#7fae8a",
    colonyCount: 9, colonyColor: "#9fc7a8", vines: true, feature: "orbit", featureColor: "#a8d8b4",
    lava: "#9fe0ac",
  },
  violet: {
    crystal: "#3a3352", emissive: "#8f7bd8", glow: "#b3a3f0",
    wallTint: "#3b3550", rockBase: "#221d33", rockHigh: "#544a75",
    rockCrack: "#0e0b18",
    swarmCount: 70, swarmColor: "#b3a3f0", swarmSize: 0.055, swarmSpeed: 0.4,
    swarmLift: 0.02,
    growthKind: "pod", growthCount: 22, growthColor: "#2a2440",
    growthEmissive: "#8f7bd8",
    colonyCount: 8, colonyColor: "#a495e8", vines: false, feature: "orbit", featureColor: "#b3a3f0",
    lava: "#b79bff",
  },
  ice: {
    crystal: "#5a7183", emissive: "#c2d5e4", glow: "#e2eef7",
    wallTint: "#4b5a66",
    rockBase: "#2c3a46", rockHigh: "#7d95a8", rockCrack: "#101820",
    swarmCount: 55, swarmColor: "#e2eef7", swarmSize: 0.045, swarmSpeed: 0.35,
    swarmLift: -0.08,
    growthKind: "coral", growthCount: 20, growthColor: "#3a4c5b",
    growthEmissive: "#c2d5e4",
    colonyCount: 6, colonyColor: "#b8cddd", vines: false, feature: "fall", featureColor: "#e2eef7",
    lava: "#cfe6f5",
  },
  ocean: {
    crystal: "#1d3040", emissive: "#6f98af", glow: "#9fc4d8",
    wallTint: "#31424f", rockBase: "#15222c", rockHigh: "#436073",
    rockCrack: "#080f15",
    swarmCount: 85, swarmColor: "#9fc4d8", swarmSize: 0.05, swarmSpeed: 0.55,
    swarmLift: 0.12,
    growthKind: "coral", growthCount: 30, growthColor: "#20404c",
    growthEmissive: "#6f98af",
    colonyCount: 8, colonyColor: "#8fb8cc", vines: false, feature: "rise", featureColor: "#9fc4d8",
    lava: "#7fd4ef",
  },
};

/** Which chamber a world's interior opens into, by its surface biome. */
export function chamberStyleForBiome(biome: PlanetBiome): ChamberStyleKey {
  switch (biome) {
    case "lava":
      return "ember";
    case "lush":
      return "lush";
    case "ice":
      return "ice";
    case "ocean":
      return "ocean";
    case "gas":
      return "violet";
    default:
      return "gem";
  }
}

/* ------------------------------------------------------------------ */
/* Painted rock textures                                               */
/* ------------------------------------------------------------------ */

const textureCache = new Map<
  ChamberStyleKey,
  {
    map: THREE.CanvasTexture;
    bumpMap: THREE.CanvasTexture;
    emissiveMap: THREE.CanvasTexture;
  }
>();

/**
 * A painted rock surface: layered mineral blotches, dark fracture lines,
 * and fine speckle — plus a grayscale bump twin for real light response.
 */
export function getRockTextures(styleKey: ChamberStyleKey): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
} {
  const cached = textureCache.get(styleKey);
  if (cached) return cached;
  const style = CHAMBER_STYLES[styleKey];
  // 768px preserves the rock detail at chamber scale without retaining
  // three 1024px source canvases and GPU textures for each visited biome.
  const size = 768;
  const random = mulberry32(0x70c4 ^ styleKey.length * 7919);

  const paint = (grayscale: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = grayscale ? "#808080" : style.rockBase;
    ctx.fillRect(0, 0, size, size);

    // Sediment strata: wide faint bands so the rock reads as bedded stone.
    for (let i = 0; i < 16; i++) {
      const y = random() * size;
      const height = 20 + random() * 90;
      ctx.fillStyle = grayscale
        ? `rgba(${Math.round(100 + random() * 80)},${Math.round(100 + random() * 80)},${Math.round(100 + random() * 80)},0.06)`
        : random() > 0.5
          ? `${style.rockHigh}12`
          : `${style.rockCrack}15`;
      ctx.fillRect(0, y, size, height);
    }

    // Mineral blotches — big soft masses first, small sharp ones on top.
    for (let i = 0; i < 900; i++) {
      const x = random() * size;
      const y = random() * size;
      const radius = 4 + random() * (i < 260 ? 88 : 26);
      const light = random();
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const color = grayscale
        ? `rgba(${Math.round(90 + light * 110)}, ${Math.round(90 + light * 110)}, ${Math.round(90 + light * 110)}, 0.16)`
        : light > 0.55
          ? `${style.rockHigh}29`
          : `${style.rockCrack}33`;
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    // Fracture lines: a dense primary network plus hairline branches.
    for (let i = 0; i < 120; i++) {
      ctx.lineWidth = i < 70 ? 2.4 : 1.1;
      ctx.strokeStyle = grayscale
        ? "rgba(20,20,20,0.4)"
        : `${style.rockCrack}66`;
      ctx.beginPath();
      let x = random() * size;
      let y = random() * size;
      ctx.moveTo(x, y);
      const segments = 2 + Math.floor(random() * 5);
      for (let s = 0; s < segments; s++) {
        x += (random() - 0.5) * 170;
        y += (random() - 0.5) * 170;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Fine speckle.
    for (let i = 0; i < 5000; i++) {
      const light = random();
      ctx.fillStyle = grayscale
        ? `rgba(${Math.round(light * 255)},${Math.round(light * 255)},${Math.round(light * 255)},0.1)`
        : light > 0.5
          ? `${style.rockHigh}1f`
          : `${style.rockCrack}1f`;
      ctx.fillRect(random() * size, random() * size, 1.8, 1.8);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 3);
    texture.anisotropy = 2;
    return texture;
  };

  // Glowing mineral veins: bioluminescent networks threading the whole
  // chamber shell in every direction — this is what makes the rock alive.
  const paintVeins = () => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);
    const veinRandom = mulberry32(0x0e1a ^ styleKey.length * 104729);
    ctx.strokeStyle = style.emissive;
    ctx.shadowColor = style.emissive;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Primary veins: smooth glowing rivers drawn with curves, sharp core.
    for (let i = 0; i < 52; i++) {
      ctx.lineWidth = 1.4 + veinRandom() * 2.6;
      ctx.shadowBlur = 7 + veinRandom() * 11;
      ctx.globalAlpha = 0.4 + veinRandom() * 0.5;
      ctx.beginPath();
      let x = veinRandom() * size;
      let y = veinRandom() * size;
      ctx.moveTo(x, y);
      const segments = 4 + Math.floor(veinRandom() * 7);
      for (let seg = 0; seg < segments; seg++) {
        const cx = x + (veinRandom() - 0.5) * 220;
        const cy = y + (veinRandom() - 0.5) * 220;
        x = cx + (veinRandom() - 0.5) * 160;
        y = cy + (veinRandom() - 0.5) * 160;
        ctx.quadraticCurveTo(cx, cy, x, y);
      }
      ctx.stroke();
    }
    // Hairline branches: crisp capillaries with no blur at all.
    ctx.shadowBlur = 0;
    for (let i = 0; i < 110; i++) {
      ctx.lineWidth = 0.6 + veinRandom() * 0.8;
      ctx.globalAlpha = 0.2 + veinRandom() * 0.3;
      ctx.beginPath();
      let x = veinRandom() * size;
      let y = veinRandom() * size;
      ctx.moveTo(x, y);
      const segments = 2 + Math.floor(veinRandom() * 4);
      for (let seg = 0; seg < segments; seg++) {
        x += (veinRandom() - 0.5) * 90;
        y += (veinRandom() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Glow pools where veins meet.
    for (let i = 0; i < 72; i++) {
      const x = veinRandom() * size;
      const y = veinRandom() * size;
      const radius = 4 + veinRandom() * 18;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, style.emissive);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.3 + veinRandom() * 0.35;
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 3);
    texture.anisotropy = 2;
    return texture;
  };

  const result = {
    map: paint(false),
    bumpMap: paint(true),
    emissiveMap: paintVeins(),
  };
  textureCache.set(styleKey, result);
  return result;
}

/**
 * Radial eruption cracks: jagged glowing fissures bursting outward from
 * the center, laid over the floor while the chamber erupts on entry.
 */
let crackTexture: THREE.CanvasTexture | null = null;
export function getCrackTexture(): THREE.CanvasTexture {
  if (crackTexture) return crackTexture;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);
  const random = mulberry32(0xc4ac);
  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.lineCap = "round";
  for (let i = 0; i < 14; i++) {
    const baseAngle = (i / 14) * Math.PI * 2 + (random() - 0.5) * 0.5;
    let x = cx;
    let y = cy;
    let angle = baseAngle;
    ctx.lineWidth = 3.4 + random() * 2.4;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.75 + random() * 0.25;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 5 + Math.floor(random() * 4);
    for (let seg = 0; seg < segments; seg++) {
      angle += (random() - 0.5) * 0.8;
      const step = 22 + random() * 34;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      ctx.lineTo(x, y);
      // Cracks thin as they run outward.
      ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.82);
    }
    ctx.stroke();
  }
  // Molten heart.
  const heart = ctx.createRadialGradient(cx, cy, 0, cx, cy, 74);
  heart.addColorStop(0, "rgba(255,255,255,0.95)");
  heart.addColorStop(1, "rgba(0,0,0,0)");
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = heart;
  ctx.fillRect(cx - 74, cy - 74, 148, 148);
  crackTexture = new THREE.CanvasTexture(canvas);
  return crackTexture;
}

/**
 * Paint every style's rock textures during idle time so the first visit
 * to each biome doesn't hitch on canvas work mid-flight.
 */
export function prewarmChamberTextures() {
  if (typeof window === "undefined") return;
  const styles = Object.keys(CHAMBER_STYLES) as ChamberStyleKey[];
  let index = 0;
  const step = () => {
    if (index >= styles.length) {
      getCrackTexture();
      return;
    }
    getRockTextures(styles[index]);
    index += 1;
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(step, { timeout: 800 });
    } else {
      setTimeout(step, 120);
    }
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(step, { timeout: 1500 });
  } else {
    setTimeout(step, 400);
  }
}

/* ------------------------------------------------------------------ */
/* Seeded chamber geometry                                             */
/* ------------------------------------------------------------------ */

/**
 * The cavern wall: a displaced sphere (UVs intact for the rock texture)
 * viewed from inside. Every seed rolls different bulges and alcoves.
 * `distortion` (default 1) scales the noise amplitudes — asteroid caves
 * roll far wilder interiors than the curated planet biomes.
 */
export function createChamberWallGeometry(
  seed: number,
  distortion = 1,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 64, 48);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const dir = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    dir.fromBufferAttribute(position, i).normalize();
    const lumps = fbm3(dir.x * 1.9, dir.y * 1.9, dir.z * 1.9, seed);
    const detail = fbm3(dir.x * 5.2, dir.y * 5.2, dir.z * 5.2, seed + 7, 3);
    const jag = distortion > 1
      ? fbm3(dir.x * 9.1, dir.y * 9.1, dir.z * 9.1, seed + 19, 2) * 0.05 * (distortion - 1)
      : 0;
    const r = 1 + (lumps * 0.2 + detail * 0.07) * distortion + jag;
    position.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The cavern floor: a displaced disc laid across the chamber's lower
 * bowl, so there is unambiguous rocky ground beneath your feet.
 */
export function createChamberFloorGeometry(
  seed: number,
  radius: number,
): THREE.BufferGeometry {
  const geometry = new THREE.CircleGeometry(radius, 48, 0, Math.PI * 2);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const edge = Math.min(Math.hypot(x, y) / radius, 1);
    const relief = fbm3(x * 0.9, y * 0.9, seed * 0.001, seed + 31) * 0.35;
    // The rim rises to meet the walls.
    position.setZ(i, relief + edge * edge * 1.1);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Deterministic interior parking spot for a world's chamber. */
export function visitInteriorPosition(
  entityHash: number,
): [number, number, number] {
  const column = entityHash % 9;
  const row = Math.floor(entityHash / 9) % 7;
  return [column * 90 - 360, -340, row * 90 - 270];
}
