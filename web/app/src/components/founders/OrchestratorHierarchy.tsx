"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Billboard, Html, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";

const ORCHESTRATORS = Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators);
const ATLAS = VORINTHEX_GALAXY_REGISTRY.orchestrators.atlas;
const CHILDREN = new Map<string, GalaxyEntity[]>();

for (const entity of ORCHESTRATORS) {
  if (!entity.reportsTo) continue;
  const siblings = CHILDREN.get(entity.reportsTo) ?? [];
  siblings.push(entity);
  CHILDREN.set(entity.reportsTo, siblings);
}

function AmberOrbit({ radius, selected }: { radius: number; selected: boolean }) {
  const line = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let index = 0; index <= 128; index += 1) {
      const angle = (index / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: selected ? "#ffb340" : "#a95612",
        transparent: true,
        opacity: selected ? 0.4 : 0.17,
        blending: THREE.AdditiveBlending,
      }),
    );
  }, [radius, selected]);

  useEffect(() => () => {
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  }, [line]);

  return <primitive object={line} />;
}

function NodeLabel({ entity, selected, onSelect, offset }: {
  entity: GalaxyEntity;
  selected: boolean;
  onSelect: (entity: GalaxyEntity) => void;
  offset: number;
}) {
  return (
    <Html center position={[0, -offset, 0]} distanceFactor={11} zIndexRange={[20, 0]}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Chat with ${entity.name}, ${entity.role}`}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(entity);
        }}
        className="group flex min-w-[82px] -translate-y-1 flex-col items-center whitespace-nowrap outline-none"
      >
        <span className={`font-mono text-[0.56rem] tracking-[0.23em] ${selected ? "text-[#ffd59a]" : "text-[#bb8a58] group-hover:text-[#ffc56e]"}`}>
          {entity.role}
        </span>
        <span className={`mt-0.5 text-[0.62rem] font-medium tracking-[0.15em] uppercase ${selected ? "text-white" : "text-[#e5c6a4] group-hover:text-white"}`}>
          {entity.name}
        </span>
      </button>
    </Html>
  );
}

function CelestialNode({ entity, selected, onSelect, root = false }: {
  entity: GalaxyEntity;
  selected: boolean;
  onSelect: (entity: GalaxyEntity) => void;
  root?: boolean;
}) {
  const visual = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const texture = useTexture(entity.logo.src);
  const size = root ? 0.66 : 0.39;

  useFrame(({ clock }) => {
    if (!visual.current) return;
    const pulse = Math.sin(clock.elapsedTime * 2.2 + entity.slug.length) * 0.5 + 0.5;
    visual.current.scale.setScalar(selected ? 1.08 + pulse * 0.12 : hovered ? 1.08 : 1 + pulse * 0.025);
  });

  return (
    <group>
      <group ref={visual}>
        <mesh>
          <sphereGeometry args={[size, 32, 32]} />
          <meshStandardMaterial
            color="#0b0602"
            emissive={selected ? "#a84608" : "#351304"}
            emissiveIntensity={selected ? 0.9 : 0.28}
            metalness={0.88}
            roughness={0.24}
          />
        </mesh>

        <Billboard>
          <mesh position={[0, 0, size * 1.04]}>
            <planeGeometry args={[size * 1.48, size * 1.48]} />
            <meshBasicMaterial
              map={texture}
              color={selected ? "#ffd08a" : "#e58b30"}
              transparent
              alphaTest={0.02}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, 0, -0.02]}>
            <ringGeometry args={[size * 1.12, size * 1.18, 64]} />
            <meshBasicMaterial
              color={selected ? "#ffd089" : "#b65d18"}
              transparent
              opacity={selected ? 0.95 : 0.55}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {selected ? (
            <mesh position={[0, 0, -0.04]}>
              <ringGeometry args={[size * 1.33, size * 1.47, 64]} />
              <meshBasicMaterial color="#ff9b2f" transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          ) : null}
        </Billboard>

        <mesh
          visible={false}
          onClick={(event) => {
            event.stopPropagation();
            if (event.delta <= 8) onSelect(entity);
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
          <sphereGeometry args={[size * 1.5, 16, 16]} />
          <meshBasicMaterial />
        </mesh>
      </group>

      {selected ? <pointLight color="#ff8a22" intensity={root ? 8 : 4} distance={root ? 5 : 2.5} decay={2} /> : null}
      <NodeLabel entity={entity} selected={selected} onSelect={onSelect} offset={size * 1.72} />
    </group>
  );
}

function OrbitBranch({ entity, depth, index, siblingCount, selectedSlug, paused, onSelect }: {
  entity: GalaxyEntity;
  depth: number;
  index: number;
  siblingCount: number;
  selectedSlug: string;
  paused: boolean;
  onSelect: (entity: GalaxyEntity) => void;
}) {
  const body = useRef<THREE.Group>(null);
  const connector = useMemo(() => {
    const positions = new Float32Array(6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: "#d2701d", transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending }),
    );
  }, []);
  const angle = useRef((index / Math.max(1, siblingCount)) * Math.PI * 2 + depth * 0.47);
  const radius = depth === 1 ? 4.15 : depth === 2 ? 1.48 : 1.12;
  const inclination = depth === 1 ? (index - 2.5) * 0.1 : ((index % 2 === 0 ? 1 : -1) * (0.34 + depth * 0.05));
  const tilt = depth === 1 ? (index % 2 === 0 ? 0.08 : -0.08) : index * 0.28;
  const selected = entity.slug === selectedSlug;
  const branchSelected = selected || selectedSlug === entity.slug || (CHILDREN.get(entity.id)?.some((child) => child.slug === selectedSlug) ?? false);
  const children = CHILDREN.get(entity.id) ?? [];

  useEffect(() => () => {
    connector.geometry.dispose();
    (connector.material as THREE.Material).dispose();
  }, [connector]);

  useFrame((_, delta) => {
    if (!paused) angle.current += delta * (0.024 + depth * 0.004 + index * 0.0015);
    const x = Math.cos(angle.current) * radius;
    const z = Math.sin(angle.current) * radius;
    body.current?.position.set(x, 0, z);
    const position = connector.geometry.getAttribute("position") as THREE.BufferAttribute;
    position.setXYZ(1, x, 0, z);
    position.needsUpdate = true;
  });

  return (
    <group rotation={[inclination, 0, tilt]}>
      <AmberOrbit radius={radius} selected={branchSelected} />
      <primitive object={connector} />
      <group ref={body}>
        <CelestialNode entity={entity} selected={selected} onSelect={onSelect} />
        {children.map((child, childIndex) => (
          <OrbitBranch
            key={child.id}
            entity={child}
            depth={depth + 1}
            index={childIndex}
            siblingCount={children.length}
            selectedSlug={selectedSlug}
            paused={paused}
            onSelect={onSelect}
          />
        ))}
      </group>
    </group>
  );
}

function AmberDust({ paused }: { paused: boolean }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(420 * 3);
    for (let index = 0; index < 420; index += 1) {
      const angle = index * 2.39996;
      const radius = 2.2 + ((index * 37) % 100) / 12;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = (((index * 53) % 100) / 100 - 0.5) * 4.5;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, []);

  useFrame((_, delta) => {
    if (!paused && points.current) points.current.rotation.y += delta * 0.006;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#d66a18" size={0.025} transparent opacity={0.48} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

function CameraSetup() {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function CommandSystem({ selectedSlug, paused, onSelect }: {
  selectedSlug: string;
  paused: boolean;
  onSelect: (entity: GalaxyEntity) => void;
}) {
  const roots = CHILDREN.get(ATLAS.id) ?? [];
  const system = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!paused && system.current) system.current.rotation.y += delta * 0.0035;
  });

  return (
    <group ref={system} rotation={[-0.04, 0, 0]}>
      <AmberDust paused={paused} />
      <CelestialNode entity={ATLAS} selected={selectedSlug === ATLAS.slug} onSelect={onSelect} root />
      {roots.map((entity, index) => (
        <OrbitBranch
          key={entity.id}
          entity={entity}
          depth={1}
          index={index}
          siblingCount={roots.length}
          selectedSlug={selectedSlug}
          paused={paused}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

interface OrchestratorHierarchyProps {
  selectedSlug: string;
  onSelect: (orchestrator: GalaxyEntity) => void;
}

export default function OrchestratorHierarchy({ selectedSlug, onSelect }: OrchestratorHierarchyProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className="relative h-full min-h-[540px] w-full overflow-hidden" aria-label="Command orchestrator solar system">
      <Canvas
        dpr={[1, 1.35]}
        camera={{ position: [0, 8.5, 14.5], fov: 43, near: 0.1, far: 80 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        className="!absolute !inset-0"
      >
        <CameraSetup />
        <ambientLight intensity={0.34} color="#7a3510" />
        <directionalLight position={[5, 9, 7]} intensity={1.2} color="#ffb45a" />
        <pointLight position={[0, 0, 0]} intensity={3.5} color="#f2791c" distance={12} decay={1.6} />
        <CommandSystem selectedSlug={selectedSlug} paused={Boolean(reducedMotion)} onSelect={onSelect} />
      </Canvas>
      <p className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 font-mono text-[0.55rem] tracking-[0.28em] text-[#a96834] uppercase">
        Command Orchestrator System
      </p>
    </div>
  );
}
