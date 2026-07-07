"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader, type ThreeEvent } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { CollectibleDef, GalaxyEntity } from "@/lib/galaxy/registry-types";
import {
  getEntityById,
  getOwningProduct,
} from "@/lib/galaxy/registry-helpers";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { useGalaxyStore, ORBIT_STEPS } from "@/lib/galaxy-store";
import {
  chamberStyleForBiome,
  visitInteriorPosition,
  type ChamberStyleKey,
} from "@/lib/three/chamber";
import {
  createCrystalGeometry,
  crystalTintForRarity,
  CRYSTAL_VARIANTS,
} from "@/lib/three/crystal";
import { getDotTexture } from "@/lib/three/dot-texture";
import { biomeForEntity } from "@/lib/three/planet";
import { hashString, mulberry32 } from "@/lib/three/procedural";
import { BiomeChamber, CHAMBER_RADIUS } from "./BiomeChamber";
import { BiomeLootField } from "./BiomeLoot";

/**
 * The inside of the focused world. Stepping onto a product, orchestrator,
 * or capability dives beneath its surface into a seeded biome chamber —
 * with the world's own transparent emblem pulsing and wobbling at its
 * heart, and (if fortune rolls right) hidden treasure to claim.
 */

/** Curated interiors for the product worlds; children hash their biome. */
const PRODUCT_INTERIORS: Record<string, ChamberStyleKey> = {
  "product.core": "lush", // the living grove at the heart of your Brain
  "product.command": "gem", // steel world → chrome vault
  "product.studio": "violet", // gas giant → spore-lit cipher depths
  "product.launch": "ember", // lava world → magma vault
};

const EMBLEM_SIZE = 1.25;
const EMBLEM_GRID = 5;

/**
 * The world's logo, DELIVERED BY THE ERUPTION: the mark is split into a
 * grid of shards that blast out of the cracked floor as tumbling debris
 * — pure chaos — then get pulled together mid-air, fusing into the
 * finished emblem at the chamber's heart, where it pulses and bobs.
 */
function InteriorEmblem({
  entity,
  seed,
}: {
  entity: GalaxyEntity;
  seed: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const shardsRef = useRef<THREE.Group>(null);
  const auraRef = useRef<THREE.SpriteMaterial>(null);
  const timeRef = useRef(0);
  const texture = useLoader(
    THREE.TextureLoader,
    `/logos/entities/${entity.type}-${entity.slug}.png`,
  );

  // One material for all shards — the texture tiles live in the UVs.
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [texture],
  );
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  const shards = useMemo(() => {
    const random = mulberry32(seed ^ 0xf2a6);
    const tile = EMBLEM_SIZE / EMBLEM_GRID;
    const list: Array<{
      geometry: THREE.PlaneGeometry;
      slot: THREE.Vector3;
      vel: THREE.Vector3;
      delay: number;
      settle: number;
      spin: THREE.Vector3;
      spinSpeed: number;
    }> = [];
    for (let row = 0; row < EMBLEM_GRID; row++) {
      for (let col = 0; col < EMBLEM_GRID; col++) {
        const geometry = new THREE.PlaneGeometry(tile, tile);
        const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(
            i,
            (col + uv.getX(i)) / EMBLEM_GRID,
            (row + uv.getY(i)) / EMBLEM_GRID,
          );
        }
        const angle = random() * Math.PI * 2;
        list.push({
          geometry,
          slot: new THREE.Vector3(
            (col + 0.5) * tile - EMBLEM_SIZE / 2,
            (row + 0.5) * tile - EMBLEM_SIZE / 2,
            0,
          ),
          vel: new THREE.Vector3(
            Math.cos(angle) * (0.4 + random() * 1.5),
            2.4 + random() * 2.6,
            Math.sin(angle) * (0.3 + random() * 0.7),
          ),
          delay: random() * 0.55,
          settle: 1.0 + random() * 0.8,
          spin: new THREE.Vector3(
            random() - 0.5,
            random() - 0.5,
            random() - 0.5,
          ).normalize(),
          spinSpeed: 3 + random() * 7,
        });
      }
    }
    return list;
  }, [seed]);
  useEffect(() => {
    return () => {
      shards.forEach((shard) => shard.geometry.dispose());
    };
  }, [shards]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    const shardsGroup = shardsRef.current;
    if (!group || !shardsGroup) return;
    timeRef.current += delta;
    const t = timeRef.current;

    // Phase per shard: ballistic chaos out of the vent → pulled into its
    // slot in the mark as it rises.
    let assembled = 0;
    shardsGroup.children.forEach((child, index) => {
      const shard = shards[index];
      if (!shard || !(child instanceof THREE.Mesh)) return;
      const age = Math.max(0, t - shard.delay);
      const chaosX = shard.vel.x * age;
      const chaosY = Math.max(
        -2.25,
        -2.25 + shard.vel.y * age - 0.9 * age * age,
      );
      const chaosZ = shard.vel.z * age;
      const pull = Math.min(1, Math.max(0, (t - shard.settle) / 1.1));
      const eased = pull * pull * (3 - 2 * pull);
      assembled += eased;
      child.position.set(
        THREE.MathUtils.lerp(chaosX, shard.slot.x, eased),
        THREE.MathUtils.lerp(chaosY, shard.slot.y, eased),
        THREE.MathUtils.lerp(chaosZ, shard.slot.z, eased),
      );
      const tumble = shard.spinSpeed * age * (1 - eased);
      child.rotation.set(
        shard.spin.x * tumble,
        shard.spin.y * tumble,
        shard.spin.z * tumble,
      );
    });
    assembled /= shards.length;

    // Once fused: the familiar pulse, wobble, and bob — scaled in by the
    // assembly so the finished mark comes alive as the last shard lands.
    group.scale.setScalar(1 + Math.sin(t * 1.5) * 0.05 * assembled);
    group.rotation.z = Math.sin(t * 0.8) * 0.05 * assembled;
    group.position.y = -0.3 + Math.sin(t * 0.6) * 0.1 * assembled;
    if (auraRef.current) auraRef.current.opacity = 0.12 * assembled;
  });

  return (
    <Billboard>
      <group ref={groupRef} position={[0, -0.3, 0]}>
        <group ref={shardsRef}>
          {shards.map((shard, index) => (
            <mesh key={index} geometry={shard.geometry} material={material} />
          ))}
        </group>
        {/* soft aura behind the mark — breathes in with the assembly */}
        <sprite scale={[2.3, 2.3, 1]} position={[0, 0, -0.2]}>
          <spriteMaterial
            ref={auraRef}
            map={getDotTexture()}
            color="#aeb6bc"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      </group>
    </Billboard>
  );
}

/** A hidden treasure crystal grown from this chamber's floor. */
function TreasureCrystal({
  collectible,
  position,
  paused,
}: {
  collectible: CollectibleDef;
  position: THREE.Vector3;
  paused: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const timeRef = useRef(0);
  const [gone, setGone] = useState(false);
  const [hovered, setHovered] = useState(false);
  const select = useFragmentsStore((s) => s.select);
  const claimed = useFragmentsStore((s) =>
    s.claimedIds.includes(collectible.id),
  );
  const isSelected = useFragmentsStore(
    (s) => s.selected?.id === collectible.id,
  );

  const variant = hashString(collectible.id) % CRYSTAL_VARIANTS;
  const tint = crystalTintForRarity(collectible.rarity);
  // Treasure joins the volcanic welcome: it stays buried through the
  // first blast, then grows out of the floor on its own seeded beat.
  const entryDelay = 0.9 + (hashString(collectible.id) % 7) * 0.22;
  const geometry = useMemo(() => createCrystalGeometry(variant), [variant]);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    if (paused || !groupRef.current) return;
    timeRef.current += delta;
    // Claimed treasure dissolves into light.
    const target =
      claimed || timeRef.current < entryDelay ? 0.001 : 1;
    const scale = THREE.MathUtils.lerp(
      groupRef.current.scale.x,
      target,
      delta * 3,
    );
    groupRef.current.scale.setScalar(scale);
    if (claimed && scale < 0.01) setGone(true);
  });

  if (gone) return null;

  const handleSelect = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!claimed) select(collectible);
  };

  return (
    <group position={position}>
      {/* visual grows in; the hit sphere stays full-size from frame 1 so
          taps land even mid-eruption or under camera sway */}
      <group ref={groupRef} scale={0.001}>
        <mesh geometry={geometry} scale={0.5}>
          <meshStandardMaterial
            color={tint.color}
            metalness={0.25}
            roughness={0.15}
            emissive={tint.emissive}
            emissiveIntensity={isSelected ? 1.8 : hovered ? 1.3 : 0.9}
            transparent
            opacity={0.96}
          />
        </mesh>
        {/* additive glow instead of a real light: treasure count varies
            per visit, and a varying light count forces a full shader
            recompile mid-entry — the very hitch the warm-up removes. */}
        <sprite scale={[1.7, 1.7, 1]}>
          <spriteMaterial
            map={getDotTexture()}
            color={tint.glow}
            transparent
            opacity={isSelected ? 0.5 : 0.28}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      </group>
      <mesh
        visible={false}
        onPointerDown={handleSelect}
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
        <sphereGeometry args={[0.85, 12, 12]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}

/** Seeded treasure placement: some visits hide riches, some don't. */
function InteriorTreasures({
  entity,
  seed,
  paused,
}: {
  entity: GalaxyEntity;
  seed: number;
  paused: boolean;
}) {
  const owner =
    entity.type === "product" ? entity : getOwningProduct(entity);
  const spots = useMemo(() => {
    if (!owner) return [];
    // Snapshot of claims at entry: only unclaimed treasure spawns, and a
    // claim mid-visit dissolves in place instead of reshuffling the room.
    const claimedIds = useFragmentsStore.getState().claimedIds;
    const pool = VORINTHEX_GALAXY_REGISTRY.collectibles.filter(
      (c) =>
        !c.isDiscoverable &&
        c.isClaimable &&
        c.parentEntityId === owner.id &&
        !claimedIds.includes(c.id),
    );
    if (pool.length === 0) return [];
    const random = mulberry32(seed ^ 0x77ea);
    // Every biome holds treasure: at least one, sometimes two.
    const count = Math.min(1 + (random() < 0.4 ? 1 : 0), pool.length);
    const picks: Array<{ collectible: CollectibleDef; position: THREE.Vector3 }> = [];
    const used = new Set<number>();
    for (let i = 0; i < count && used.size < pool.length; i++) {
      let index = Math.floor(random() * pool.length);
      while (used.has(index)) index = (index + 1) % pool.length;
      used.add(index);
      const angle = random() * Math.PI * 2;
      const radius = 1.2 + random() * (CHAMBER_RADIUS * 0.45);
      picks.push({
        collectible: pool[index],
        position: new THREE.Vector3(
          Math.cos(angle) * radius,
          -CHAMBER_RADIUS * 0.52 + 0.25,
          Math.sin(angle) * radius,
        ),
      });
    }
    return picks;
  }, [owner, seed]);

  return (
    <group>
      {spots.map(({ collectible, position }) => (
        <TreasureCrystal
          key={collectible.id}
          collectible={collectible}
          position={position}
          paused={paused}
        />
      ))}
    </group>
  );
}

export function WorldInterior() {
  const mode = useGalaxyStore((s) => s.mode);
  const step = useGalaxyStore((s) => s.step);
  const visitPhase = useGalaxyStore((s) => s.visitPhase);
  const visitSeed = useGalaxyStore((s) => s.visitSeed);

  if (mode !== "system" || visitPhase === "fly") return null;
  const entityId = ORBIT_STEPS[step]?.entityId;
  if (!entityId) return null;
  const entity = getEntityById(entityId);
  if (!entity) return null;

  const styleKey =
    PRODUCT_INTERIORS[entityId] ??
    chamberStyleForBiome(biomeForEntity(entityId));

  return (
    <BiomeChamber
      styleKey={styleKey}
      seed={visitSeed}
      position={visitInteriorPosition(hashString(entityId))}
    >
      {/* keyed by seed so the emblem erupts anew on every entry */}
      <Suspense fallback={null} key={visitSeed}>
        <InteriorEmblem entity={entity} seed={visitSeed} />
      </Suspense>
      <InteriorTreasures entity={entity} seed={visitSeed} paused={false} />
      {/* the scavengeable floor: 10–25 small fragments, stable per world */}
      <BiomeLootField
        biomeKey={`world-${entityId}`}
        lootSeed={hashString(`world-${entityId}`)}
      />
    </BiomeChamber>
  );
}
