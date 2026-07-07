"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { getEntityRenderState } from "@/lib/galaxy/registry-helpers";
import { useGalaxyStore } from "@/lib/galaxy-store";
import { getEntityLogoTexture } from "@/lib/three/entity-logo";
import { OrbitRing } from "./OrbitRing";
import { PlanetSurface } from "./PlanetSurface";

/**
 * Registry-driven moon system: renders a product's children (Core
 * capabilities, Command orchestrators, future Studio/Launch children) as
 * distinct biome worlds on inclined 3D orbits around their parent planet.
 * No floating labels — names live in the drawer and the orbit rail.
 */

/** The moon's own mark, billboarded so the world sits within its logo. */
function MoonLogoRing({
  entity,
  size,
  dim,
}: {
  entity: GalaxyEntity;
  size: number;
  dim: boolean;
}) {
  const texture = useMemo(
    () => getEntityLogoTexture(entity.type, entity.slug),
    [entity.type, entity.slug],
  );
  const scale = size * 2.1;
  return (
    <Billboard>
      <mesh>
        <planeGeometry args={[scale, scale]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={dim ? 0.26 : 0.5}
          depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}

interface OrbitingBodyProps {
  entity: GalaxyEntity;
  paused: boolean;
  visible: boolean;
  onSelect: (entity: GalaxyEntity) => void;
}

function OrbitingBody({ entity, paused, visible, onSelect }: OrbitingBodyProps) {
  const bodyRef = useRef<THREE.Group>(null);
  const angleRef = useRef(entity.visual.initialAngle ?? 0);
  const [hovered, setHovered] = useState(false);
  const child = useGalaxyStore((s) => s.child);
  const isFocused = child === entity.slug;

  const renderState = getEntityRenderState(entity);

  const dormant = renderState !== "active";
  const radius = entity.visual.orbitRadius ?? 2;
  const speed = entity.visual.orbitSpeed ?? 0.2;
  const size = entity.visual.size ?? 0.2;

  const throttleRef = useRef(1);

  useFrame((_, delta) => {
    if (!bodyRef.current) return;
    // Focused moons throttle down smoothly instead of freezing.
    const throttleTarget = isFocused ? 0 : dormant ? 0.7 : 1;
    throttleRef.current = THREE.MathUtils.damp(
      throttleRef.current,
      throttleTarget,
      1.6,
      delta,
    );
    if (!paused) {
      angleRef.current += delta * speed * throttleRef.current;
    }
    bodyRef.current.position.set(
      Math.cos(angleRef.current) * radius,
      0,
      Math.sin(angleRef.current) * radius,
    );
  });

  if (renderState === "hidden") return null;

  return (
    <group
      rotation={[
        entity.visual.orbitInclination ?? 0,
        0,
        entity.visual.orbitTilt ?? 0,
      ]}
    >
      <OrbitRing radius={radius} opacity={visible ? 0.08 : 0.03} />
      <group ref={bodyRef}>
        <PlanetSurface
          entityId={entity.id}
          radius={size * 0.62}
          segments={48}
          paused={paused}
          dormant={dormant && !isFocused}
          hovered={hovered}
          focused={isFocused}
        />
        <MoonLogoRing entity={entity} size={size} dim={dormant && !hovered && !isFocused} />
        {/* generous invisible hit target so small moons stay clickable */}
        <mesh
          visible={false}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(entity);
          }}
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
          <sphereGeometry args={[Math.max(size * 1.4, 0.3), 12, 12]} />
          <meshBasicMaterial />
        </mesh>
      </group>
    </group>
  );
}

interface OrbitingEntitiesProps {
  entities: GalaxyEntity[];
  /** Product key whose focus reveals the moons fully. */
  revealForFocus: string;
  paused: boolean;
  onSelect: (entity: GalaxyEntity) => void;
}

export function OrbitingEntities({
  entities,
  revealForFocus,
  paused,
  onSelect,
}: OrbitingEntitiesProps) {
  const focus = useGalaxyStore((s) => s.focus);
  const hovered = useGalaxyStore((s) => s.hovered);
  const revealed =
    focus === revealForFocus || (focus === null && hovered === revealForFocus);

  return (
    <group>
      {entities.map((entity) => (
        <OrbitingBody
          key={entity.id}
          entity={entity}
          paused={paused}
          visible={revealed}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
