"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { trackLandingEvent } from "@/lib/analytics";
import {
  useFragmentsStore,
  type BiomeLootInput,
} from "@/lib/fragments/fragments-store";
import { useGalaxyStore } from "@/lib/galaxy-store";
import {
  createCrystalGeometry,
  createEdgyCrystalPieces,
  crystalTintForValue,
  crystalTintForRarity,
  CRYSTAL_VARIANTS,
  EDGY_CRYSTAL_GENERATOR,
} from "@/lib/three/crystal";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";
import { CHAMBER_RADIUS } from "./BiomeChamber";

/**
 * Procedural loot inside every biome:
 *
 * - BiomeLootField: 10–25 small fragments (worth 1–3 each) scattered on
 *   the floor. Ids are stable per biome, so collected pieces never
 *   respawn on re-entry, and every collect persists its exact mesh recipe.
 * - CenterCrystal: 3-in-5 asteroid biomes grow a rare crystal in the
 *   middle — worth 100 up to 10,000 fragments, sized with its value (the
 *   largest fill the whole chamber). It assembles from shards erupting
 *   out of the floor, then rotates on a full-3D loop until claimed.
 *
 * Collection uses pointer-DOWN on an always-full-size invisible hit
 * sphere: taps register the instant a finger lands, even while the
 * crystal is still growing in or the camera sways.
 */

const FLOOR_Y = -CHAMBER_RADIUS * 0.52;

function rarityForValue(value: number): string {
  if (value >= 5000) return "founder";
  if (value >= 1000) return "rare";
  if (value >= 300) return "uncommon";
  return "common";
}

/* ------------------------------------------------------------------ */
/* Small floor fragments                                                */
/* ------------------------------------------------------------------ */

function FloorFragment({
  position,
  variant,
  entryDelay,
  onCollect,
}: {
  position: [number, number, number];
  variant: number;
  entryDelay: number;
  onCollect: () => void;
}) {
  const visualRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);
  const [taken, setTaken] = useState(false);
  const [gone, setGone] = useState(false);
  const [hovered, setHovered] = useState(false);
  const tint = crystalTintForRarity("common");

  const geometry = useMemo(
    () => createCrystalGeometry(variant % CRYSTAL_VARIANTS),
    [variant],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    const visual = visualRef.current;
    if (!visual) return;
    timeRef.current += delta;
    const target = taken || timeRef.current < entryDelay ? 0.001 : 1;
    const scale = THREE.MathUtils.lerp(visual.scale.x, target, delta * 4);
    visual.scale.setScalar(scale);
    if (taken && scale < 0.01) setGone(true);
  });

  if (gone) return null;

  const handleCollect = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (taken) return;
    setTaken(true);
    document.body.style.cursor = "auto";
    onCollect();
  };

  return (
    <group position={position}>
      {/* visual grows in; the hit sphere below is full-size from frame 1 */}
      <group ref={visualRef} scale={0.001}>
        <mesh geometry={geometry} scale={0.3}>
          <meshStandardMaterial
            color={tint.color}
            metalness={0.25}
            roughness={0.15}
            emissive={tint.emissive}
            emissiveIntensity={hovered ? 1.5 : 0.9}
            transparent
            opacity={0.96}
          />
        </mesh>
        <sprite scale={[1.1, 1.1, 1]}>
          <spriteMaterial
            map={getDotTexture()}
            color={tint.glow}
            transparent
            opacity={hovered ? 0.42 : 0.22}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      </group>
      <mesh
        visible={false}
        onPointerDown={handleCollect}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[0.72, 10, 10]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

/**
 * 10–25 low-value fragments (1–3 each) scattered across the biome floor.
 * `biomeKey`/`lootSeed` are the biome's stable identity: the layout — and
 * what has already been collected — survives re-entry.
 */
export function BiomeLootField({
  biomeKey,
  lootSeed,
}: {
  biomeKey: string;
  lootSeed: number;
}) {
  const collectBiomeLoot = useFragmentsStore((s) => s.collectBiomeLoot);
  const lootClaimedIds = useFragmentsStore((s) => s.lootClaimedIds);

  const fragments = useMemo(() => {
    const random = mulberry32(lootSeed ^ 0x10c5e);
    const count = 10 + Math.floor(random() * 16);
    return Array.from({ length: count }, (_, index) => {
      const angle = random() * Math.PI * 2;
      const radius = 0.9 + random() * (CHAMBER_RADIUS * 0.55);
      const variant = Math.floor(random() * CRYSTAL_VARIANTS);
      return {
        id: `loot-${biomeKey}-f${index}`,
        position: [
          Math.cos(angle) * radius,
          FLOOR_Y + 0.2,
          Math.sin(angle) * radius,
        ] as [number, number, number],
        variant,
        amount: 1 + Math.floor(random() * 3),
        entryDelay: 0.7 + random() * 1.1,
      };
    });
  }, [biomeKey, lootSeed]);

  return (
    <group>
      {fragments
        .filter((fragment) => !lootClaimedIds.includes(fragment.id))
        .map((fragment) => (
          <FloorFragment
            key={fragment.id}
            position={fragment.position}
            variant={fragment.variant}
            entryDelay={fragment.entryDelay}
            onCollect={() =>
              collectBiomeLoot({
                id: fragment.id,
                name: "Biome Fragment",
                rarity: "common",
                fragments: fragment.amount,
                kind: "fragment",
                mesh: {
                  generator: "crystal-v1",
                  seed: fragment.variant,
                  variant: fragment.variant,
                  scale: 0.3,
                },
              } satisfies BiomeLootInput)
            }
          />
        ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* The center crystal                                                   */
/* ------------------------------------------------------------------ */

const CRYSTAL_NAMES = [
  "Nexus Prism",
  "Void Shard",
  "Ember Heart",
  "Echo Spire",
  "Silver Fracture",
  "Deep Relic",
];

interface CenterCrystalRoll {
  present: boolean;
  value: number;
  name: string;
  seed: number;
  scale: number;
}

/** Deterministic per-biome roll: 3 in 5 asteroid biomes grow one. */
export function rollCenterCrystal(lootSeed: number): CenterCrystalRoll {
  const random = mulberry32(lootSeed ^ 0xc0ffee);
  const present = random() < 0.6;
  const tier = random();
  const value =
    tier < 0.06
      ? 5000 + Math.round((random() * 5000) / 100) * 100
      : tier < 0.24
        ? 1000 + Math.round((random() * 2000) / 50) * 50
        : 100 + Math.round((random() * 400) / 10) * 10;
  return {
    present,
    value,
    name: CRYSTAL_NAMES[Math.floor(random() * CRYSTAL_NAMES.length)]!,
    seed: Math.floor(random() * 0x7fffffff),
    // Value → size: 100 ≈ 1.1, 1,000 ≈ 3, 10,000 ≈ 4.9 (fills the room).
    scale: 1.1 + Math.log10(Math.max(value, 100) / 100) * 1.9,
  };
}

const ERUPT_DURATION = 1.15;
const PIECE_STAGGER = 0.07;

export function CenterCrystal({
  biomeKey,
  lootSeed,
  autoExitOnCollect = true,
}: {
  biomeKey: string;
  lootSeed: number;
  autoExitOnCollect?: boolean;
}) {
  const collectBiomeLoot = useFragmentsStore((s) => s.collectBiomeLoot);
  const lootClaimedIds = useFragmentsStore((s) => s.lootClaimedIds);
  const exitCave = useGalaxyStore((s) => s.exitCave);

  const roll = useMemo(() => rollCenterCrystal(lootSeed), [lootSeed]);
  const lootId = `loot-${biomeKey}-crystal`;
  const claimed = lootClaimedIds.includes(lootId);

  const groupRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const pieceRefs = useRef<Array<THREE.Group | null>>([]);
  const timeRef = useRef(0);
  const [taken, setTaken] = useState(false);
  const [gone, setGone] = useState(false);
  const [hovered, setHovered] = useState(false);

  const tint = crystalTintForValue(roll.value);
  const pieces = useMemo(
    () => (roll.present ? createEdgyCrystalPieces(roll.seed) : []),
    [roll],
  );
  const chaos = useMemo(() => {
    const random = mulberry32(roll.seed ^ 0xbad5eed);
    return pieces.map(() => ({
      x: (random() - 0.5) * 3.2,
      z: (random() - 0.5) * 3.2,
      spin: (random() - 0.5) * 9,
      apex: 1.6 + random() * 2.4,
    }));
  }, [pieces, roll.seed]);
  useEffect(
    () => () => {
      for (const piece of pieces) piece.geometry.dispose();
    },
    [pieces],
  );

  useEffect(() => {
    if (roll.present && !claimed && roll.value >= 5000) {
      trackLandingEvent({
        slug: "landing.crystal_room_filled",
        metadata: { loot_id: lootId, fragments: roll.value },
      });
    }
    // Fire once per mount of a room-filling crystal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    timeRef.current += delta;
    const t = timeRef.current;

    // Erupt: every shard blasts out of the floor and settles into its
    // exact slot — same beat as the emblem/card assembly.
    pieces.forEach((piece, index) => {
      const ref = pieceRefs.current[index];
      const wobble = chaos[index];
      if (!ref || !wobble) return;
      const local = Math.min(
        Math.max((t - 0.55 - index * PIECE_STAGGER) / ERUPT_DURATION, 0),
        1,
      );
      const eased = local * local * (3 - 2 * local);
      const arc = Math.sin(eased * Math.PI);
      ref.position.set(
        piece.position[0] + wobble.x * (1 - eased),
        THREE.MathUtils.lerp(FLOOR_Y * 0.35, piece.position[1], eased) +
          arc * wobble.apex * 0.25,
        piece.position[2] + wobble.z * (1 - eased),
      );
      ref.rotation.set(
        piece.rotation[0] + wobble.spin * (1 - eased),
        piece.rotation[1] + wobble.spin * 0.7 * (1 - eased),
        piece.rotation[2],
      );
    });

    // Assembled: loop a slow full-3D rotation.
    const spin = spinRef.current;
    if (spin) {
      const assembled = t > 0.55 + ERUPT_DURATION + pieces.length * PIECE_STAGGER;
      if (assembled && !taken) {
        spin.rotation.y += delta * 0.45;
        spin.rotation.x = Math.sin(t * 0.32) * 0.3;
        spin.rotation.z = Math.cos(t * 0.21) * 0.14;
      }
    }

    // Claimed: dissolve into light.
    const target = taken ? 0.001 : roll.scale;
    const scale = THREE.MathUtils.lerp(group.scale.x, target, delta * 3.2);
    group.scale.setScalar(scale);
    if (taken && scale < 0.02) setGone(true);
  });

  if (!roll.present || claimed || gone) return null;

  const handleCollect = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (taken) return;
    setTaken(true);
    document.body.style.cursor = "auto";
    collectBiomeLoot({
      id: lootId,
      name: roll.name,
      rarity: rarityForValue(roll.value),
      fragments: roll.value,
      kind: "crystal",
      mesh: {
        generator: EDGY_CRYSTAL_GENERATOR,
        seed: roll.seed,
        scale: roll.scale,
        params: { value: roll.value },
      },
    });
    // The find is big enough to end the dive: surface back to where the
    // explorer came from (belt or solar system).
    if (autoExitOnCollect) {
      window.setTimeout(() => exitCave(), 700);
    }
  };

  return (
    <group
      ref={groupRef}
      position={[0, FLOOR_Y + 0.18, 0]}
      scale={roll.scale}
    >
      <group ref={spinRef}>
        {pieces.map((piece, index) => (
          <group
            key={`${lootId}-p${index}`}
            ref={(node) => {
              pieceRefs.current[index] = node;
            }}
            position={piece.position}
            rotation={piece.rotation}
          >
            <mesh geometry={piece.geometry}>
              <meshStandardMaterial
                color={tint.color}
                metalness={0.35}
                roughness={0.12}
                emissive={tint.emissive}
                emissiveIntensity={hovered ? 1.6 : 1.05}
                flatShading
                transparent
                opacity={0.97}
              />
            </mesh>
          </group>
        ))}
      </group>
      <sprite scale={[2.6, 2.6, 1]} position={[0, 0.5, 0]}>
        <spriteMaterial
          map={getDotTexture()}
          color={tint.glow}
          transparent
          opacity={hovered ? 0.5 : 0.3}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      <pointLight
        color={tint.glow}
        intensity={roll.value >= 1000 ? 6 : 2.5}
        distance={8}
        decay={2}
        position={[0, 0.8, 0]}
      />
      <mesh
        visible={false}
        onPointerDown={handleCollect}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[1.05, 12, 12]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}
