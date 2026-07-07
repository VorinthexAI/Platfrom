"use client";

import { CAVE_CONFIGS, ROCK_THEMES } from "@/lib/cave-config";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { hashString } from "@/lib/three/procedural";
import { BiomeChamber } from "./BiomeChamber";
import { BiomeLootField, CenterCrystal } from "./BiomeLoot";

/**
 * The asteroid caves: each auth flow opens the seeded interior of a belt
 * asteroid — and every ORDINARY belt rock is enterable too. Every biome
 * scatters 10–25 small fragments across its floor, and 3-in-5 asteroid
 * biomes grow a rare center crystal worth 100–10,000 fragments. Loot is
 * keyed to the asteroid's stable identity, so collected pieces never
 * respawn — while the cavern itself still re-rolls its look per entry.
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
  const lootSeed = isRock
    ? (rockBiomeSeed ?? visitSeed)
    : hashString(`cave-${caveKind}`);
  const biomeKey = isRock ? `rock-${(lootSeed >>> 0).toString(36)}` : caveKind;
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
      <BiomeLootField biomeKey={biomeKey} lootSeed={lootSeed} />
      {isRock ? (
        <CenterCrystal biomeKey={biomeKey} lootSeed={lootSeed} />
      ) : null}
    </BiomeChamber>
  );
}
