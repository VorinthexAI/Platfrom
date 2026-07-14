import * as THREE from "three";

import { orbitForSlug } from "@/components/galaxy/galaxy-config";
import type { CapabilitySlug } from "@/data/registry";
import type { PlanetBiome } from "@/lib/three/planet";

/**
 * Interior chamber styling, ported from the web chamber.ts CHAMBER_STYLES
 * palettes (trimmed to what the mobile chamber renders: rock, crystals,
 * glow, motes). The painted canvas rock textures of the web version are
 * replaced by a fully procedural rock shader — no DOM canvas on native.
 */
export type ChamberStyleKey =
  | "gem"
  | "ember"
  | "lush"
  | "violet"
  | "ice"
  | "ocean";

export type ChamberStyle = {
  emissive: string;
  glow: string;
  rockBase: string;
  rockHigh: string;
  rockCrack: string;
  moteColor: string;
  moteCount: number;
  /** Signature particle feature: embers rise, snow falls, spores orbit. */
  feature: "rise" | "fall" | "orbit";
};

/**
 * Strictly MONOCHROME — the brand is silver; no biome gets an accent hue.
 * Interiors keep their identity through tone (bright/deep), particle
 * density, and motion (rise/fall/orbit) instead of color.
 */
export const CHAMBER_STYLES: Record<ChamberStyleKey, ChamberStyle> = {
  gem: {
    emissive: "#dde2e5", glow: "#f5f7f8",
    rockBase: "#23282f", rockHigh: "#59616b", rockCrack: "#0b0e12",
    moteColor: "#f5f7f8", moteCount: 60, feature: "fall",
  },
  ember: {
    emissive: "#c9ced2", glow: "#e8ebee",
    rockBase: "#1e2126", rockHigh: "#4c525a", rockCrack: "#080a0d",
    moteColor: "#e8ebee", moteCount: 85, feature: "rise",
  },
  lush: {
    emissive: "#d4d9dd", glow: "#eef1f3",
    rockBase: "#22262b", rockHigh: "#555d65", rockCrack: "#0a0c0f",
    moteColor: "#eef1f3", moteCount: 90, feature: "orbit",
  },
  violet: {
    emissive: "#d0d5da", glow: "#eaedf0",
    rockBase: "#20242a", rockHigh: "#515962", rockCrack: "#090b0e",
    moteColor: "#eaedf0", moteCount: 70, feature: "orbit",
  },
  ice: {
    emissive: "#e4e8eb", glow: "#f7f9fa",
    rockBase: "#2a2f35", rockHigh: "#6b747d", rockCrack: "#0e1114",
    moteColor: "#f7f9fa", moteCount: 55, feature: "fall",
  },
  ocean: {
    emissive: "#c5cbd0", glow: "#e5e9ec",
    rockBase: "#1a1e23", rockHigh: "#454d55", rockCrack: "#070a0c",
    moteColor: "#e5e9ec", moteCount: 85, feature: "rise",
  },
};

/** Which chamber a world's interior opens into, by its surface biome (web parity). */
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

export function chamberStyleForSlug(slug: CapabilitySlug): ChamberStyleKey {
  return chamberStyleForBiome(orbitForSlug(slug).biome);
}

/** Far below the galaxy — beyond the fog so neither scene sees the other. */
export const CHAMBER_POSITION = new THREE.Vector3(0, -120, 0);
