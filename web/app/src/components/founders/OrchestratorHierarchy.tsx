"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Billboard, Html, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import type { AccessibleOrganizationOption, AccessibleScopeOption, BeaconToolActivity } from "@/lib/founders/types";

const ORCHESTRATORS = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const ATLAS = VORINTHEX_GALAXY_REGISTRY.orchestrators.atlas;
const BY_ID = new Map(ORCHESTRATORS.map((entity) => [entity.id, entity]));
const LAYER_RADII = [0, 3.05, 5.35, 7.55, 9.35];
const LAYER_HEIGHTS = [0.46, 0.24, -0.08, -0.42, -0.72];
const NODE_ANGLES: Record<string, number> = {
  atlas: 90,
  metis: -90, hermes: -150, phoenix: -30, athena: 30, ledger: 90, sentinel: 150,
  echo: -105, matrix: -75, harmony: -150, iris: -30, forge: 15, helios: 45, mercury: 90, themis: 150,
  orbit: -42, apollo: -18, aura: 5, pillar: 24, vulcan: 45,
};

function depthFor(entity: GalaxyEntity) {
  let depth = 0;
  let current = entity;
  while (current.reportsTo) {
    const parent = BY_ID.get(current.reportsTo);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

const TAB_ORDER = [...ORCHESTRATORS].sort(
  (left, right) => depthFor(left) - depthFor(right) || (NODE_ANGLES[left.slug] ?? 0) - (NODE_ANGLES[right.slug] ?? 0),
);

function modulePosition(entity: GalaxyEntity): [number, number, number] {
  if (entity.slug === "atlas") return [0, LAYER_HEIGHTS[0], 0];
  const layer = depthFor(entity);
  const radius = LAYER_RADII[layer];
  const angle = THREE.MathUtils.degToRad(NODE_ANGLES[entity.slug] ?? 0);
  return layer === 2
    ? [LAYER_HEIGHTS[layer], Math.cos(angle) * radius, Math.sin(angle) * radius]
    : [Math.cos(angle) * radius, LAYER_HEIGHTS[layer], Math.sin(angle) * radius];
}

function activeBranch(selectedSlug: string) {
  const active = new Set<string>([selectedSlug]);
  let current = VORINTHEX_GALAXY_REGISTRY.orchestrators[selectedSlug];
  while (current?.reportsTo) {
    const parent = BY_ID.get(current.reportsTo);
    if (!parent) break;
    active.add(parent.slug);
    current = parent;
  }
  return active;
}

type NavigateOrchestrator = (entity: GalaxyEntity, direction: 1 | -1) => void;

function handleTab(event: KeyboardEvent<HTMLButtonElement>, entity: GalaxyEntity, onNavigate: NavigateOrchestrator) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  onNavigate(entity, event.shiftKey ? -1 : 1);
}

function EngineeredRing({ radius, layer, paused, active }: { radius: number; layer: number; paused: boolean; active: boolean }) {
  const rotation = useRef<THREE.Group>(null);
  const segments = 26 + layer * 8;
  const height = LAYER_HEIGHTS[layer];
  const xAxis = layer === 2;
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
          <meshStandardMaterial
            color={index === 1 ? "#14171a" : "#5d6267"}
            emissive={active && index === 1 ? "#592207" : "#000000"}
            emissiveIntensity={active ? 0.7 : 0}
            metalness={0.96}
            roughness={index === 1 ? 0.3 : 0.18}
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
              <boxGeometry args={[major ? 0.62 : 0.32, major ? 0.44 : 0.24, major ? 0.48 : 0.3]} />
              <meshStandardMaterial color={major ? "#24282b" : "#111416"} metalness={0.92} roughness={0.36} />
            </mesh>
            {major ? (
              <>
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
            <mesh position={[0, 0.17, 0.18]}>
              <boxGeometry args={[0.045, 0.03, 0.035]} />
              <meshBasicMaterial color={active ? "#ff9d39" : "#67300f"} toneMapped={false} />
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

function CommandModule({ entity, selected, active, muted, onSelect, onNavigate }: {
  entity: GalaxyEntity;
  selected: boolean;
  active: boolean;
  muted: boolean;
  onSelect: (entity: GalaxyEntity) => void;
  onNavigate: NavigateOrchestrator;
}) {
  const animated = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const texture = useTexture(entity.logo.src);
  const depth = depthFor(entity);
  const scale = depth === 0 ? 1.65 : depth === 1 ? 0.92 : depth === 2 ? 0.78 : 0.7;
  const opacity = muted ? 0.24 : active ? 1 : 0.28;

  useFrame(({ clock }, delta) => {
    if (animated.current) {
      const target = selected ? 1.18 : hovered ? 1.08 : 1;
      animated.current.scale.setScalar(THREE.MathUtils.damp(animated.current.scale.x, target, 5, delta));
      animated.current.rotation.y += delta * (active ? 0.16 : 0.04);
    }
    if (halo.current) halo.current.rotation.z = clock.elapsedTime * 0.3;
  });

  return (
    <group position={modulePosition(entity)} scale={scale}>
      <group ref={animated}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.6, 0.34, 32]} />
          <meshStandardMaterial color="#0b0e10" emissive={active ? "#21140b" : "#000000"} emissiveIntensity={active ? 0.52 : 0} metalness={0.97} roughness={0.22} transparent opacity={opacity} />
        </mesh>
        <mesh position={[0, 0.19, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.46, 0.055, 8, 64]} />
          <meshStandardMaterial color={selected ? "#e6ebee" : active ? "#9b815f" : "#32373b"} emissive={active ? "#824016" : "#000000"} emissiveIntensity={selected ? 1.4 : active ? 0.52 : 0} metalness={0.96} roughness={0.17} transparent opacity={opacity} />
        </mesh>
        {[0, 1, 2].map((index) => (
          <mesh key={index} position={[Math.cos(index * 2.094) * 0.55, 0.02, Math.sin(index * 2.094) * 0.55]} rotation={[0, -index * 2.094, 0]} castShadow>
            <boxGeometry args={[0.22, 0.18, 0.34]} />
            <meshStandardMaterial color="#292d30" metalness={0.92} roughness={0.3} transparent opacity={opacity} />
          </mesh>
        ))}
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
        <mesh>
          <planeGeometry args={[0.58, 0.58]} />
          <meshBasicMaterial map={texture} color={selected ? "#ffffff" : active ? "#d7c3a6" : "#777b7e"} transparent alphaTest={0.02} opacity={opacity} depthWrite={false} toneMapped={false} />
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
        onClick={(event) => { event.stopPropagation(); if (event.delta <= 8) onSelect(entity); }}
        onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
      >
        <sphereGeometry args={[0.8, 12, 12]} /><meshBasicMaterial />
      </mesh>

      <Html center position={[0, -0.6, 0.3]} distanceFactor={11} zIndexRange={[20, 0]}>
        <button
          id={`orchestrator-control-${entity.slug}`}
          type="button"
          tabIndex={selected ? 0 : -1}
          aria-pressed={selected}
          aria-label={`Chat with ${entity.name}, ${entity.role}`}
          onFocus={() => onSelect(entity)}
          onKeyDown={(event) => handleTab(event, entity, onNavigate)}
          onClick={(event) => { event.stopPropagation(); onSelect(entity); }}
          className="flex min-w-[80px] flex-col items-center whitespace-nowrap rounded-md px-2 py-1 outline-none focus-visible:ring-1 focus-visible:ring-[#ffc267] focus-visible:shadow-[0_0_20px_rgba(255,135,40,0.7)]"
          style={{ opacity }}
        >
          <span className={`font-mono text-[0.55rem] tracking-[0.23em] ${selected ? "text-[#ffd799]" : "text-[#a87a50]"}`}>{entity.role}</span>
          <span className={`mt-0.5 text-[0.62rem] font-medium tracking-[0.15em] uppercase ${selected ? "text-white" : "text-[#ddc1a2]"}`}>{entity.name}</span>
        </button>
      </Html>
      {selected ? <pointLight color="#ff7917" intensity={5} distance={3.5} decay={2} position={[0, 0.5, 0]} /> : null}
    </group>
  );
}

function CivilizationPerimeter({ organizations, organizationKey, onOrganizationSelect, scopes, scopeKey, onScopeSelect, muted }: {
  organizations: AccessibleOrganizationOption[];
  organizationKey: string | null;
  onOrganizationSelect: (key: string) => void;
  scopes: AccessibleScopeOption[];
  scopeKey: string | null;
  onScopeSelect: (key: string) => void;
  muted: boolean;
}) {
  const radius = LAYER_RADII[4];
  return (
    <group position={[0, LAYER_HEIGHTS[4], 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.22, 10, 220]} />
        <meshStandardMaterial color="#0e1113" metalness={0.97} roughness={0.28} />
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

      {scopes.slice(0, 12).map((scope, index) => {
        const angle = (index / Math.max(scopes.length, 1)) * Math.PI * 2;
        const selected = scope.key === scopeKey;
        return (
          <group key={scope.key} position={[Math.cos(angle) * radius, 0.32, Math.sin(angle) * radius]}>
            <mesh>
              <octahedronGeometry args={[selected ? 0.2 : 0.13, 0]} />
              <meshStandardMaterial color={selected ? "#e8f2eb" : "#333b37"} emissive={selected ? "#4eaf67" : "#000000"} emissiveIntensity={selected ? 1.4 : 0} metalness={0.7} roughness={0.3} />
            </mesh>
            {!muted ? (
              <Html center position={[0, 0.34, 0]} distanceFactor={12}>
                <button type="button" onClick={() => onScopeSelect(scope.key)} className={`whitespace-nowrap rounded-full border px-2 py-1 font-mono text-[0.48rem] tracking-[0.14em] uppercase ${selected ? "border-emerald-300/40 bg-emerald-950/60 text-emerald-100" : "border-white/10 bg-black/50 text-silver-400"}`}>
                  {scope.name}
                </button>
              </Html>
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

function CameraRig({ selectedSlug }: { selectedSlug: string }) {
  const camera = useThree((state) => state.camera);
  const pointer = useThree((state) => state.pointer);
  const gl = useThree((state) => state.gl);
  const cameraRef = useRef(camera);
  const distance = useRef(20.5);
  const selectedDepth = depthFor(VORINTHEX_GALAXY_REGISTRY.orchestrators[selectedSlug] ?? ATLAS);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      distance.current = THREE.MathUtils.clamp(distance.current + event.deltaY * 0.008, 12.5, 28);
    };
    const element = gl.domElement;
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [gl]);

  useEffect(() => {
    distance.current = selectedSlug === "atlas" ? 19.5 : 18 - selectedDepth * 0.45;
  }, [selectedDepth, selectedSlug]);

  useFrame((_, delta) => {
    const current = cameraRef.current;
    const desiredZ = distance.current;
    current.position.z = THREE.MathUtils.damp(current.position.z, desiredZ, 2.2, delta);
    current.position.y = THREE.MathUtils.damp(current.position.y, desiredZ * 0.52 + pointer.y * 0.35, 2.2, delta);
    current.position.x = THREE.MathUtils.damp(current.position.x, pointer.x * 0.65, 2.2, delta);
    current.lookAt(0, selectedSlug === "atlas" ? LAYER_HEIGHTS[0] : 0, selectedSlug === "atlas" ? 0 : 1.1);
  });
  return null;
}

function LivingStation({ selectedSlug, paused, muted, delegation, organizations, organizationKey, onOrganizationSelect, scopes, scopeKey, onScopeSelect, onSelect, onNavigate }: {
  selectedSlug: string;
  paused: boolean;
  muted: boolean;
  delegation: BeaconToolActivity | null;
  organizations: AccessibleOrganizationOption[];
  organizationKey: string | null;
  onOrganizationSelect: (key: string) => void;
  scopes: AccessibleScopeOption[];
  scopeKey: string | null;
  onScopeSelect: (key: string) => void;
  onSelect: (entity: GalaxyEntity) => void;
  onNavigate: NavigateOrchestrator;
}) {
  const station = useRef<THREE.Group>(null);
  const xRotationTarget = useRef(0);
  const yRotationTarget = useRef(0);
  const branch = useMemo(() => activeBranch(selectedSlug), [selectedSlug]);
  const delegatedSlug = delegation?.agent.slug.split(".").at(-1) ?? null;

  useEffect(() => {
    const entity = VORINTHEX_GALAXY_REGISTRY.orchestrators[selectedSlug];
    if (!entity || !station.current) return;
    const depth = depthFor(entity);
    const angle = THREE.MathUtils.degToRad(NODE_ANGLES[entity.slug] ?? 0);
    if (depth === 2) {
      const desired = Math.PI / 2 - angle;
      const current = station.current.rotation.x;
      xRotationTarget.current = current + Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
      yRotationTarget.current = 0;
    } else {
      const desired = entity.slug === "atlas" ? 0 : angle - Math.PI / 2;
      const current = station.current.rotation.y;
      yRotationTarget.current = current + Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
      xRotationTarget.current = 0;
    }
    if (paused) {
      station.current.rotation.x = xRotationTarget.current;
      station.current.rotation.y = yRotationTarget.current;
    }
  }, [paused, selectedSlug]);

  useFrame((_, delta) => {
    if (!paused && station.current) {
      station.current.rotation.x = THREE.MathUtils.damp(station.current.rotation.x, xRotationTarget.current, 2.4, delta);
      station.current.rotation.y = THREE.MathUtils.damp(station.current.rotation.y, yRotationTarget.current, 2.4, delta);
    }
  });

  return (
    <group>
      <EnvironmentActivity paused={paused} muted={muted} />
      <group ref={station}>
        {[1, 2, 3].map((layer) => (
          <EngineeredRing
            key={layer}
            radius={LAYER_RADII[layer]}
            layer={layer}
            paused={paused}
            active={!muted && [...branch].some((slug) => depthFor(VORINTHEX_GALAXY_REGISTRY.orchestrators[slug]) === layer)}
          />
        ))}

        {ORCHESTRATORS.map((entity) => {
          if (!entity.reportsTo) return null;
          const parent = BY_ID.get(entity.reportsTo);
          if (!parent) return null;
          return <EnergyConduit key={`${parent.id}:${entity.id}`} from={modulePosition(parent)} to={modulePosition(entity)} active={branch.has(parent.slug) && branch.has(entity.slug) && !muted} paused={paused} />;
        })}

        {delegatedSlug && VORINTHEX_GALAXY_REGISTRY.orchestrators[delegatedSlug] && delegatedSlug !== selectedSlug ? (
          <EnergyConduit
            from={modulePosition(VORINTHEX_GALAXY_REGISTRY.orchestrators[selectedSlug])}
            to={modulePosition(VORINTHEX_GALAXY_REGISTRY.orchestrators[delegatedSlug])}
            active
            paused={paused}
            reverse={delegation?.phase === "completed"}
          />
        ) : null}

        {ORCHESTRATORS.map((entity) => (
          <CommandModule key={entity.id} entity={entity} selected={entity.slug === selectedSlug} active={branch.has(entity.slug)} muted={muted} onSelect={onSelect} onNavigate={onNavigate} />
        ))}
        <CivilizationPerimeter organizations={organizations} organizationKey={organizationKey} onOrganizationSelect={onOrganizationSelect} scopes={scopes} scopeKey={scopeKey} onScopeSelect={onScopeSelect} muted={muted} />
      </group>
    </group>
  );
}

interface OrchestratorHierarchyProps {
  selectedSlug: string;
  onSelect: (orchestrator: GalaxyEntity) => void;
  organizations: AccessibleOrganizationOption[];
  organizationKey: string | null;
  onOrganizationSelect: (key: string) => void;
  scopes: AccessibleScopeOption[];
  scopeKey: string | null;
  onScopeSelect: (key: string) => void;
  delegation: BeaconToolActivity | null;
  muted: boolean;
}

export default function OrchestratorHierarchy(props: OrchestratorHierarchyProps) {
  const paused = Boolean(useReducedMotion());

  function navigate(entity: GalaxyEntity, direction: 1 | -1) {
    const currentIndex = TAB_ORDER.findIndex((candidate) => candidate.id === entity.id);
    const next = TAB_ORDER[(currentIndex + direction + TAB_ORDER.length) % TAB_ORDER.length];
    props.onSelect(next);
    window.requestAnimationFrame(() => document.getElementById(`orchestrator-control-${next.slug}`)?.focus());
  }

  return (
    <div className={`relative h-full min-h-[560px] w-full overflow-hidden transition-opacity duration-700 ${props.muted ? "pointer-events-none opacity-25" : "opacity-100"}`} aria-label="Nexus command station">
      <Canvas dpr={[1, 1.35]} shadows camera={{ position: [0, 10.5, 20.5], fov: 42, near: 0.1, far: 120 }} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} className="!absolute !inset-0">
        <CameraRig selectedSlug={props.selectedSlug} />
        <ambientLight intensity={0.22} color="#5d4637" />
        <directionalLight castShadow position={[7, 13, 9]} intensity={1.55} color="#f2f4f5" shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-9, 5, -7]} intensity={0.7} color="#9ea9b2" />
        <LivingStation {...props} paused={paused} onNavigate={navigate} />
      </Canvas>
      {!props.muted ? (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 text-center">
          <p className="font-mono text-[0.48rem] tracking-[0.34em] text-[#9b6842] uppercase">Nexus Intelligence Civilization</p>
          <p className="mt-1 font-mono text-[0.44rem] tracking-[0.16em] text-[#73533d] uppercase">Scroll to zoom / Tab to navigate</p>
        </div>
      ) : null}
    </div>
  );
}
