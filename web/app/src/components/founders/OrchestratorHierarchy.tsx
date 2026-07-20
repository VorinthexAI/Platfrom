"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Billboard, Environment, Html, Lightformer, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import type { AccessibleOrganizationOption, BeaconToolActivity } from "@/lib/founders/types";
import { entityLogoUrl } from "@/lib/three/entity-logo";
import NexusBrainCore from "./NexusBrainCore";

const ORCHESTRATORS = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const CORE = VORINTHEX_GALAXY_REGISTRY.products.core;
const ATLAS = VORINTHEX_GALAXY_REGISTRY.orchestrators.atlas;
const CAPABILITIES = (CORE.children ?? [])
  .map((id) => Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities).find((entity) => entity.id === id))
  .filter((entity): entity is GalaxyEntity => Boolean(entity));
const LAYER_RADII = [0, 2.7, 4.35, 5.75, 7.2, 8.75, 10.4, 12.1];
const LAYER_HEIGHTS = [0.46, 0.32, 0.17, 0.02, -0.14, -0.3, -0.46, -0.62];
const NODE_ANGLES: Record<string, number> = {
  core: 90,
  archive: -90, gallery: -18, signal: 54, compass: 126, ascend: 198,
  launch: -90, studio: 90,
  atlas: 90,
  metis: -90, hermes: -150, phoenix: -30, athena: 30, ledger: 90, sentinel: 150,
  echo: -105, matrix: -75, harmony: -150, iris: -30, forge: 15, helios: 45, mercury: 90, themis: 150,
  orbit: -42, apollo: -18, aura: 5, pillar: 24, vulcan: 45,
};

function orchestratorDepth(entity: GalaxyEntity) {
  let depth = 0;
  let current = entity;
  while (current.reportsTo) {
    const parent = ORCHESTRATORS.find((candidate) => candidate.id === current.reportsTo);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

interface StationNode {
  entity: GalaxyEntity;
  layer: number;
  parentId?: string;
}

const STATION_NODES: StationNode[] = [
  { entity: CORE, layer: 0 },
  ...CAPABILITIES.map((entity) => ({ entity, layer: 1, parentId: CORE.id! })),
  { entity: VORINTHEX_GALAXY_REGISTRY.products.launch, layer: 2, parentId: CORE.id! },
  { entity: VORINTHEX_GALAXY_REGISTRY.products.studio, layer: 2, parentId: CORE.id! },
  { entity: ATLAS, layer: 3, parentId: CORE.id! },
  ...ORCHESTRATORS.filter((entity) => entity.slug !== "atlas").map((entity) => ({
    entity,
    layer: orchestratorDepth(entity) + 3,
    parentId: entity.reportsTo ?? undefined,
  })),
];
const NODE_BY_ID = new Map(STATION_NODES.map((node) => [node.entity.id, node]));
const NODE_BY_SLUG = new Map(STATION_NODES.map((node) => [node.entity.slug, node]));
const TAB_ORDER = [...STATION_NODES].sort(
  (left, right) => left.layer - right.layer || (NODE_ANGLES[left.entity.slug] ?? 0) - (NODE_ANGLES[right.entity.slug] ?? 0),
);

function modulePosition(node: StationNode): [number, number, number] {
  if (node.layer === 0) return [0, LAYER_HEIGHTS[0], 0];
  const { entity, layer } = node;
  const radius = LAYER_RADII[layer];
  const angle = THREE.MathUtils.degToRad(NODE_ANGLES[entity.slug] ?? 0);
  return layer % 2 === 0
    ? [LAYER_HEIGHTS[layer], Math.cos(angle) * radius, Math.sin(angle) * radius]
    : [Math.cos(angle) * radius, LAYER_HEIGHTS[layer], Math.sin(angle) * radius];
}

function activeBranch(selectedId: string) {
  const active = new Set<string>([selectedId]);
  let current = NODE_BY_ID.get(selectedId);
  while (current?.parentId) {
    const parent = NODE_BY_ID.get(current.parentId);
    if (!parent) break;
    active.add(parent.entity.id);
    current = parent;
  }
  return active;
}

type NavigateOrchestrator = (entity: GalaxyEntity, direction: 1 | -1) => void;

function useBrushedMetalTexture() {
  const texture = useMemo(() => {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        const grain = (x * 17 + y * 131 + (x * y % 29) * 7) % 46;
        const value = THREE.MathUtils.clamp(112 + grain + Math.sin(y * 0.42) * 24, 72, 210);
        data[index] = value;
        data[index + 1] = value;
        data[index + 2] = value;
        data[index + 3] = 255;
      }
    }
    const result = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    result.wrapS = THREE.RepeatWrapping;
    result.wrapT = THREE.RepeatWrapping;
    result.repeat.set(5, 1.5);
    result.colorSpace = THREE.NoColorSpace;
    result.needsUpdate = true;
    return result;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function handleTab(event: KeyboardEvent<HTMLButtonElement>, entity: GalaxyEntity, onNavigate: NavigateOrchestrator) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  onNavigate(entity, event.shiftKey ? -1 : 1);
}

function EngineeredRing({ radius, layer, paused, active, metalTexture }: { radius: number; layer: number; paused: boolean; active: boolean; metalTexture: THREE.Texture }) {
  const rotation = useRef<THREE.Group>(null);
  const segments = 26 + layer * 8;
  const segmentLength = (Math.PI * 2 * radius / segments) * 0.76;
  const height = LAYER_HEIGHTS[layer];
  const xAxis = layer % 2 === 0;
  const ringRotation: [number, number, number] = xAxis ? [0, Math.PI / 2, 0] : [Math.PI / 2, 0, 0];

  useFrame((_, delta) => {
    if (!paused && rotation.current) {
      if (xAxis) rotation.current.rotation.x -= delta * 0.007;
      else rotation.current.rotation.y += delta * 0.005;
    }
  });

  return (
    <group ref={rotation} position={xAxis ? [height, 0, 0] : [0, height, 0]}>
      {[-0.2, 0, 0.2].map((offset, index) => (
        <mesh key={offset} position={xAxis ? [offset, 0, 0] : [0, offset, 0]} rotation={ringRotation} castShadow receiveShadow>
          <torusGeometry args={[radius + (index - 1) * 0.1, index === 1 ? 0.13 : 0.055, 8, 192]} />
          <meshPhysicalMaterial
            color={index === 1 ? "#14171a" : "#5d6267"}
            emissive={active && index === 1 ? "#592207" : "#000000"}
            emissiveIntensity={active ? 0.7 : 0}
            metalness={0.96}
            roughness={index === 1 ? 0.3 : 0.18}
            roughnessMap={metalTexture}
            clearcoat={0.42}
            clearcoatRoughness={0.16}
            envMapIntensity={1.6}
          />
        </mesh>
      ))}
      <mesh position={xAxis ? [0.24, 0, 0] : [0, 0.24, 0]} rotation={ringRotation}>
        <torusGeometry args={[radius, 0.016, 5, 192]} />
        <meshBasicMaterial color={active ? "#ff9e38" : "#7b3c15"} transparent opacity={active ? 0.9 : 0.34} blending={THREE.AdditiveBlending} />
      </mesh>

      {Array.from({ length: segments }, (_, index) => {
        const angle = (index / segments) * Math.PI * 2;
        const major = index % 6 === 0;
        return (
          <group
            key={index}
            position={xAxis ? [0, Math.cos(angle) * radius, Math.sin(angle) * radius] : [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
            rotation={xAxis ? [angle, 0, 0] : [0, -angle, 0]}
          >
            <mesh castShadow receiveShadow>
              <boxGeometry args={[major ? 0.5 : 0.28, major ? 0.4 : 0.22, segmentLength]} />
              <meshPhysicalMaterial color={major ? "#30363a" : "#171b1e"} metalness={0.98} roughness={major ? 0.2 : 0.3} roughnessMap={metalTexture} clearcoat={0.5} clearcoatRoughness={0.22} envMapIntensity={1.7} />
            </mesh>
            {major ? (
              <>
                <mesh position={xAxis ? [0, 0.215, 0] : [0.265, 0, 0]}>
                  <boxGeometry args={xAxis ? [0.28, 0.018, segmentLength * 0.62] : [0.018, 0.24, segmentLength * 0.62]} />
                  <meshPhysicalMaterial color="#788087" metalness={1} roughness={0.13} roughnessMap={metalTexture} clearcoat={0.7} envMapIntensity={2} />
                </mesh>
                <mesh position={xAxis ? [0, 0.227, 0] : [0.278, 0, 0]}>
                  <boxGeometry args={xAxis ? [0.12, 0.01, segmentLength * 0.34] : [0.01, 0.03, segmentLength * 0.34]} />
                  <meshBasicMaterial color={active ? "#ffad55" : "#73401f"} toneMapped={false} />
                </mesh>
                <mesh position={[0, 0.42, 0]} castShadow>
                  <cylinderGeometry args={[0.055, 0.1, 0.62, 8]} />
                  <meshStandardMaterial color="#777d82" metalness={1} roughness={0.2} />
                </mesh>
                <mesh position={[0, 0.77, 0]}>
                  <sphereGeometry args={[0.045, 10, 10]} />
                  <meshBasicMaterial color={index % 12 === 0 ? "#f4f6f7" : "#d06418"} toneMapped={false} />
                </mesh>
                <mesh position={[0, -0.31, 0]}>
                  <boxGeometry args={[0.15, 0.22, 0.64]} />
                  <meshStandardMaterial color="#303438" metalness={0.9} roughness={0.3} />
                </mesh>
              </>
            ) : null}
            <mesh position={xAxis ? [0, 0.13, segmentLength * 0.35] : [major ? 0.27 : 0.16, 0.08, segmentLength * 0.35]}>
              <sphereGeometry args={[major ? 0.026 : 0.018, 8, 8]} />
              <meshBasicMaterial color={active ? "#ffb15c" : "#9b5629"} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function EnergyConduit({ from, to, active, paused, reverse = false }: {
  from: [number, number, number];
  to: [number, number, number];
  active: boolean;
  paused: boolean;
  reverse?: boolean;
}) {
  const pulse = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const middle = start.clone().lerp(end, 0.5);
    middle.y += 0.28 + start.distanceTo(end) * 0.04;
    return new THREE.CatmullRomCurve3([start, middle, end]);
  }, [from, to]);
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 32, active ? 0.026 : 0.012, 6, false), [active, curve]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    if (!active || paused || !pulse.current) return;
    const progress = (clock.elapsedTime * 0.34) % 1;
    pulse.current.position.copy(curve.getPointAt(reverse ? 1 - progress : progress));
  });

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={active ? "#ff9d35" : "#52260d"} transparent opacity={active ? 0.76 : 0.2} blending={THREE.AdditiveBlending} />
      </mesh>
      {active ? (
        <mesh ref={pulse}>
          <sphereGeometry args={[0.075, 12, 12]} />
          <meshBasicMaterial color="#fff1d0" toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ) : null}
    </group>
  );
}

function CommandModule({ entity, selected, active, muted, metalTexture, onSelect, onEnter, onNavigate }: {
  entity: GalaxyEntity;
  selected: boolean;
  active: boolean;
  muted: boolean;
  metalTexture: THREE.Texture;
  onSelect: (entity: GalaxyEntity) => void;
  onEnter: (entity: GalaxyEntity) => void;
  onNavigate: NavigateOrchestrator;
}) {
  const animated = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const texture = useTexture(entityLogoUrl(entity.type, entity.slug));
  const node = NODE_BY_ID.get(entity.id)!;
  const scale = entity.slug === "atlas" ? 1.15 : entity.type === "product" ? 0.98 : entity.type === "capability" ? 0.76 : node.layer === 4 ? 0.9 : node.layer === 5 ? 0.76 : 0.68;
  const opacity = muted ? 0.24 : active ? 1 : 0.62;
  const descriptor = entity.role ?? entity.label ?? entity.content?.eyebrow ?? entity.tagline ?? entity.type;

  useFrame(({ clock }, delta) => {
    if (animated.current) {
      const target = selected ? 1.18 : hovered ? 1.08 : 1;
      animated.current.scale.setScalar(THREE.MathUtils.damp(animated.current.scale.x, target, 5, delta));
      animated.current.rotation.y += delta * (active ? 0.16 : 0.04);
    }
    if (halo.current) halo.current.rotation.z = clock.elapsedTime * 0.3;
  });

  return (
    <group position={modulePosition(node)} scale={scale}>
      <group ref={animated}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.6, 0.34, 32]} />
          <meshPhysicalMaterial color={active ? "#111518" : "#20262a"} emissive={active ? "#21140b" : "#000000"} emissiveIntensity={active ? 0.52 : 0} metalness={0.98} roughness={0.17} roughnessMap={metalTexture} clearcoat={0.65} clearcoatRoughness={0.18} envMapIntensity={1.8} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, -0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.48, 0.045, 8, 64]} />
          <meshPhysicalMaterial color="#929ba1" metalness={1} roughness={0.1} roughnessMap={metalTexture} clearcoat={0.8} envMapIntensity={2.2} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.29, 0]} castShadow>
          <cylinderGeometry args={[0.31, 0.42, 0.12, 12]} />
          <meshPhysicalMaterial color={active ? "#3c3025" : "#42494e"} metalness={1} roughness={0.16} roughnessMap={metalTexture} clearcoat={0.55} envMapIntensity={1.9} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.19, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.46, 0.055, 8, 64]} />
          <meshStandardMaterial color={selected ? "#e6ebee" : active ? "#9b815f" : "#62696e"} emissive={active ? "#824016" : "#000000"} emissiveIntensity={selected ? 1.4 : active ? 0.52 : 0} metalness={0.96} roughness={0.17} transparent opacity={opacity} />
        </mesh>
        {[0, 1, 2].map((index) => (
          <mesh key={index} position={[Math.cos(index * 2.094) * 0.55, 0.02, Math.sin(index * 2.094) * 0.55]} rotation={[0, -index * 2.094, 0]} castShadow>
            <boxGeometry args={[0.22, 0.18, 0.34]} />
            <meshStandardMaterial color={active ? "#292d30" : "#4b5156"} metalness={0.92} roughness={0.3} transparent opacity={opacity} />
          </mesh>
        ))}
        {[0, 1, 2, 3].map((index) => {
          const angle = index * Math.PI / 2;
          return (
            <group key={`armor-${index}`} position={[Math.cos(angle) * 0.57, -0.08, Math.sin(angle) * 0.57]} rotation={[0, -angle, 0]}>
              <mesh castShadow>
                <boxGeometry args={[0.2, 0.11, 0.2]} />
                <meshPhysicalMaterial color="#687178" metalness={1} roughness={0.12} roughnessMap={metalTexture} clearcoat={0.75} envMapIntensity={2.1} transparent opacity={opacity} />
              </mesh>
              <mesh position={[0, 0.065, 0.02]}>
                <boxGeometry args={[0.09, 0.018, 0.12]} />
                <meshBasicMaterial color={active ? "#e78632" : "#76513a"} transparent opacity={opacity} toneMapped={false} />
              </mesh>
            </group>
          );
        })}
        <mesh position={[0, 0.48, 0]}>
          <cylinderGeometry args={[0.025, 0.04, 0.42, 8]} />
          <meshStandardMaterial color="#bfc5c9" metalness={1} roughness={0.14} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.73, 0]}>
          <sphereGeometry args={[0.045, 10, 10]} />
          <meshBasicMaterial color={active ? "#ffb660" : "#4d3325"} toneMapped={false} transparent opacity={opacity} />
        </mesh>
      </group>

      <Billboard position={[0, 0.35, 0]}>
        <mesh position={[0, 0, -0.07]}>
          <circleGeometry args={[0.47, 48]} />
          <meshPhysicalMaterial color="#090c0e" metalness={0.96} roughness={0.2} roughnessMap={metalTexture} clearcoat={0.55} envMapIntensity={1.7} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0, -0.055]}>
          <ringGeometry args={[0.47, 0.53, 48]} />
          <meshPhysicalMaterial color={selected ? "#f2d4a7" : active ? "#b77a40" : "#7f8990"} metalness={1} roughness={0.12} roughnessMap={metalTexture} clearcoat={0.8} envMapIntensity={2.2} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0, -0.04]}>
          <ringGeometry args={[0.37, 0.39, 48]} />
          <meshBasicMaterial color={active ? "#e88634" : "#657078"} transparent opacity={opacity * 0.9} toneMapped={false} />
        </mesh>
        <mesh>
          <planeGeometry args={[0.58, 0.58]} />
          <meshBasicMaterial map={texture} color={selected ? "#ffffff" : active ? "#d7c3a6" : "#b7bdc1"} transparent alphaTest={0.02} opacity={opacity} depthWrite={false} toneMapped={false} />
        </mesh>
        {selected ? (
          <mesh ref={halo} position={[0, 0, -0.03]}>
            <ringGeometry args={[0.6, 0.68, 6]} />
            <meshBasicMaterial color="#ff9a31" transparent opacity={0.68} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        ) : null}
      </Billboard>

      <mesh
        visible={false}
        onClick={(event) => { event.stopPropagation(); if (event.delta <= 8) { onSelect(entity); onEnter(entity); } }}
        onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
      >
        <sphereGeometry args={[0.8, 12, 12]} /><meshBasicMaterial />
      </mesh>

      <Html center position={[0, -0.6, 0.3]} distanceFactor={11} zIndexRange={[20, 0]}>
        <button
          id={`entity-control-${entity.id.replaceAll(".", "-")}`}
          type="button"
          tabIndex={selected ? 0 : -1}
          aria-pressed={selected}
          aria-label={`Enter ${entity.name}, ${descriptor}`}
          onFocus={() => onSelect(entity)}
          onKeyDown={(event) => handleTab(event, entity, onNavigate)}
          onClick={(event) => { event.stopPropagation(); onSelect(entity); onEnter(entity); }}
          className="flex min-w-[80px] flex-col items-center whitespace-nowrap rounded-md px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-[#ffc267] focus-visible:shadow-[0_0_20px_rgba(255,135,40,0.7)]"
          style={{ opacity }}
        >
          <span className={`font-mono text-[0.55rem] tracking-[0.23em] ${selected ? "text-[#ffd799]" : "text-[#a87a50]"}`}>{descriptor}</span>
          <span className={`mt-0.5 text-[0.62rem] font-medium tracking-[0.15em] uppercase ${selected ? "text-white" : "text-[#ddc1a2]"}`}>{entity.name}</span>
        </button>
      </Html>
      {selected ? <pointLight color="#ff7917" intensity={5} distance={3.5} decay={2} position={[0, 0.5, 0]} /> : null}
    </group>
  );
}

function CivilizationPerimeter({ organizations, organizationKey, onOrganizationSelect, muted, metalTexture }: {
  organizations: AccessibleOrganizationOption[];
  organizationKey: string | null;
  onOrganizationSelect: (key: string) => void;
  muted: boolean;
  metalTexture: THREE.Texture;
}) {
  const radius = LAYER_RADII[7];
  return (
    <group position={[0, LAYER_HEIGHTS[7], 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.22, 10, 220]} />
        <meshPhysicalMaterial color="#171c20" metalness={0.99} roughness={0.18} roughnessMap={metalTexture} clearcoat={0.55} clearcoatRoughness={0.2} envMapIntensity={1.8} />
      </mesh>
      <mesh position={[0, -0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.27, 6, 220]} />
        <meshPhysicalMaterial color="#343b40" metalness={1} roughness={0.14} roughnessMap={metalTexture} clearcoat={0.6} envMapIntensity={2} side={THREE.BackSide} />
      </mesh>
      <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.018, 5, 220]} />
        <meshBasicMaterial color="#b05c22" transparent opacity={muted ? 0.16 : 0.48} />
      </mesh>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2;
        const major = index % 3 === 0;
        return (
          <group key={`dock-${index}`} position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]} rotation={[0, -angle, 0]}>
            <mesh castShadow>
              <boxGeometry args={[major ? 1.25 : 0.62, major ? 0.72 : 0.38, major ? 0.9 : 0.5]} />
              <meshStandardMaterial color={major ? "#202529" : "#111518"} metalness={0.96} roughness={0.3} />
            </mesh>
            {major ? (
              <>
                <mesh position={[0, 0.62, 0]} castShadow>
                  <cylinderGeometry args={[0.16, 0.3, 0.78, 10]} />
                  <meshStandardMaterial color="#555d63" metalness={1} roughness={0.2} />
                </mesh>
                <mesh position={[0, 1.08, 0]}>
                  <sphereGeometry args={[0.07, 12, 12]} />
                  <meshBasicMaterial color="#f2d6af" toneMapped={false} />
                </mesh>
                <mesh position={[0, -0.1, 0.86]} castShadow>
                  <boxGeometry args={[0.18, 0.16, 0.9]} />
                  <meshStandardMaterial color="#343a3f" metalness={0.95} roughness={0.28} />
                </mesh>
              </>
            ) : null}
          </group>
        );
      })}

      {organizations.map((organization, index) => {
        const angle = Math.PI + (index - (organizations.length - 1) / 2) * 0.18;
        const selected = organization.key === organizationKey;
        return (
          <group key={organization.key} position={[Math.cos(angle) * (radius + 0.65), 0.5, Math.sin(angle) * (radius + 0.65)]}>
            <mesh>
              <cylinderGeometry args={[selected ? 0.26 : 0.2, selected ? 0.3 : 0.23, 0.28, 8]} />
              <meshStandardMaterial color={selected ? "#e3e8eb" : "#303438"} emissive={selected ? "#8f4214" : "#000000"} emissiveIntensity={selected ? 1.1 : 0} metalness={0.9} roughness={0.24} />
            </mesh>
            <mesh position={[0, 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[selected ? 0.3 : 0.25, 0.025, 6, 32]} />
              <meshBasicMaterial color={selected ? "#e3c39d" : "#545b60"} />
            </mesh>
            {!muted ? (
              <Html center position={[0, 0.42, 0]} distanceFactor={12}>
                <button type="button" onClick={() => onOrganizationSelect(organization.key)} className={`whitespace-nowrap font-mono text-[0.5rem] tracking-[0.16em] uppercase ${selected ? "text-[#ffd19a]" : "text-silver-500"}`}>
                  {organization.name}
                </button>
              </Html>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

function EnvironmentActivity({ paused, muted }: { paused: boolean; muted: boolean }) {
  const dust = useRef<THREE.Points>(null);
  const drones = useRef<THREE.Group>(null);
  const dustPositions = useMemo(() => {
    const values = new Float32Array(700 * 3);
    for (let index = 0; index < 700; index += 1) {
      const angle = index * 2.39996;
      const radius = 5 + ((index * 47) % 100) / 5;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = (((index * 31) % 100) / 100 - 0.5) * 14;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, []);

  useFrame(({ clock }, delta) => {
    if (paused) return;
    if (dust.current) dust.current.rotation.y += delta * 0.0015;
    if (drones.current) drones.current.rotation.y = clock.elapsedTime * 0.035;
  });

  return (
    <group>
      <points ref={dust}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[dustPositions, 3]} /></bufferGeometry>
        <pointsMaterial color="#9b6a45" size={0.026} transparent opacity={muted ? 0.12 : 0.34} sizeAttenuation depthWrite={false} />
      </points>
      <group ref={drones}>
        {[0, 1, 2, 3, 4].map((index) => {
          const angle = index * 1.256;
          const radius = 7.8 + (index % 2) * 1.3;
          return (
            <group key={index} position={[Math.cos(angle) * radius, 1.2 + index * 0.18, Math.sin(angle) * radius]} rotation={[0, -angle, 0]}>
              <mesh><coneGeometry args={[0.08, 0.32, 5]} /><meshStandardMaterial color="#aeb6bc" metalness={1} roughness={0.2} /></mesh>
              <pointLight color="#ff8124" intensity={0.7} distance={1.5} />
            </group>
          );
        })}
      </group>
    </group>
  );
}

function CameraRig({ selectedId, paused }: { selectedId: string; paused: boolean }) {
  const camera = useThree((state) => state.camera);
  const pointer = useThree((state) => state.pointer);
  const cameraRef = useRef(camera);
  const distance = useRef(27.5);
  const lookTarget = useRef(new THREE.Vector3(0, LAYER_HEIGHTS[0], 0));
  const selectedNode = NODE_BY_ID.get(selectedId) ?? NODE_BY_ID.get(CORE.id)!;

  useEffect(() => {
    distance.current = selectedNode.layer === 0 ? 26 : 27.5 - selectedNode.layer * 0.18;
  }, [selectedNode.layer]);

  useFrame(({ clock }, delta) => {
    const current = cameraRef.current;
    const desiredZ = distance.current;
    const driftX = paused ? 0 : Math.sin(clock.elapsedTime * 0.17) * 0.09;
    const driftY = paused ? 0 : Math.cos(clock.elapsedTime * 0.13) * 0.07;
    current.position.z = THREE.MathUtils.damp(current.position.z, desiredZ, 2.2, delta);
    current.position.y = THREE.MathUtils.damp(current.position.y, desiredZ * 0.52 + pointer.y * 0.35 + driftY, 1.8, delta);
    current.position.x = THREE.MathUtils.damp(current.position.x, pointer.x * 0.65 + driftX, 1.8, delta);
    lookTarget.current.y = THREE.MathUtils.damp(lookTarget.current.y, selectedNode.layer === 0 ? LAYER_HEIGHTS[0] : 0, 2, delta);
    lookTarget.current.z = THREE.MathUtils.damp(lookTarget.current.z, selectedNode.layer === 0 ? 0 : 1.1, 2, delta);
    current.lookAt(lookTarget.current);
  });
  return null;
}

function WheelNavigation({ selectedId, onNavigate }: { selectedId: string; onNavigate: NavigateOrchestrator }) {
  const gl = useThree((state) => state.gl);
  const lastNavigation = useRef(0);

  useEffect(() => {
    const element = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const now = performance.now();
      if (Math.abs(event.deltaY) < 4 || now - lastNavigation.current < 220) return;
      lastNavigation.current = now;
      const entity = NODE_BY_ID.get(selectedId)?.entity ?? CORE;
      onNavigate(entity, event.deltaY > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [gl, onNavigate, selectedId]);

  return null;
}

function LivingStation({ selectedId, paused, muted, delegation, organizations, organizationKey, onOrganizationSelect, onSelect, onEnter, onNavigate }: {
  selectedId: string;
  paused: boolean;
  muted: boolean;
  delegation: BeaconToolActivity | null;
  organizations: AccessibleOrganizationOption[];
  organizationKey: string | null;
  onOrganizationSelect: (key: string) => void;
  onSelect: (entity: GalaxyEntity) => void;
  onEnter: (entity: GalaxyEntity) => void;
  onNavigate: NavigateOrchestrator;
}) {
  const station = useRef<THREE.Group>(null);
  const gl = useThree((state) => state.gl);
  const xRotationTarget = useRef(0);
  const yRotationTarget = useRef(0);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const angularVelocity = useRef(new THREE.Vector2());
  const metalTexture = useBrushedMetalTexture();
  const branch = useMemo(() => activeBranch(selectedId), [selectedId]);
  const delegatedSlug = delegation?.agent.slug.split(".").at(-1) ?? null;
  const selectedNode = NODE_BY_ID.get(selectedId) ?? NODE_BY_ID.get(CORE.id)!;
  const delegatedNode = delegatedSlug ? NODE_BY_SLUG.get(delegatedSlug) : null;

  useEffect(() => {
    const node = NODE_BY_ID.get(selectedId);
    if (!node || !station.current) return;
    const angle = THREE.MathUtils.degToRad(NODE_ANGLES[node.entity.slug] ?? 0);
    if (node.layer > 0 && node.layer % 2 === 0) {
      const desired = Math.PI / 2 - angle;
      const current = station.current.rotation.x;
      xRotationTarget.current = current + Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
      yRotationTarget.current = 0;
    } else {
      const desired = node.layer === 0 ? 0 : angle - Math.PI / 2;
      const current = station.current.rotation.y;
      yRotationTarget.current = current + Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
      xRotationTarget.current = 0;
    }
    if (paused) {
      station.current.rotation.x = xRotationTarget.current;
      station.current.rotation.y = yRotationTarget.current;
    }
  }, [paused, selectedId]);

  useEffect(() => {
    const element = gl.domElement;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - current.x;
      const deltaY = event.clientY - current.y;
      current.x = event.clientX;
      current.y = event.clientY;
      yRotationTarget.current += deltaX * 0.006;
      xRotationTarget.current = THREE.MathUtils.clamp(xRotationTarget.current + deltaY * 0.006, -1.2, 1.2);
      angularVelocity.current.set(deltaY * 0.0018, deltaX * 0.0018);
      if (paused && station.current) {
        station.current.rotation.x = xRotationTarget.current;
        station.current.rotation.y = yRotationTarget.current;
      }
    };
    const stopDragging = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", stopDragging);
    element.addEventListener("pointercancel", stopDragging);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", stopDragging);
      element.removeEventListener("pointercancel", stopDragging);
    };
  }, [gl, paused]);

  useFrame((_, delta) => {
    if (!paused && station.current) {
      if (!drag.current) {
        yRotationTarget.current += angularVelocity.current.y * delta * 60;
        xRotationTarget.current = THREE.MathUtils.clamp(xRotationTarget.current + angularVelocity.current.x * delta * 60, -1.2, 1.2);
        angularVelocity.current.x = THREE.MathUtils.damp(angularVelocity.current.x, 0, 2.1, delta);
        angularVelocity.current.y = THREE.MathUtils.damp(angularVelocity.current.y, 0, 2.1, delta);
      }
      station.current.rotation.x = THREE.MathUtils.damp(station.current.rotation.x, xRotationTarget.current, 2, delta);
      station.current.rotation.y = THREE.MathUtils.damp(station.current.rotation.y, yRotationTarget.current, 2, delta);
    }
  });

  return (
    <group>
      <EnvironmentActivity paused={paused} muted={muted} />
      <group ref={station}>
        {[1, 2, 3, 4, 5, 6].map((layer) => (
          <EngineeredRing
            key={layer}
            radius={LAYER_RADII[layer]}
            layer={layer}
            paused={paused}
            active={!muted && [...branch].some((id) => NODE_BY_ID.get(id)?.layer === layer)}
            metalTexture={metalTexture}
          />
        ))}

        {STATION_NODES.map((node) => {
          if (!node.parentId) return null;
          const parent = NODE_BY_ID.get(node.parentId);
          if (!parent) return null;
          return <EnergyConduit key={`${parent.entity.id}:${node.entity.id}`} from={modulePosition(parent)} to={modulePosition(node)} active={branch.has(parent.entity.id) && branch.has(node.entity.id) && !muted} paused={paused} />;
        })}

        {delegatedNode && delegatedNode.entity.id !== selectedId ? (
          <EnergyConduit
            from={modulePosition(selectedNode)}
            to={modulePosition(delegatedNode)}
            active
            paused={paused}
            reverse={delegation?.phase === "completed"}
          />
        ) : null}

        <group position={[0, LAYER_HEIGHTS[0], 0]}>
          <NexusBrainCore
            selected={selectedId === CORE.id}
            active={branch.has(CORE.id)}
            paused={paused}
            onSelect={() => onSelect(CORE)}
            onEnter={() => onEnter(CORE)}
            onKeyDown={(event) => handleTab(event, CORE, onNavigate)}
          />
        </group>
        {STATION_NODES.filter((node) => node.entity.id !== CORE.id).map(({ entity }) => (
          <CommandModule key={entity.id} entity={entity} selected={entity.id === selectedId} active={branch.has(entity.id)} muted={muted} metalTexture={metalTexture} onSelect={onSelect} onEnter={onEnter} onNavigate={onNavigate} />
        ))}
        <CivilizationPerimeter organizations={organizations} organizationKey={organizationKey} onOrganizationSelect={onOrganizationSelect} muted={muted} metalTexture={metalTexture} />
      </group>
    </group>
  );
}

interface OrchestratorHierarchyProps {
  selectedId: string;
  onSelect: (entity: GalaxyEntity) => void;
  onEnter: (entity: GalaxyEntity) => void;
  organizations: AccessibleOrganizationOption[];
  organizationKey: string | null;
  onOrganizationSelect: (key: string) => void;
  delegation: BeaconToolActivity | null;
  muted: boolean;
}

export default function OrchestratorHierarchy(props: OrchestratorHierarchyProps) {
  const paused = Boolean(useReducedMotion());

  function navigate(entity: GalaxyEntity, direction: 1 | -1) {
    const currentIndex = TAB_ORDER.findIndex((candidate) => candidate.entity.id === entity.id);
    const next = TAB_ORDER[(currentIndex + direction + TAB_ORDER.length) % TAB_ORDER.length];
    props.onSelect(next.entity);
    window.requestAnimationFrame(() => document.getElementById(`entity-control-${next.entity.id.replaceAll(".", "-")}`)?.focus());
  }

  return (
    <div className={`relative h-full min-h-[560px] w-full cursor-grab overflow-hidden transition-opacity duration-700 active:cursor-grabbing ${props.muted ? "pointer-events-none opacity-25" : "opacity-100"}`} aria-label="Nexus command station">
      <Canvas dpr={[1, 1.35]} shadows camera={{ position: [0, 14.2, 27.5], fov: 42, near: 0.1, far: 140 }} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} className="!absolute !inset-0">
        <CameraRig selectedId={props.selectedId} paused={paused} />
        <WheelNavigation selectedId={props.selectedId} onNavigate={navigate} />
        <Environment resolution={128}>
          <Lightformer form="rect" color="#fff7eb" intensity={3.4} scale={[14, 2, 1]} position={[0, 9, 4]} rotation={[-0.55, 0, 0]} />
          <Lightformer form="rect" color="#91a8bd" intensity={2.2} scale={[5, 10, 1]} position={[-10, 2, 2]} rotation={[0, Math.PI / 2, 0]} />
          <Lightformer form="ring" color="#d86b22" intensity={2.8} scale={5} position={[8, -2, -6]} rotation={[0, -0.7, 0]} />
        </Environment>
        <ambientLight intensity={0.22} color="#5d4637" />
        <directionalLight castShadow position={[7, 13, 9]} intensity={1.55} color="#f2f4f5" shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-9, 5, -7]} intensity={0.7} color="#9ea9b2" />
        <LivingStation {...props} paused={paused} onNavigate={navigate} />
      </Canvas>
      {!props.muted ? (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 text-center">
          <p className="font-mono text-[0.48rem] tracking-[0.34em] text-[#9b6842] uppercase">Nexus Intelligence Civilization</p>
          <p className="mt-1 font-mono text-[0.44rem] tracking-[0.16em] text-[#73533d] uppercase">Drag to rotate / Scroll or Tab to navigate / Click to enter</p>
        </div>
      ) : null}
    </div>
  );
}
