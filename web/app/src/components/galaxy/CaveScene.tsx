"use client";

import { CAVE_CONFIGS, ROCK_THEMES } from "@/lib/cave-config";
import { caveLootIdentity, useGalaxyStore } from "@/lib/galaxy-store";
import { BiomeChamber } from "./BiomeChamber";
import { BiomeLootField, CenterCrystal } from "./BiomeLoot";
import { CrystalCave } from "./CrystalCave";

/**
 * The asteroid caves: each auth flow opens the seeded interior of a belt
 * asteroid — and every ORDINARY belt rock is enterable too. Every biome
 * scatters 10–25 small fragments across its floor, and EVERY asteroid
 * biome grows a center crystal worth 10 up to 1,000,000 fragments. Loot
 * is keyed to the asteroid's stable identity, so collected pieces never
 * respawn — while the cavern itself still re-rolls its look per entry.
 * The leaderboard asteroid is the exception: no loot of its own — its
 * walls carry every piece the whole galaxy has claimed, live.
 */

export function CaveScene() {
  const mode = useGalaxyStore((s) => s.mode);
  const caveKind = useGalaxyStore((s) => s.caveKind);
  const cavePhase = useGalaxyStore((s) => s.cavePhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);
  const rockBiomeSeed = useGalaxyStore((s) => s.rockBiomeSeed);
  if (mode !== "cave" || !caveKind) return null;
  // Mount during the veil ("enter") so the world is ready on arrival.
  if (cavePhase === "fly") return null;
  const config = CAVE_CONFIGS[caveKind];
  // The biome's stable identity: quantized asteroid bearing for rocks,
  // the story kind for vault caves. Loot keys off it, so nothing
  // collected here ever respawns on re-entry.
  const isRock = caveKind === "rock";
  const isLeaderboard = caveKind === "leaderboard";
  const { biomeKey, lootSeed } = caveLootIdentity(caveKind, rockBiomeSeed, visitSeed);
  // Uncharted rocks roll their chamber theme from their identity and get
  // far noisier cavern walls than the curated planet biomes.
  const theme = isRock
    ? ROCK_THEMES[(lootSeed >>> 0) % ROCK_THEMES.length]
    : config.theme;
  const distortion = isRock
    ? 1.6 + ((lootSeed >>> 4) % 100) / 100
    : 1;
  return (
    <BiomeChamber
      styleKey={theme}
      seed={visitSeed}
      position={config.interior}
      distortion={distortion}
    >
      {isLeaderboard ? (
        <CrystalCave />
      ) : (
        <BiomeLootField biomeKey={biomeKey} lootSeed={lootSeed} />
      )}
      {isRock ? (
        <CenterCrystal biomeKey={biomeKey} lootSeed={lootSeed} />
      ) : null}
    </BiomeChamber>
  );
}
