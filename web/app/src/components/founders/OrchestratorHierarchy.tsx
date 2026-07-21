"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Billboard, Environment, Html, Lightformer, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoUrl } from "@/lib/three/entity-logo";
import NexusBrainCore from "./NexusBrainCore";

const ORCHESTRATORS = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const CORE = VORINTHEX_GALAXY_REGISTRY.products.core;
const ATLAS = VORINTHEX_GALAXY_REGISTRY.orchestrators.atlas;
const CAPABILITIES = (CORE.children ?? [])
  .map((id) => Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities).find((entity) => entity.id === id))
  .filter((entity): entity is GalaxyEntity => Boolean(entity));
const LAYER_RADII = [0, 2.7, 4.35, 5.75, 7.2, 8.75, 10.4];
const LAYER_HEIGHTS = [0.46, 0.32, 0.17, 0.02, -0.14, -0.3, -0.46];
const X_AXIS_ORBIT_LAYERS = [2, 4, 6];
const Y_AXIS_ORBIT_LAYERS = [1, 3, 5];
const ORBIT_SPEED_BASE = 0.06;
const ORBIT_SPEED_STEP = 0.027;
const ENTITY_SPIN_BASE = 0.16;
const ENTITY_SPIN_STEP = 0.045;
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
  { entity: VORINTHEX_GALAXY_REGISTRY.products.hq, layer: 2, parentId: CORE.id! },
  { entity: VORINTHEX_GALAXY_REGISTRY.products.command, layer: 2, parentId: CORE.id! },
  { entity: VORINTHEX_GALAXY_REGISTRY.products.launch, layer: 2, parentId: CORE.id! },
  { entity: VORINTHEX_GALAXY_REGISTRY.products.studio, layer: 2, parentId: CORE.id! },
  { entity: VORINTHEX_GALAXY_REGISTRY.products.replica, layer: 2, parentId: CORE.id! },
  { entity: VORINTHEX_GALAXY_REGISTRY.products.pilot, layer: 2, parentId: CORE.id! },
  { entity: ATLAS, layer: 3, parentId: CORE.id! },
  ...ORCHESTRATORS.filter((entity) => entity.slug !== "atlas").map((entity) => ({
    entity,
    layer: orchestratorDepth(entity) + 3,
    parentId: entity.reportsTo ?? undefined,
  })),
];
const NODE_BY_ID = new Map(STATION_NODES.map((node) => [node.entity.id, node]));
const NODE_BY_SLUG = new Map(STATION_NODES.map((node) => [node.entity.slug, node]));

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

function orbitPlaneRotation(layer: number): [number, number, number] {
  const xAxis = layer % 2 === 0;
  const family = xAxis ? X_AXIS_ORBIT_LAYERS : Y_AXIS_ORBIT_LAYERS;
  const familyIndex = family.indexOf(layer);
  const angle = familyIndex * Math.PI * 2 / family.length;
  return xAxis ? [0, angle, 0] : [angle, 0, 0];
}

function orbitSpeed(layer: number) {
  const direction = layer % 2 === 0 ? -1 : 1;
  return direction * (ORBIT_SPEED_BASE + layer * ORBIT_SPEED_STEP);
}

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

function OrbitLayer({ layer, paused, children }: { layer: number; paused: boolean; children: ReactNode }) {
  const orbit = useRef<THREE.Group>(null);
  const xAxis = layer % 2 === 0;
  const speed = orbitSpeed(layer);

  useFrame((_, delta) => {
    if (paused || !orbit.current) return;
    if (xAxis) orbit.current.rotation.x += delta * speed;
    else orbit.current.rotation.y += delta * speed;
  });

  return (
    <group rotation={orbitPlaneRotation(layer)}>
      <group ref={orbit}>{children}</group>
    </group>
  );
}

function EngineeredRing({ radius, layer, active, metalTexture }: { radius: number; layer: number; active: boolean; metalTexture: THREE.Texture }) {
  const segments = 26 + layer * 8;
  const segmentLength = (Math.PI * 2 * radius / segments) * 0.76;
  const height = LAYER_HEIGHTS[layer];
  const xAxis = layer % 2 === 0;
  const ringRotation: [number, number, number] = xAxis ? [0, Math.PI / 2, 0] : [Math.PI / 2, 0, 0];

  return (
    <group position={xAxis ? [height, 0, 0] : [0, height, 0]}>
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

function DynamicEnergyConduit({ fromId, toId, nodeObjects, active, paused, reverse = false }: {
  fromId: string;
  toId: string;
  nodeObjects: MutableRefObject<Map<string, THREE.Object3D>>;
  active: boolean;
  paused: boolean;
  reverse?: boolean;
}) {
  const segments = 24;
  const lineObject = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((segments + 1) * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color: active ? "#ff9d35" : "#6f3818",
      transparent: true,
      opacity: active ? 0.78 : 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    return line;
  }, [active]);
  const attribute = useRef<THREE.BufferAttribute | null>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const start = useRef(new THREE.Vector3());
  const end = useRef(new THREE.Vector3());
  const control = useRef(new THREE.Vector3());

  useEffect(() => {
    attribute.current = lineObject.geometry.getAttribute("position") as THREE.BufferAttribute;
    return () => {
      attribute.current = null;
      lineObject.geometry.dispose();
      lineObject.material.dispose();
    };
  }, [lineObject]);

  useFrame(({ clock }) => {
    const from = nodeObjects.current.get(fromId);
    const to = nodeObjects.current.get(toId);
    const positionAttribute = attribute.current;
    if (!from || !to || !positionAttribute) return;
    const positions = positionAttribute.array as Float32Array;
    from.getWorldPosition(start.current);
    to.getWorldPosition(end.current);
    control.current.copy(start.current).lerp(end.current, 0.5);
    control.current.y += 0.25 + start.current.distanceTo(end.current) * 0.035;

    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments;
      const inverse = 1 - progress;
      const offset = index * 3;
      positions[offset] = inverse * inverse * start.current.x + 2 * inverse * progress * control.current.x + progress * progress * end.current.x;
      positions[offset + 1] = inverse * inverse * start.current.y + 2 * inverse * progress * control.current.y + progress * progress * end.current.y;
      positions[offset + 2] = inverse * inverse * start.current.z + 2 * inverse * progress * control.current.z + progress * progress * end.current.z;
    }
    positionAttribute.needsUpdate = true;

    if (active && !paused && pulse.current) {
      const rawProgress = (clock.elapsedTime * 0.34) % 1;
      const progress = reverse ? 1 - rawProgress : rawProgress;
      const inverse = 1 - progress;
      pulse.current.position.set(
        inverse * inverse * start.current.x + 2 * inverse * progress * control.current.x + progress * progress * end.current.x,
        inverse * inverse * start.current.y + 2 * inverse * progress * control.current.y + progress * progress * end.current.y,
        inverse * inverse * start.current.z + 2 * inverse * progress * control.current.z + progress * progress * end.current.z,
      );
    }
  });

  return (
    <group>
      <primitive object={lineObject} />
      {active ? (
        <mesh ref={pulse}>
          <sphereGeometry args={[0.07, 10, 10]} />
          <meshBasicMaterial color="#fff1d0" toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ) : null}
    </group>
  );
}

function CommandModule({ entity, selected, active, muted, metalTexture, nodeObjects, onSelect, onEnter }: {
  entity: GalaxyEntity;
  selected: boolean;
  active: boolean;
  muted: boolean;
  metalTexture: THREE.Texture;
  nodeObjects: MutableRefObject<Map<string, THREE.Object3D>>;
  onSelect: (entity: GalaxyEntity) => void;
  onEnter: (entity: GalaxyEntity) => void;
}) {
  const animated = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const texture = useTexture(entityLogoUrl(entity.type, entity.slug));
  const node = NODE_BY_ID.get(entity.id)!;
  const scale = entity.slug === "atlas" ? 1.15 : entity.type === "product" ? 0.98 : entity.type === "capability" ? 0.76 : node.layer === 4 ? 0.9 : node.layer === 5 ? 0.76 : 0.68;
  const opacity = muted ? 0.28 : active ? 1 : 0.72;
  const descriptor = entity.role ?? entity.label ?? entity.content?.eyebrow ?? entity.tagline ?? entity.type;
  const spinDirection = [...entity.slug].reduce((total, character) => total + character.charCodeAt(0), 0) % 2 === 0 ? 1 : -1;
  const spinSpeed = ENTITY_SPIN_BASE + node.layer * ENTITY_SPIN_STEP;

  useFrame(({ clock }, delta) => {
    if (animated.current) {
      const target = selected ? 1.18 : hovered ? 1.08 : 1;
      animated.current.scale.setScalar(THREE.MathUtils.damp(animated.current.scale.x, target, 5, delta));
      animated.current.rotation.y += delta * spinDirection * spinSpeed;
    }
    if (halo.current) halo.current.rotation.z = clock.elapsedTime * 0.3;
  });

  return (
    <group
      ref={(object) => {
        if (object) nodeObjects.current.set(entity.id, object);
        else nodeObjects.current.delete(entity.id);
      }}
      position={modulePosition(node)}
      scale={scale}
    >
      <group ref={animated}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.6, 0.34, 32]} />
          <meshPhysicalMaterial color={active ? "#111518" : "#2a3136"} emissive={active ? "#21140b" : "#050708"} emissiveIntensity={active ? 0.52 : 0.16} metalness={0.98} roughness={0.17} roughnessMap={metalTexture} clearcoat={0.65} clearcoatRoughness={0.18} envMapIntensity={2} transparent opacity={opacity} />
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
          <meshBasicMaterial map={texture} color={selected ? "#ffffff" : active ? "#d7c3a6" : "#d3d9dd"} transparent alphaTest={0.02} opacity={opacity} depthWrite={false} toneMapped={false} />
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
          tabIndex={-1}
          aria-pressed={selected}
          aria-label={`Enter ${entity.name}, ${descriptor}`}
          onFocus={() => onSelect(entity)}
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

function EnvironmentActivity({ paused, muted }: { paused: boolean; muted: boolean }) {
  const dust = useRef<THREE.Points>(null);
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

  useFrame((_, delta) => {
    if (paused) return;
    if (dust.current) dust.current.rotation.y += delta * 0.0015;
  });

  return (
    <group>
      <points ref={dust}>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[dustPositions, 3]} /></bufferGeometry>
        <pointsMaterial color="#9b6a45" size={0.026} transparent opacity={muted ? 0.12 : 0.34} sizeAttenuation depthWrite={false} />
      </points>
    </group>
  );
}

function CameraRig({ selectedId, paused }: { selectedId: string; paused: boolean }) {
  const camera = useThree((state) => state.camera);
  const pointer = useThree((state) => state.pointer);
  const gl = useThree((state) => state.gl);
  const cameraRef = useRef(camera);
  const distance = useRef(27.5);
  const lookTarget = useRef(new THREE.Vector3(0, LAYER_HEIGHTS[0], 0));
  const selectedNode = NODE_BY_ID.get(selectedId) ?? NODE_BY_ID.get(CORE.id)!;

  useEffect(() => {
    distance.current = selectedNode.layer === 0 ? 26 : 27.5 - selectedNode.layer * 0.18;
  }, [selectedNode.layer]);

  useEffect(() => {
    const element = gl.domElement;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      distance.current = THREE.MathUtils.clamp(distance.current + event.deltaY * 0.009, 17, 38);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [gl]);

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

function LivingStation({ selectedId, paused, muted, onSelect, onEnter }: {
  selectedId: string;
  paused: boolean;
  muted: boolean;
  onSelect: (entity: GalaxyEntity) => void;
  onEnter: (entity: GalaxyEntity) => void;
}) {
  const station = useRef<THREE.Group>(null);
  const gl = useThree((state) => state.gl);
  const xRotationTarget = useRef(0);
  const yRotationTarget = useRef(0);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const angularVelocity = useRef(new THREE.Vector2());
  const nodeObjects = useRef(new Map<string, THREE.Object3D>());
  const metalTexture = useBrushedMetalTexture();
  const branch = useMemo(() => activeBranch(selectedId), [selectedId]);

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
      xRotationTarget.current += deltaY * 0.006;
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
        xRotationTarget.current += angularVelocity.current.x * delta * 60;
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
          <OrbitLayer key={layer} layer={layer} paused={paused}>
            <EngineeredRing
              radius={LAYER_RADII[layer]}
              layer={layer}
              active={!muted && [...branch].some((id) => NODE_BY_ID.get(id)?.layer === layer)}
              metalTexture={metalTexture}
            />
            {STATION_NODES.filter((node) => node.layer === layer).map(({ entity }) => (
              <CommandModule key={entity.id} entity={entity} selected={entity.id === selectedId} active={branch.has(entity.id)} muted={muted} metalTexture={metalTexture} nodeObjects={nodeObjects} onSelect={onSelect} onEnter={onEnter} />
            ))}
          </OrbitLayer>
        ))}

        <group
          ref={(object) => {
            if (object) nodeObjects.current.set(CORE.id, object);
            else nodeObjects.current.delete(CORE.id);
          }}
          position={[0, LAYER_HEIGHTS[0], 0]}
        >
          <NexusBrainCore
            selected={selectedId === CORE.id}
            active={branch.has(CORE.id)}
            paused={paused}
            onSelect={() => onSelect(CORE)}
            onEnter={() => onEnter(CORE)}
          />
        </group>
      </group>

      {STATION_NODES.map((node) => {
        if (!node.parentId || !NODE_BY_ID.has(node.parentId)) return null;
        return (
          <DynamicEnergyConduit
            key={`${node.parentId}:${node.entity.id}`}
            fromId={node.parentId}
            toId={node.entity.id}
            nodeObjects={nodeObjects}
            active={branch.has(node.parentId) && branch.has(node.entity.id) && !muted}
            paused={paused}
          />
        );
      })}
    </group>
  );
}

interface OrchestratorHierarchyProps {
  selectedId: string;
  onSelect: (entity: GalaxyEntity) => void;
  onEnter: (entity: GalaxyEntity) => void;
  muted: boolean;
}

export default function OrchestratorHierarchy(props: OrchestratorHierarchyProps) {
  const paused = Boolean(useReducedMotion());

  return (
    <div className={`relative h-full min-h-[560px] w-full cursor-grab overflow-hidden transition-opacity duration-700 active:cursor-grabbing ${props.muted ? "pointer-events-none opacity-25" : "opacity-100"}`} aria-label="Nexus command station">
      <Canvas dpr={[1, 1.35]} shadows camera={{ position: [0, 14.2, 27.5], fov: 42, near: 0.1, far: 140 }} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} className="!absolute !inset-0">
        <CameraRig selectedId={props.selectedId} paused={paused} />
        <Environment resolution={128}>
          <Lightformer form="rect" color="#fff7eb" intensity={3.4} scale={[14, 2, 1]} position={[0, 9, 4]} rotation={[-0.55, 0, 0]} />
          <Lightformer form="rect" color="#91a8bd" intensity={2.2} scale={[5, 10, 1]} position={[-10, 2, 2]} rotation={[0, Math.PI / 2, 0]} />
          <Lightformer form="ring" color="#d86b22" intensity={2.8} scale={5} position={[8, -2, -6]} rotation={[0, -0.7, 0]} />
        </Environment>
        <ambientLight intensity={0.22} color="#5d4637" />
        <directionalLight castShadow position={[7, 13, 9]} intensity={1.55} color="#f2f4f5" shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-9, 5, -7]} intensity={0.7} color="#9ea9b2" />
        <LivingStation {...props} paused={paused} />
      </Canvas>
    </div>
  );
}
