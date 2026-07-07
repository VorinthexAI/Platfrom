"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";

/**
 * The universe you fly through during the arrival flight: spiral galaxy
 * impostors and foreign solar systems scattered along the entry corridor,
 * so the 3-second dive reads as crossing many galaxies before landing in
 * ours. Only mounted while the intro plays.
 */

let galaxyTextures: THREE.CanvasTexture[] | null = null;

/** Procedurally painted spiral galaxies (two arms, soft core). */
function getGalaxyTextures(): THREE.CanvasTexture[] {
  if (galaxyTextures) return galaxyTextures;
  const variants: Array<{ tint: string; arms: number; twist: number }> = [
    { tint: "220, 228, 236", arms: 2, twist: 0.16 },
    { tint: "196, 214, 228", arms: 3, twist: 0.12 },
    { tint: "236, 216, 196", arms: 2, twist: 0.2 },
  ];
  galaxyTextures = variants.map(({ tint, arms, twist }, index) => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const cx = size / 2;
    const random = mulberry32(0x9a1a + index);

    // Soft luminous core.
    const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, size * 0.16);
    core.addColorStop(0, `rgba(${tint}, 0.95)`);
    core.addColorStop(1, `rgba(${tint}, 0)`);
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, size, size);

    // Spiral arms: thousands of faint star dabs along log spirals.
    for (let arm = 0; arm < arms; arm++) {
      const armOffset = (arm / arms) * Math.PI * 2;
      for (let i = 0; i < 900; i++) {
        const along = i / 900;
        const radius = 6 + along * (size * 0.46);
        const theta = armOffset + radius * twist + (random() - 0.5) * 0.5;
        const x = cx + Math.cos(theta) * radius + (random() - 0.5) * 9;
        const y = cx + Math.sin(theta) * radius * 0.62 + (random() - 0.5) * 9;
        const alpha = (1 - along) * 0.3 * (0.4 + random() * 0.6);
        ctx.fillStyle = `rgba(${tint}, ${alpha.toFixed(3)})`;
        const dot = 0.6 + random() * 1.6;
        ctx.fillRect(x, y, dot, dot);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
  });
  return galaxyTextures;
}

interface GalaxyPlacement {
  position: [number, number, number];
  scale: number;
  textureIndex: number;
  spin: number;
}

export function IntroCosmos() {
  const mode = useGalaxyStore((s) => s.mode);
  const groupRef = useRef<THREE.Group>(null);

  const placements = useMemo<GalaxyPlacement[]>(() => {
    const rand = mulberry32(0xc0503);
    const list: GalaxyPlacement[] = [];
    // Scattered along the entry corridor (camera dives from z≈270 to 15).
    for (let i = 0; i < 8; i++) {
      const z = 50 + i * 27 + rand() * 14;
      list.push({
        position: [
          (rand() < 0.5 ? -1 : 1) * (26 + rand() * 60),
          (rand() * 2 - 1) * 42,
          z,
        ],
        scale: 14 + rand() * 22,
        textureIndex: Math.floor(rand() * 3),
        spin: (rand() - 0.5) * 0.12,
      });
    }
    return list;
  }, []);

  // Foreign suns: bright pinpoints with colored glow along the corridor.
  const starPlacements = useMemo(() => {
    const rand = mulberry32(0x57a25);
    return Array.from({ length: 14 }, () => ({
      position: [
        (rand() * 2 - 1) * 110,
        (rand() * 2 - 1) * 55,
        40 + rand() * 220,
      ] as [number, number, number],
      scale: 1.6 + rand() * 3.4,
      color: rand() < 0.3 ? "#ffb25c" : rand() < 0.6 ? "#c2d5e4" : "#f5f7f8",
    }));
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.visible = mode === "intro";
    if (mode !== "intro") return;
    groupRef.current.children.forEach((child, index) => {
      const placement = placements[index];
      if (placement && child instanceof THREE.Sprite) {
        child.material.rotation += delta * placement.spin;
      }
    });
  });

  const textures = typeof window !== "undefined" ? getGalaxyTextures() : [];
  if (textures.length === 0) return null;

  return (
    <group ref={groupRef} visible={false}>
      {placements.map((placement, index) => (
        <sprite
          key={`galaxy-${index}`}
          position={placement.position}
          scale={[placement.scale, placement.scale * 0.62, 1]}
        >
          <spriteMaterial
            map={textures[placement.textureIndex]}
            transparent
            opacity={0.85}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
      {starPlacements.map((star, index) => (
        <sprite key={`star-${index}`} position={star.position} scale={[star.scale, star.scale, 1]}>
          <spriteMaterial
            map={getDotTexture()}
            color={star.color}
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}
