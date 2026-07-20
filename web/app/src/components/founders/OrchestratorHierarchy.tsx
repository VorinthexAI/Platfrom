"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Billboard, Html, Line, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { SUN_SURFACE_FRAGMENT_SHADER, SUN_SURFACE_VERTEX_SHADER, sunHeartbeat } from "@/lib/three/sun-shader";

const ORCHESTRATORS = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const ATLAS = VORINTHEX_GALAXY_REGISTRY.orchestrators.atlas;
const BY_ID = new Map(ORCHESTRATORS.map((entity) => [entity.id, entity]));
const LAYER_RADII = [0, 2.45, 4.2, 5.75];
const NODE_ANGLES: Record<string, number> = {
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

function stationPosition(entity: GalaxyEntity): [number, number, number] {
  if (entity.slug === "atlas") return [0, 0, 0.42];
  const radius = LAYER_RADII[depthFor(entity)];
  const angle = THREE.MathUtils.degToRad(NODE_ANGLES[entity.slug] ?? 0);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0.42];
}

function StationRing({ radius, layer, paused }: { radius: number; layer: number; paused: boolean }) {
  const rotating = useRef<THREE.Group>(null);
  const segments = 24 + layer * 8;

  useFrame((_, delta) => {
    if (!paused && rotating.current) rotating.current.rotation.z += delta * (layer % 2 === 0 ? -0.012 : 0.009);
  });

  return (
    <group ref={rotating}>
      <mesh castShadow receiveShadow>
        <torusGeometry args={[radius, 0.14, 10, 192]} />
        <meshStandardMaterial color="#151719" metalness={0.94} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, -0.22]} castShadow>
        <torusGeometry args={[radius, 0.085, 8, 192]} />
        <meshStandardMaterial color="#343536" metalness={1} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.18]}>
        <torusGeometry args={[radius, 0.018, 5, 192]} />
        <meshBasicMaterial color="#ff861d" transparent opacity={0.74} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[0, 0, -0.12]} rotation={[0, 0, Math.PI / segments]}>
        <torusGeometry args={[radius + 0.2, 0.025, 5, 192]} />
        <meshBasicMaterial color="#78340d" transparent opacity={0.48} />
      </mesh>

      {Array.from({ length: segments }, (_, index) => {
        const angle = (index / segments) * Math.PI * 2;
        const wide = index % 4 === 0;
        return (
          <group key={index} position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0]} rotation={[0, 0, angle]}>
            <mesh position={[0, 0, 0.02]} castShadow>
              <boxGeometry args={[wide ? 0.34 : 0.18, wide ? 0.54 : 0.34, 0.28]} />
              <meshStandardMaterial color={wide ? "#292a2b" : "#1d1e20"} metalness={0.9} roughness={0.36} />
            </mesh>
            <mesh position={[0, wide ? 0.28 : 0.18, 0.18]}>
              <boxGeometry args={[0.055, 0.055, 0.04]} />
              <meshBasicMaterial color={index % 7 === 0 ? "#ffd08a" : "#d85b12"} toneMapped={false} />
            </mesh>
            {wide ? (
              <mesh position={[0, -0.39, 0]} castShadow>
                <boxGeometry args={[0.08, 0.3, 0.16]} />
                <meshStandardMaterial color="#3a3b3c" metalness={1} roughness={0.25} />
              </mesh>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}

function StationSpokes() {
  return (
    <group position={[0, 0, -0.08]}>
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index / 12) * Math.PI * 2;
        return (
          <group key={index} rotation={[0, 0, angle]}>
            <mesh position={[3.1, 0, 0]} castShadow>
              <boxGeometry args={[5.5, 0.055, 0.12]} />
              <meshStandardMaterial color="#242628" metalness={0.92} roughness={0.32} />
            </mesh>
            <mesh position={[3.1, 0, 0.075]}>
              <boxGeometry args={[5.25, 0.012, 0.012]} />
              <meshBasicMaterial color="#9f430f" transparent opacity={0.5} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function DockingPod({ entity, selected, onSelect }: { entity: GalaxyEntity; selected: boolean; onSelect: (entity: GalaxyEntity) => void }) {
  const pulse = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const texture = useTexture(entity.logo.src);
  const depth = depthFor(entity);
  const podScale = depth === 1 ? 1 : depth === 2 ? 0.88 : 0.8;

  useFrame(({ clock }) => {
    if (!pulse.current) return;
    const wave = Math.sin(clock.elapsedTime * 2.4 + entity.slug.length) * 0.5 + 0.5;
    pulse.current.scale.setScalar(selected ? 1.05 + wave * 0.1 : hovered ? 1.06 : 1 + wave * 0.018);
  });

  return (
    <group position={stationPosition(entity)} scale={podScale}>
      <group ref={pulse}>
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.48, 0.25, 32]} />
          <meshStandardMaterial color="#111315" metalness={0.96} roughness={0.24} />
        </mesh>
        <mesh position={[0, 0, 0.15]}>
          <torusGeometry args={[0.38, 0.055, 8, 48]} />
          <meshStandardMaterial color={selected ? "#ffb14c" : "#6b3515"} emissive="#e45d10" emissiveIntensity={selected ? 2.4 : 0.55} metalness={0.8} roughness={0.22} />
        </mesh>
        <Billboard position={[0, 0, 0.31]}>
          <mesh>
            <planeGeometry args={[0.55, 0.55]} />
            <meshBasicMaterial map={texture} color={selected ? "#ffe0ab" : "#e9933f"} transparent alphaTest={0.02} depthWrite={false} toneMapped={false} />
          </mesh>
          {selected ? (
            <mesh position={[0, 0, -0.03]}>
              <ringGeometry args={[0.52, 0.59, 64]} />
              <meshBasicMaterial color="#ff8b22" transparent opacity={0.52} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          ) : null}
        </Billboard>
        <mesh
          visible={false}
          onClick={(event) => { event.stopPropagation(); if (event.delta <= 8) onSelect(entity); }}
          onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
        >
          <sphereGeometry args={[0.62, 16, 16]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      <Html center position={[0, -0.67, 0.5]} distanceFactor={10.5} zIndexRange={[20, 0]}>
        <button type="button" aria-pressed={selected} aria-label={`Chat with ${entity.name}, ${entity.role}`} onClick={(event) => { event.stopPropagation(); onSelect(entity); }} className="flex min-w-[78px] flex-col items-center whitespace-nowrap outline-none">
          <span className={`font-mono text-[0.55rem] tracking-[0.22em] ${selected ? "text-[#ffd79c]" : "text-[#bd8149]"}`}>{entity.role}</span>
          <span className={`mt-0.5 text-[0.61rem] font-medium tracking-[0.14em] uppercase ${selected ? "text-white" : "text-[#e7c6a3]"}`}>{entity.name}</span>
        </button>
      </Html>
      {selected ? <pointLight color="#ff7b18" intensity={5} distance={2.7} decay={2} position={[0, 0, 0.45]} /> : null}
    </group>
  );
}

function ReactorCore({ selected, paused, onSelect }: { selected: boolean; paused: boolean; onSelect: (entity: GalaxyEntity) => void }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const cageA = useRef<THREE.Mesh>(null);
  const cageB = useRef<THREE.Mesh>(null);
  const texture = useTexture(ATLAS.logo.src);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPulse: { value: sunHeartbeat(0) } }), []);

  useFrame((_, delta) => {
    if (!paused && material.current) {
      const time = (material.current.uniforms.uTime.value += delta);
      material.current.uniforms.uPulse.value = sunHeartbeat(time);
      if (cageA.current) cageA.current.rotation.z += delta * 0.12;
      if (cageB.current) cageB.current.rotation.z -= delta * 0.08;
    }
  });

  return (
    <group position={[0, 0, 0.45]}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect(ATLAS); }}>
        <sphereGeometry args={[0.82, 48, 48]} />
        <shaderMaterial ref={material} vertexShader={SUN_SURFACE_VERTEX_SHADER} fragmentShader={SUN_SURFACE_FRAGMENT_SHADER} uniforms={uniforms} />
      </mesh>
      <mesh ref={cageA}>
        <torusGeometry args={[1.04, 0.035, 6, 96]} />
        <meshStandardMaterial color="#b75d18" emissive="#ff7218" emissiveIntensity={1.5} metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh ref={cageB} rotation={[0, 0, Math.PI / 4]}>
        <torusGeometry args={[1.18, 0.022, 6, 96]} />
        <meshBasicMaterial color="#ff9a31" transparent opacity={0.56} blending={THREE.AdditiveBlending} />
      </mesh>
      <Billboard position={[0, 0, 0.9]}>
        <mesh>
          <planeGeometry args={[0.72, 0.72]} />
          <meshBasicMaterial map={texture} color="#ffe0aa" transparent alphaTest={0.02} depthWrite={false} toneMapped={false} />
        </mesh>
      </Billboard>
      <Html center position={[0, -1.08, 1]} distanceFactor={10.5} zIndexRange={[25, 0]}>
        <button type="button" aria-pressed={selected} onClick={() => onSelect(ATLAS)} className="flex min-w-[96px] flex-col items-center whitespace-nowrap outline-none">
          <span className="font-mono text-[0.58rem] tracking-[0.24em] text-[#ffd08b]">CEO</span>
          <span className="mt-0.5 text-[0.66rem] font-semibold tracking-[0.16em] text-white uppercase">Atlas</span>
        </button>
      </Html>
      <pointLight color="#ff7217" intensity={selected ? 12 : 8} distance={7} decay={1.8} />
    </group>
  );
}

function StationDebris({ paused }: { paused: boolean }) {
  const field = useRef<THREE.Group>(null);
  const debris = useMemo(() => Array.from({ length: 72 }, (_, index) => {
    const angle = index * 2.39996;
    const radius = 6.4 + ((index * 37) % 100) / 85;
    return {
      position: [Math.cos(angle) * radius, Math.sin(angle) * radius, ((index * 43) % 100) / 38 - 1.3] as [number, number, number],
      scale: 0.025 + ((index * 17) % 10) / 120,
      rotation: [angle, angle * 0.7, angle * 1.3] as [number, number, number],
    };
  }), []);

  useFrame((_, delta) => { if (!paused && field.current) field.current.rotation.z -= delta * 0.004; });
  return (
    <group ref={field}>
      {debris.map((piece, index) => (
        <mesh key={index} position={piece.position} rotation={piece.rotation} scale={piece.scale}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={index % 8 === 0 ? "#6c3212" : "#242527"} metalness={0.45} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function CameraRig({ paused }: { paused: boolean }) {
  const camera = useThree((state) => state.camera);
  const pointer = useThree((state) => state.pointer);
  const cameraRef = useRef(camera);
  useEffect(() => { cameraRef.current.lookAt(0, 0, 0); }, []);
  useFrame((_, delta) => {
    if (paused) return;
    const current = cameraRef.current;
    current.position.x = THREE.MathUtils.damp(current.position.x, pointer.x * 0.34, 2.5, delta);
    current.position.y = THREE.MathUtils.damp(current.position.y, 1.1 + pointer.y * 0.22, 2.5, delta);
    current.lookAt(0, 0, 0);
  });
  return null;
}

function CommandStation({ selectedSlug, paused, onSelect }: { selectedSlug: string; paused: boolean; onSelect: (entity: GalaxyEntity) => void }) {
  return (
    <group rotation={[0.12, 0, -0.015]}>
      <StationSpokes />
      <StationRing radius={LAYER_RADII[1]} layer={1} paused={paused} />
      <StationRing radius={LAYER_RADII[2]} layer={2} paused={paused} />
      <StationRing radius={LAYER_RADII[3]} layer={3} paused={paused} />
      {ORCHESTRATORS.map((entity) => {
        if (!entity.reportsTo) return null;
        const parent = BY_ID.get(entity.reportsTo);
        if (!parent) return null;
        const active = entity.slug === selectedSlug || parent.slug === selectedSlug;
        return <Line key={`${parent.id}:${entity.id}`} points={[stationPosition(parent), stationPosition(entity)]} color={active ? "#ffad43" : "#a34812"} lineWidth={active ? 1.6 : 0.55} transparent opacity={active ? 0.8 : 0.34} />;
      })}
      <ReactorCore selected={selectedSlug === "atlas"} paused={paused} onSelect={onSelect} />
      {ORCHESTRATORS.filter((entity) => entity.slug !== "atlas").map((entity) => <DockingPod key={entity.id} entity={entity} selected={entity.slug === selectedSlug} onSelect={onSelect} />)}
      <StationDebris paused={paused} />
    </group>
  );
}

interface OrchestratorHierarchyProps {
  selectedSlug: string;
  onSelect: (orchestrator: GalaxyEntity) => void;
}

export default function OrchestratorHierarchy({ selectedSlug, onSelect }: OrchestratorHierarchyProps) {
  const paused = Boolean(useReducedMotion());
  return (
    <div className="relative h-full min-h-[540px] w-full overflow-hidden" aria-label="Nexus command station">
      <Canvas dpr={[1, 1.35]} shadows camera={{ position: [0, 1.1, 16.4], fov: 43, near: 0.1, far: 90 }} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} className="!absolute !inset-0">
        <CameraRig paused={paused} />
        <ambientLight intensity={0.28} color="#75401f" />
        <directionalLight castShadow position={[4, 8, 10]} intensity={1.8} color="#ffe0b1" />
        <pointLight position={[-5, 2, 5]} intensity={2.2} color="#df6818" distance={15} />
        <CommandStation selectedSlug={selectedSlug} paused={paused} onSelect={onSelect} />
      </Canvas>
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 text-center">
        <p className="font-mono text-[0.5rem] tracking-[0.3em] text-[#8f552a] uppercase">Nexus Command Station</p>
        <p className="mt-1 text-[0.58rem] tracking-[0.16em] text-[#d18a49] uppercase">Three operational layers online</p>
      </div>
    </div>
  );
}
