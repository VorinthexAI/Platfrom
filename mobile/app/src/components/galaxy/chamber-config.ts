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
  crystal: string;
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

export const CHAMBER_STYLES: Record<ChamberStyleKey, ChamberStyle> = {
  gem: {
    crystal: "#39424d", emissive: "#dde2e5", glow: "#f5f7f8",
    rockBase: "#23282f", rockHigh: "#59616b", rockCrack: "#0b0e12",
    moteColor: "#f5f7f8", moteCount: 60, feature: "fall",
  },
  ember: {
    crystal: "#4a3a2a", emissive: "#e8842e", glow: "#ffb25c",
    rockBase: "#2a1d12", rockHigh: "#6b4a2e", rockCrack: "#120b06",
    moteColor: "#ffb25c", moteCount: 80, feature: "rise",
  },
  lush: {
    crystal: "#28382f", emissive: "#7fae8a", glow: "#a8d8b4",
    rockBase: "#1c2620", rockHigh: "#4e6455", rockCrack: "#0a100c",
    moteColor: "#a8d8b4", moteCount: 90, feature: "orbit",
  },
  violet: {
    crystal: "#3a3352", emissive: "#8f7bd8", glow: "#b3a3f0",
    rockBase: "#221d33", rockHigh: "#544a75", rockCrack: "#0e0b18",
    moteColor: "#b3a3f0", moteCount: 70, feature: "orbit",
  },
  ice: {
    crystal: "#5a7183", emissive: "#c2d5e4", glow: "#e2eef7",
    rockBase: "#2c3a46", rockHigh: "#7d95a8", rockCrack: "#101820",
    moteColor: "#e2eef7", moteCount: 55, feature: "fall",
  },
  ocean: {
    crystal: "#1d3040", emissive: "#6f98af", glow: "#9fc4d8",
    rockBase: "#15222c", rockHigh: "#436073", rockCrack: "#080f15",
    moteColor: "#9fc4d8", moteCount: 85, feature: "rise",
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

/**
 * Per-capability interior overrides where the live site's hashed biome
 * differs from the mobile planet's surface biome — Archive opens into the
 * violet cipher chamber on vorinthex.com, so it does here too.
 */
const CHAMBER_STYLE_OVERRIDES: Partial<Record<CapabilitySlug, ChamberStyleKey>> = {
  archive: "violet",
};

export function chamberStyleForSlug(slug: CapabilitySlug): ChamberStyleKey {
  return (
    CHAMBER_STYLE_OVERRIDES[slug] ??
    chamberStyleForBiome(orbitForSlug(slug).biome)
  );
}

/** Far below the galaxy — beyond the fog so neither scene sees the other. */
export const CHAMBER_POSITION = new THREE.Vector3(0, -120, 0);
