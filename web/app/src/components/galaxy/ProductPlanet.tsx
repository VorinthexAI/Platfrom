"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { ProductPlanetData } from "@/data/products";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { getEntityLogoTexture } from "@/lib/three/entity-logo";
import { planetPositions, trackedVector } from "./galaxy-refs";
import { PlanetSurface } from "./PlanetSurface";

/**
 * Planet bodies: every product is a shader-built biome world — Core a
 * living bioluminescent planet, Command fractured steel, Studio a banded
 * gas giant, Launch a lava world — each sitting within its own brand
 * ring, exactly like the sun sits within the Vorinthex mark. No floating
 * labels; names live in the drawer and the orbit rail.
 */
function PlanetBody({
  data,
  paused,
  hovered,
  isFocused,
}: {
  data: ProductPlanetData;
  paused: boolean;
  hovered: boolean;
  isFocused: boolean;
}) {
  return (
    <PlanetSurface
      entityId={data.key}
      paused={paused}
      dormant={data.status === "coming-soon"}
      hovered={hovered}
      focused={isFocused}
    />
  );
}

/** The product's mark, billboarded so the planet sits within its logo. */
function PlanetLogoRing({
  slug,
  scale,
  dim,
}: {
  slug: string;
  scale: number;
  dim: boolean;
}) {
  const texture = useMemo(() => getEntityLogoTexture("product", slug), [slug]);
  return (
    <Billboard>
      <mesh>
        <planeGeometry args={[scale, scale]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={dim ? 0.32 : 0.55}
          depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}

interface ProductPlanetProps {
  data: ProductPlanetData;
  paused: boolean;
  onSelect: (data: ProductPlanetData) => void;
  children?: ReactNode;
}

export function ProductPlanet({
  data,
  paused,
  onSelect,
  children,
}: ProductPlanetProps) {
  const groupRef = useRef<THREE.Group>(null);
  const angleRef = useRef(data.initialAngle);
  const throttleRef = useRef(1);
  const hovered = useGalaxyStore((s) => s.hovered === data.key);
  const isFocused = useGalaxyStore((s) => s.focus === data.key);
  const setHovered = useGalaxyStore((s) => s.setHovered);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Focusing a world doesn't slam its orbit to a halt — the motion
    // throttles down smoothly as we step inside, and winds back up when
    // the camera leaves.
    const throttleTarget = isFocused ? 0 : hovered ? 0.12 : 1;
    throttleRef.current = THREE.MathUtils.damp(
      throttleRef.current,
      throttleTarget,
      1.6,
      delta,
    );
    if (!paused) {
      angleRef.current += delta * data.orbitSpeed * throttleRef.current;
    }
    const x = Math.cos(angleRef.current) * data.orbitRadius;
    const z = Math.sin(angleRef.current) * data.orbitRadius;
    groupRef.current.position.set(x, 0, z);
    trackedVector(planetPositions, data.key).set(x, 0, z);
  });

  return (
    <group ref={groupRef} scale={data.scale}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          // A sideways camera drag that happens to end on a planet is not
          // a click — only a still tap selects.
          if (event.delta > 8) return;
          onSelect(data);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(data.key);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(null);
          document.body.style.cursor = "auto";
        }}
      >
        <PlanetBody
          data={data}
          paused={paused}
          hovered={hovered}
          isFocused={isFocused}
        />
        <PlanetLogoRing
          slug={data.slug}
          scale={1.9}
          dim={data.status === "coming-soon" && !hovered && !isFocused}
        />
        {/* invisible hit target so small planets stay easy to click */}
        <mesh visible={false}>
          <sphereGeometry args={[1.1, 12, 12]} />
          <meshBasicMaterial />
        </mesh>
      </group>

      {children}
    </group>
  );
}
