"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Billboard, Environment, Html, Lightformer, PerspectiveCamera, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";
import { entityLogoUrl } from "@/lib/three/entity-logo";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";

const AMBER = "#d98432";
const HOT_AMBER = "#ffb35f";
const TITANIUM = "#111519";
const CHROME = "#7f898f";

interface OrchestratorCommandDeckProps {
  entity: GalaxyEntity;
  reducedMotion: boolean;
  onScopeRoute?: (scope: GalaxyEntity) => void;
}

type ScopeLayer = "Nexus" | "Products" | "Capabilities" | "Orchestrators";

interface ScopeNode {
  entity: GalaxyEntity;
  layer: ScopeLayer;
  parentId?: string;
  position: number;
}

const SCOPE_LAYERS: Record<ScopeLayer, { radius: number; speed: number }> = {
  Nexus: { radius: 1.6, speed: 0.1 },
  Products: { radius: 2.9, speed: 0.16 },
  Capabilities: { radius: 4.25, speed: 0.23 },
  Orchestrators: { radius: 5.7, speed: 0.31 },
};

const scopeNodes: ScopeNode[] = [
  { entity: VORINTHEX_GALAXY_REGISTRY.nexus, layer: "Nexus", position: 0 },
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.products).map((entity, position) => ({ entity, layer: "Products" as const, parentId: entity.parentId, position })),
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.capabilities).map((entity, position) => ({ entity, layer: "Capabilities" as const, parentId: entity.parentId, position })),
  ...Object.values(VORINTHEX_GALAXY_REGISTRY.orchestrators).map((entity, position) => ({ entity, layer: "Orchestrators" as const, parentId: entity.reportsTo ?? entity.parentId, position })),
];
const scopeNodeById = new Map(scopeNodes.map((node) => [node.entity.id, node]));

function CameraDrift({ reducedMotion }: { reducedMotion: boolean }) {
  const camera = useRef<THREE.PerspectiveCamera>(null);
  const drag = useRef({ active: false, x: 0, y: 0 });
  const desired = useRef({ yaw: 0, pitch: 0 });
  const current = useRef({ yaw: 0, pitch: 0 });
  const velocity = useRef({ yaw: 0, pitch: 0 });
  const lastInteraction = useRef(0);
  const distance = useRef(0);
  const desiredDistance = useRef(0);
  const { gl, size } = useThree();
  const compact = size.width < 680;

  useEffect(() => {
    const element = gl.domElement;

    const pointerDown = (event: PointerEvent) => {
      drag.current = { active: true, x: event.clientX, y: event.clientY };
      velocity.current = { yaw: 0, pitch: 0 };
      lastInteraction.current = performance.now();
      element.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      drag.current.x = event.clientX;
      drag.current.y = event.clientY;
      const scale = event.pointerType === "touch" ? 0.0034 : 0.0027;
      velocity.current.yaw = -dx * scale;
      velocity.current.pitch = -dy * scale;
      desired.current.yaw = THREE.MathUtils.clamp(desired.current.yaw + velocity.current.yaw, -0.48, 0.48);
      desired.current.pitch = THREE.MathUtils.clamp(desired.current.pitch + velocity.current.pitch, -0.2, 0.19);
      lastInteraction.current = performance.now();
    };
    const pointerUp = (event: PointerEvent) => {
      drag.current.active = false;
      lastInteraction.current = performance.now();
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      desiredDistance.current = THREE.MathUtils.clamp(desiredDistance.current + event.deltaY * 0.006, 0, compact ? 5.8 : 4.8);
      lastInteraction.current = performance.now();
    };

    element.addEventListener("pointerdown", pointerDown);
    element.addEventListener("pointermove", pointerMove);
    element.addEventListener("pointerup", pointerUp);
    element.addEventListener("pointercancel", pointerUp);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", pointerDown);
      element.removeEventListener("pointermove", pointerMove);
      element.removeEventListener("pointerup", pointerUp);
      element.removeEventListener("pointercancel", pointerUp);
      element.removeEventListener("wheel", wheel);
    };
  }, [compact, gl]);

  useFrame((_, delta) => {
    if (!camera.current) return;

    if (!drag.current.active) {
      if (Math.abs(velocity.current.yaw) > 0.0001 || Math.abs(velocity.current.pitch) > 0.0001) {
        desired.current.yaw = THREE.MathUtils.clamp(desired.current.yaw + velocity.current.yaw, -0.48, 0.48);
        desired.current.pitch = THREE.MathUtils.clamp(desired.current.pitch + velocity.current.pitch, -0.2, 0.19);
        velocity.current.yaw = THREE.MathUtils.damp(velocity.current.yaw, 0, 8, delta);
        velocity.current.pitch = THREE.MathUtils.damp(velocity.current.pitch, 0, 8, delta);
      } else if (performance.now() - lastInteraction.current > 700) {
        const magnetStrength = reducedMotion ? 8 : 1.65;
        desired.current.yaw = THREE.MathUtils.damp(desired.current.yaw, 0, magnetStrength, delta);
        desired.current.pitch = THREE.MathUtils.damp(desired.current.pitch, 0, magnetStrength, delta);
      }
    }

    current.current.yaw = THREE.MathUtils.damp(current.current.yaw, desired.current.yaw, 9, delta);
    current.current.pitch = THREE.MathUtils.damp(current.current.pitch, desired.current.pitch, 9, delta);
    distance.current = THREE.MathUtils.damp(distance.current, desiredDistance.current, 7, delta);
    camera.current.rotation.set(0.04 + current.current.pitch, current.current.yaw, 0, "YXZ");
     camera.current.position.z = (compact ? 14 : 12.8) + distance.current;
  });

  return (
    <PerspectiveCamera
      ref={camera}
      makeDefault
      fov={compact ? 56 : 47}
      near={0.1}
      far={100}
       position={[0, compact ? 2.7 : 2.45, compact ? 14 : 12.8]}
      rotation={[0.04, 0, 0]}
    />
  );
}

function StarDust({ reducedMotion }: { reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(900 * 3);
    for (let index = 0; index < 900; index += 1) {
      const seed = (index * 16807) % 2147483647;
      const seedTwo = (seed * 48271) % 2147483647;
      const seedThree = (seedTwo * 69621) % 2147483647;
      values[index * 3] = (seed / 2147483647 - 0.5) * 74;
      values[index * 3 + 1] = (seedTwo / 2147483647 - 0.5) * 52 + 2;
      values[index * 3 + 2] = 7 - (seedThree / 2147483647) * 68;
    }
    return values;
  }, []);

  useFrame((_, delta) => {
    if (!reducedMotion && points.current) points.current.rotation.y += delta * 0.002;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#dce5ea" size={0.052} sizeAttenuation transparent opacity={0.78} depthWrite={false} />
    </points>
  );
}

function StationModule({ position, rotation = [0, 0, 0], scale = 1 }: { position: [number, number, number]; rotation?: [number, number, number]; scale?: number }) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <cylinderGeometry args={[0.72, 1.05, 5.5, 10]} />
        <meshStandardMaterial color="#283138" metalness={0.94} roughness={0.4} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.15, 0.16, 6, 48]} />
        <meshStandardMaterial color="#465158" metalness={0.96} roughness={0.3} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.15, 0.035, 4, 48]} />
        <meshBasicMaterial color={AMBER} toneMapped={false} />
      </mesh>
      <mesh position={[0, 3.65, 0]}>
        <boxGeometry args={[0.18, 2.2, 0.18]} />
        <meshStandardMaterial color={CHROME} metalness={1} roughness={0.22} />
      </mesh>
    </group>
  );
}

function ExteriorStation({ reducedMotion }: { reducedMotion: boolean }) {
  const station = useRef<THREE.Group>(null);
  const traffic = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    if (reducedMotion) return;
    if (station.current) station.current.rotation.z += delta * 0.01;
    if (traffic.current) {
      traffic.current.position.x = -13 + (clock.elapsedTime * 0.42) % 26;
      traffic.current.position.y = 5.8 + Math.sin(clock.elapsedTime * 0.3) * 0.4;
    }
  });

  return (
    <group>
      <StarDust reducedMotion={reducedMotion} />
      <group ref={station} position={[7.8, 1, -25]} rotation={[0.85, -0.25, -0.3]}>
        <mesh>
          <torusGeometry args={[8.4, 0.34, 8, 96]} />
          <meshStandardMaterial color="#394149" metalness={0.95} roughness={0.48} />
        </mesh>
        <mesh>
          <torusGeometry args={[8.4, 0.055, 5, 96]} />
          <meshBasicMaterial color={AMBER} toneMapped={false} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[5.8, 0.16, 6, 72, Math.PI * 1.55]} />
          <meshStandardMaterial color="#252d33" metalness={0.9} roughness={0.38} />
        </mesh>
        {Array.from({ length: 8 }, (_, index) => {
          const angle = index * Math.PI / 4;
          return (
            <mesh key={index} position={[Math.cos(angle) * 8.4, Math.sin(angle) * 8.4, 0]} rotation={[0, 0, angle]}>
              <boxGeometry args={[0.75, 1.5, 0.7]} />
              <meshStandardMaterial color="#151b20" metalness={0.92} roughness={0.32} />
            </mesh>
          );
        })}
        <mesh>
          <cylinderGeometry args={[0.85, 1.4, 10, 12]} />
          <meshStandardMaterial color="#353e44" metalness={0.94} roughness={0.28} />
        </mesh>
      </group>

      <StationModule position={[-15, 2, -8]} rotation={[0.2, 0, -0.5]} scale={1.2} />
      <StationModule position={[15, 3, -9]} rotation={[-0.25, 0.3, 0.45]} />
      <StationModule position={[-4.5, 12, -8]} rotation={[Math.PI / 2, 0.2, 0]} scale={1.35} />
      <StationModule position={[4.8, -9, -6]} rotation={[Math.PI / 2, -0.3, 0.4]} scale={1.45} />
      <mesh position={[-2, 10, -13]} rotation={[1.2, 0.25, 0.15]}>
        <torusGeometry args={[7.2, 0.2, 6, 80, Math.PI * 1.3]} />
        <meshStandardMaterial color="#303a41" metalness={0.96} roughness={0.36} />
      </mesh>
      <mesh position={[1, -9, -14]} rotation={[1.7, -0.1, -0.2]}>
        <torusGeometry args={[8.5, 0.24, 6, 80, Math.PI * 1.55]} />
        <meshStandardMaterial color="#3b464d" metalness={0.96} roughness={0.34} />
      </mesh>

      <group ref={traffic} position={[-6, 5.8, -18]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.16, 0.8, 6]} />
          <meshStandardMaterial color="#8b969c" metalness={0.9} roughness={0.25} />
        </mesh>
        <pointLight color={HOT_AMBER} intensity={0.65} distance={3} />
      </group>
      <group position={[-2, -7.5, -10]} rotation={[0.1, 0.1, -0.5]}>
        {[-2.8, 0, 2.8].map((x, index) => (
          <mesh key={x} position={[x, index * 0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[0.12, 0.7, 5]} />
            <meshBasicMaterial color={index === 1 ? HOT_AMBER : "#78929c"} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Glass({ position, rotation, size }: { position: [number, number, number]; rotation: [number, number, number]; size: [number, number] }) {
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={size} />
      <meshPhysicalMaterial color="#274553" transmission={0.72} transparent opacity={0.22} roughness={0.12} metalness={0.08} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Viewport() {
  return (
    <group position={[0, 2.75, -7.1]}>
      <mesh position={[0, 2.35, 0]}>
        <boxGeometry args={[18, 1.9, 0.48]} />
        <meshPhysicalMaterial color={TITANIUM} metalness={0.96} roughness={0.34} clearcoat={0.3} />
      </mesh>
      <mesh position={[0, -2.35, 0]}>
        <boxGeometry args={[18, 1.25, 0.65]} />
        <meshPhysicalMaterial color="#090d10" metalness={0.94} roughness={0.4} clearcoat={0.22} />
      </mesh>
      {[-7.2, -3.6, 0, 3.6, 7.2].map((x, index) => (
        <group key={x} position={[x, 0, index === 2 ? 0.08 : 0]} rotation={[0, 0, x * -0.018]}>
          <mesh>
            <boxGeometry args={[0.3, 5.25, 0.46]} />
            <meshPhysicalMaterial color={index === 2 ? CHROME : "#252c31"} metalness={0.98} roughness={0.24} clearcoat={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.245]}>
            <boxGeometry args={[0.055, 4.35, 0.025]} />
            <meshBasicMaterial color={index === 2 ? "#bf7434" : "#4a3d33"} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {[-5.4, -1.8, 1.8, 5.4].map((x) => (
        <Glass key={x} position={[x, 0, -0.08]} rotation={[0, 0, 0]} size={[3.35, 4.2]} />
      ))}
    </group>
  );
}

function SideWall({ side }: { side: -1 | 1 }) {
  return (
    <group>
      <mesh position={[side * 7.2, 0.28, 0]}>
        <boxGeometry args={[0.72, 0.8, 15]} />
        <meshPhysicalMaterial color="#0b1013" metalness={0.96} roughness={0.42} clearcoat={0.2} />
      </mesh>
      <mesh position={[side * 7.2, 4.85, 0]}>
        <boxGeometry args={[0.72, 1.25, 15]} />
        <meshPhysicalMaterial color={TITANIUM} metalness={0.97} roughness={0.36} clearcoat={0.25} />
      </mesh>
      {[-7, -3.5, 0, 3.5, 7].map((z) => (
        <group key={z} position={[side * 7.2, 2.55, z]}>
          <mesh castShadow>
            <boxGeometry args={[0.82, 3.7, 0.42]} />
            <meshPhysicalMaterial color="#323a40" metalness={0.98} roughness={0.27} clearcoat={0.4} />
          </mesh>
          <mesh position={[-side * 0.44, 0, 0]}>
            <boxGeometry args={[0.045, 3.1, 0.12]} />
            <meshBasicMaterial color={z === 0 ? AMBER : "#4a5660"} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {[-5.25, -1.75, 1.75, 5.25].map((z) => (
        <Glass key={z} position={[side * 7.17, 2.55, z]} rotation={[0, Math.PI / 2, 0]} size={[3.1, 3.45]} />
      ))}
    </group>
  );
}

function DeckShell() {
  const ribs = useRef<THREE.InstancedMesh>(null);
  const floorSeams = useRef<THREE.InstancedMesh>(null);
  const roughnessMap = useMemo(() => {
    const data = new Uint8Array(32 * 32);
    for (let index = 0; index < data.length; index += 1) data[index] = 92 + ((index * 73 + Math.floor(index / 32) * 19) % 88);
    const texture = new THREE.DataTexture(data, 32, 32, THREE.RedFormat);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8);
    texture.needsUpdate = true;
    return texture;
  }, []);

  useEffect(() => () => roughnessMap.dispose(), [roughnessMap]);
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < 9; index += 1) {
      matrix.compose(
        new THREE.Vector3(0, 5.05, 6.2 - index * 1.65),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
        new THREE.Vector3(1, 1, 1),
      );
      ribs.current?.setMatrixAt(index, matrix);
    }
    if (ribs.current) ribs.current.instanceMatrix.needsUpdate = true;

    for (let index = 0; index < 11; index += 1) {
      matrix.compose(new THREE.Vector3(0, -0.02, -6.5 + index * 1.4), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      floorSeams.current?.setMatrixAt(index, matrix);
    }
    if (floorSeams.current) floorSeams.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <SideWall side={-1} />
      <SideWall side={1} />

      {/* Floor plates are separate beams and walkways, leaving real apertures between them. */}
      <mesh position={[0, -0.27, 0]} receiveShadow>
        <boxGeometry args={[4.6, 0.55, 15]} />
        <meshPhysicalMaterial color="#0b0f12" metalness={0.94} roughness={0.48} roughnessMap={roughnessMap} clearcoat={0.15} />
      </mesh>
      {[-6.35, 6.35].map((x) => (
        <mesh key={x} position={[x, -0.27, 0]} receiveShadow>
          <boxGeometry args={[1.55, 0.55, 15]} />
          <meshPhysicalMaterial color="#090c0e" metalness={0.92} roughness={0.5} roughnessMap={roughnessMap} />
        </mesh>
      ))}
      {[-6.8, -3.4, 0, 3.4, 6.8].map((z) => (
        <mesh key={z} position={[0, -0.22, z]}>
          <boxGeometry args={[15, 0.42, 0.42]} />
          <meshPhysicalMaterial color="#30383d" metalness={0.98} roughness={0.28} clearcoat={0.35} />
        </mesh>
      ))}
      {[-4.45, 4.45].flatMap((x) => [-5.1, -1.7, 1.7, 5.1].map((z) => (
        <Glass key={`${x}-${z}`} position={[x, -0.025, z]} rotation={[-Math.PI / 2, 0, 0]} size={[2.9, 3]} />
      )))}
      <instancedMesh ref={floorSeams} args={[undefined, undefined, 11]}>
        <boxGeometry args={[4.2, 0.025, 0.025]} />
        <meshBasicMaterial color="#684323" toneMapped={false} />
      </instancedMesh>

      {/* Ceiling uses a spine, edge plates, and crossmembers around glazed bays. */}
      <mesh position={[0, 5.45, 0]}>
        <boxGeometry args={[1.25, 0.65, 15]} />
        <meshPhysicalMaterial color="#0b0f12" metalness={0.95} roughness={0.4} roughnessMap={roughnessMap} clearcoat={0.2} />
      </mesh>
      {[-6.2, 6.2].map((x) => (
        <mesh key={x} position={[x, 5.45, 0]}>
          <boxGeometry args={[2.4, 0.65, 15]} />
          <meshPhysicalMaterial color="#0c1114" metalness={0.95} roughness={0.42} roughnessMap={roughnessMap} />
        </mesh>
      ))}
      {[-6.8, -2.3, 2.3, 6.8].map((z) => (
        <mesh key={z} position={[0, 5.38, z]}>
          <boxGeometry args={[15, 0.5, 0.48]} />
          <meshStandardMaterial color="#374047" metalness={0.98} roughness={0.28} />
        </mesh>
      ))}
      {[-3.6, 3.6].flatMap((x) => [-4.55, 0, 4.55].map((z) => (
        <Glass key={`${x}-${z}`} position={[x, 5.31, z]} rotation={[Math.PI / 2, 0, 0]} size={[4.7, 4]} />
      )))}
      <instancedMesh ref={ribs} args={[undefined, undefined, 9]} castShadow>
        <torusGeometry args={[7.05, 0.13, 6, 24, Math.PI]} />
        <meshPhysicalMaterial color="#586168" metalness={1} roughness={0.2} clearcoat={0.55} />
      </instancedMesh>
      <mesh position={[0, 5.1, 0.2]}>
        <boxGeometry args={[0.1, 0.07, 13.2]} />
        <meshBasicMaterial color="#754721" toneMapped={false} />
      </mesh>
    </group>
  );
}

function SideMachinery({ side }: { side: -1 | 1 }) {
  return (
    <group position={[side * 5.85, 1.1, 0.1]} rotation={[0, side * -0.08, 0]}>
      {[-3.7, -0.7, 2.3].map((z, section) => (
        <group key={z} position={[0, 0, z]}>
          <mesh castShadow>
            <boxGeometry args={[1.25, 1.85, 2.05]} />
            <meshPhysicalMaterial color={section === 1 ? "#171d21" : "#20272c"} metalness={0.96} roughness={0.36} clearcoat={0.2} />
          </mesh>
          <mesh position={[-side * 0.64, 0.2, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[1.35, 0.68]} />
            <meshStandardMaterial color="#090e11" emissive="#22150c" emissiveIntensity={0.5} metalness={0.72} roughness={0.24} />
          </mesh>
          {[-0.42, 0, 0.42].map((offset, light) => (
            <mesh key={offset} position={[-side * 0.655, -0.49, offset]}>
              <sphereGeometry args={[0.045, 7, 7]} />
              <meshBasicMaterial color={light === section ? HOT_AMBER : "#48646a"} toneMapped={false} />
            </mesh>
          ))}
          <mesh position={[-side * 0.67, 0.6, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.16, 0.16, 1.1, 8]} />
            <meshStandardMaterial color={CHROME} metalness={1} roughness={0.2} />
          </mesh>
        </group>
      ))}
      {[-4.7, 4.1].map((z) => (
        <mesh key={z} position={[side * -0.25, 2.3, z]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.48, 0.09, 6, 24]} />
          <meshStandardMaterial color="#59636a" metalness={1} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[0, 2.15, -0.5]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.1, 0.1, 5.8, 8]} />
        <meshStandardMaterial color="#3b454b" metalness={0.96} roughness={0.34} />
      </mesh>
    </group>
  );
}

function Console({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[2.75, 0.7, 1.25]} />
        <meshPhysicalMaterial color="#161c20" metalness={0.95} roughness={0.32} clearcoat={0.28} />
      </mesh>
      <mesh position={[0, 0.45, -0.2]} rotation={[-0.3, 0, 0]}>
        <boxGeometry args={[2.35, 0.12, 0.8]} />
        <meshStandardMaterial color="#0b1013" emissive="#291a0e" emissiveIntensity={0.55} metalness={0.8} roughness={0.22} />
      </mesh>
      {[-0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78].map((x, index) => (
        <mesh key={x} position={[x, 0.55, -0.18]} rotation={[-0.3, 0, 0]}>
          <boxGeometry args={[0.09, 0.025, index % 3 === 0 ? 0.38 : 0.2]} />
          <meshBasicMaterial color={index % 3 === 0 ? HOT_AMBER : "#4e7278"} toneMapped={false} />
        </mesh>
      ))}
      {[-0.86, 0.86].map((x) => (
        <mesh key={x} position={[x, -0.8, 0]}>
          <boxGeometry args={[0.32, 1.25, 0.74]} />
          <meshStandardMaterial color="#22292e" metalness={0.94} roughness={0.38} />
        </mesh>
      ))}
    </group>
  );
}

function IdentityMedallion({ entity, reducedMotion }: OrchestratorCommandDeckProps) {
  const texture = useTexture(entityLogoUrl(entity.type, entity.slug));
  const medallion = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (reducedMotion) return;
    if (medallion.current) medallion.current.position.y = 2.35 + Math.sin(clock.elapsedTime * 0.8) * 0.06;
    if (scan.current) scan.current.rotation.z = clock.elapsedTime * 0.18;
  });

  return (
    <group ref={medallion} position={[0, 2.35, -2.55]} renderOrder={30}>
      <Billboard>
        <mesh position={[0, 0, -0.08]}>
          <circleGeometry args={[0.88, 48]} />
          <meshPhysicalMaterial color="#080b0d" metalness={0.96} roughness={0.2} clearcoat={0.7} />
        </mesh>
        <mesh position={[0, 0, -0.04]}>
          <ringGeometry args={[0.88, 1.02, 48]} />
          <meshPhysicalMaterial color="#9b704b" emissive="#6d2c0b" emissiveIntensity={0.85} metalness={0.92} roughness={0.16} clearcoat={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[1.35, 1.35]} />
          <meshBasicMaterial map={texture} color="#ffe1b7" transparent alphaTest={0.02} opacity={0.92} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh ref={scan} position={[0, 0, -0.02]}>
          <ringGeometry args={[1.14, 1.17, 6]} />
          <meshBasicMaterial color={HOT_AMBER} transparent opacity={0.62} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </Billboard>
      <mesh position={[0, -1.3, 0]}>
        <cylinderGeometry args={[0.05, 0.22, 1.1, 12]} />
        <meshStandardMaterial color="#8f969a" emissive="#8b3d12" emissiveIntensity={0.45} metalness={0.98} roughness={0.16} />
      </mesh>
      <pointLight color={AMBER} intensity={1.4} distance={5} decay={2} />
    </group>
  );
}

function scopePosition(node: ScopeNode, elapsed: number): THREE.Vector3 {
  const { radius, speed } = SCOPE_LAYERS[node.layer];
  const peers = scopeNodes.filter((candidate) => candidate.layer === node.layer);
  const angle = node.position / peers.length * Math.PI * 2 + elapsed * speed;
  return new THREE.Vector3(Math.cos(angle) * radius, 2.35 + Math.sin(angle) * radius * 0.62, -2.35);
}

function ScopeConnection({ node, parent, reducedMotion }: { node: ScopeNode; parent: ScopeNode; reducedMotion: boolean }) {
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    const elapsed = reducedMotion ? 0 : clock.elapsedTime;
    geometry.setFromPoints([scopePosition(node, elapsed), scopePosition(parent, elapsed)]);
  });

  return (
    <lineSegments geometry={geometry} renderOrder={4}>
      <lineBasicMaterial color={AMBER} transparent opacity={0.42} blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

function ScopeOrbitNode({ node, selected, reducedMotion, onSelect }: { node: ScopeNode; selected: boolean; reducedMotion: boolean; onSelect: (id: string) => void }) {
  const group = useRef<THREE.Group>(null);
  const texture = useTexture(entityLogoUrl(node.entity.type, node.entity.slug));

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.copy(scopePosition(node, reducedMotion ? 0 : clock.elapsedTime));
  });

  return (
    <group ref={group} renderOrder={20} onClick={(event) => { event.stopPropagation(); onSelect(node.entity.id); }}>
      <Billboard>
        <mesh renderOrder={selected ? 30 : 21}>
          <planeGeometry args={[selected ? 0.72 : 0.46, selected ? 0.72 : 0.46]} />
          <meshBasicMaterial map={texture} color="#fff4dc" transparent alphaTest={0.02} opacity={selected ? 1 : 0.72} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
        {selected ? <pointLight color={HOT_AMBER} intensity={1.2} distance={2.2} /> : null}
        <Html center position={[0, -0.56, 0]} distanceFactor={7} style={{ pointerEvents: "none" }}>
          <div className={`w-20 text-center font-mono uppercase tracking-[0.14em] ${selected ? "text-[#ffe2b6]" : "text-slate-300"}`}>
            <p className="text-[7px] opacity-70">{node.layer === "Nexus" ? "Nexus" : node.layer.slice(0, -1)}</p>
            <p className="mt-0.5 text-[9px] font-semibold">{node.entity.name}</p>
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

function ScopeOrbitalSystem({ selectedId, reducedMotion, onSelect }: { selectedId: string; reducedMotion: boolean; onSelect: (id: string) => void }) {
  return (
    <group>
      {Object.entries(SCOPE_LAYERS).map(([layer, { radius }]) => (
          <mesh key={layer} position={[0, 2.35, -2.42]} rotation={[0, 0, 0]} renderOrder={5}>
            <ringGeometry args={[radius - 0.012, radius + 0.012, 96]} />
           <meshBasicMaterial color={layer === "Nexus" ? HOT_AMBER : "#49636e"} transparent opacity={0.34} blending={THREE.AdditiveBlending} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      {scopeNodes.map((node) => {
        const parent = node.parentId ? scopeNodeById.get(node.parentId) : undefined;
        return parent ? <ScopeConnection key={`link-${node.entity.id}`} node={node} parent={parent} reducedMotion={reducedMotion} /> : null;
      })}
      {scopeNodes.map((node) => <ScopeOrbitNode key={node.entity.id} node={node} selected={node.entity.id === selectedId} reducedMotion={reducedMotion} onSelect={onSelect} />)}
    </group>
  );
}

interface CommandDeckSceneProps extends OrchestratorCommandDeckProps {
  selectedScopeId: string;
  onSelectScope: (id: string) => void;
}

function CommandDeckScene(props: CommandDeckSceneProps) {
  return (
    <>
      <color attach="background" args={["#030608"]} />
      <fog attach="fog" args={["#05090c", 15, 62]} />
      <CameraDrift reducedMotion={props.reducedMotion} />
      <Environment resolution={128}>
        <Lightformer form="rect" color="#e8f2f7" intensity={3.2} scale={[12, 2, 1]} position={[0, 6, 4]} rotation={[-0.5, 0, 0]} />
        <Lightformer form="rect" color="#6f91a5" intensity={2} scale={[4, 10, 1]} position={[-8, 2, 0]} rotation={[0, Math.PI / 2, 0]} />
        <Lightformer form="ring" color={HOT_AMBER} intensity={2.6} scale={4} position={[7, 1, -4]} rotation={[0, -0.8, 0]} />
      </Environment>
      <ambientLight color="#82919a" intensity={0.16} />
      <hemisphereLight color="#536978" groundColor="#130d09" intensity={0.38} />
      <directionalLight position={[4, 7, 7]} color="#dbe4e8" intensity={1.25} castShadow shadow-mapSize={[512, 512]} shadow-camera-far={24} />
      <spotLight position={[0, 5, 4]} target-position={[0, 0, -4]} angle={0.72} penumbra={0.8} intensity={2.4} color="#b9c7cd" distance={24} />
      <spotLight position={[-5, 2, 1]} target-position={[0, 1, -3]} angle={0.5} penumbra={0.9} intensity={1.6} color={AMBER} distance={16} />

      <ExteriorStation reducedMotion={props.reducedMotion} />
      <Viewport />
      <DeckShell />
      <SideMachinery side={-1} />
      <SideMachinery side={1} />
      <Console position={[-3.45, 0.75, -2.25]} rotation={[0, 0.28, 0]} />
      <Console position={[3.45, 0.75, -2.25]} rotation={[0, -0.28, 0]} />
      <Console position={[0, 0.68, -3.25]} />
      <IdentityMedallion {...props} />
      <ScopeOrbitalSystem selectedId={props.selectedScopeId} reducedMotion={props.reducedMotion} onSelect={props.onSelectScope} />
    </>
  );
}

export default function OrchestratorCommandDeck(props: OrchestratorCommandDeckProps) {
  const { entity } = props;
  const [selectedScopeId, setSelectedScopeId] = useState(VORINTHEX_GALAXY_REGISTRY.nexus.id);
  const selectedScope = scopeNodeById.get(selectedScopeId) ?? scopeNodes[0]!;
  const selectedScopeIndex = scopeNodes.findIndex((node) => node.entity.id === selectedScope.entity.id);
  const stepScope = (direction: -1 | 1) => {
    const nextIndex = (selectedScopeIndex + direction + scopeNodes.length) % scopeNodes.length;
    setSelectedScopeId(scopeNodes[nextIndex]!.entity.id);
  };
  const sceneProps = {
    entity,
    reducedMotion: props.reducedMotion,
    selectedScopeId,
    onSelectScope: (id: string) => {
      setSelectedScopeId(id);
      const scope = scopeNodeById.get(id)?.entity;
      if (scope) props.onScopeRoute?.(scope);
    },
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredScopes = scopeNodes.filter((node) =>
    `${node.entity.name} ${node.layer}`.toLowerCase().includes(query.toLowerCase()),
  );
  const instruction = `Drag to look around the ${entity.name} Nexus command deck. Use the mouse wheel to zoom.`;

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden bg-black/70" aria-label={`${entity.name} Nexus command deck`}>
      <Canvas
        dpr={[1, 1.35]}
        shadows
         camera={{ position: [0, 2.45, 12.8], fov: 47, near: 0.1, far: 100 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        className="!absolute !inset-0 !touch-none"
        aria-label={instruction}
        role="img"
      >
        <Suspense fallback={null}>
          <CommandDeckScene {...sceneProps} />
        </Suspense>
      </Canvas>
      <div className="absolute inset-x-4 top-4 z-10 flex items-start justify-between text-slate-100 sm:inset-x-7 sm:top-6">
        <div className="relative pointer-events-auto">
          <button type="button" onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen}
            className="min-w-52 rounded-full border border-white/15 bg-black/65 px-4 py-2 text-left shadow-xl backdrop-blur-xl">
            <span className="block font-mono text-[8px] uppercase tracking-[0.22em] text-[#ffba72]">{selectedScope.layer}</span>
            <span className="mt-1 block truncate font-mono text-sm font-semibold uppercase tracking-[0.16em]">{selectedScope.entity.name}</span>
          </button>
          {pickerOpen ? (
            <div className="absolute top-[calc(100%+0.5rem)] left-0 w-72 rounded-2xl border border-white/15 bg-[#080b0d]/95 p-2 shadow-2xl backdrop-blur-2xl">
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scopes..."
                className="mb-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[10px] text-silver-100 outline-none placeholder:text-silver-600 focus:border-white/25" />
              <div className="max-h-64 overflow-y-auto">
                {filteredScopes.map((node) => (
                  <button key={node.entity.id} type="button" onClick={() => { sceneProps.onSelectScope(node.entity.id); setPickerOpen(false); }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-silver-400 transition-colors hover:bg-white/[0.07] hover:text-white">
                    <span>{node.entity.name}</span><span className="text-[8px] text-silver-700">{node.layer}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="pointer-events-auto flex overflow-hidden rounded-full border border-white/15 bg-black/55 backdrop-blur-md">
          <button type="button" onClick={() => { stepScope(-1); sceneProps.onSelectScope(scopeNodes[(selectedScopeIndex - 1 + scopeNodes.length) % scopeNodes.length]!.entity.id); }} aria-label="Previous scope" className="flex h-10 w-10 items-center justify-center text-lg text-slate-200 transition-colors hover:bg-white/10 hover:text-white">‹</button>
          <button type="button" onClick={() => { stepScope(1); sceneProps.onSelectScope(scopeNodes[(selectedScopeIndex + 1) % scopeNodes.length]!.entity.id); }} aria-label="Next scope" className="flex h-10 w-10 items-center justify-center border-l border-white/10 text-lg text-slate-200 transition-colors hover:bg-white/10 hover:text-white">›</button>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent_20%,rgba(0,0,0,0.66)_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:radial-gradient(rgba(255,255,255,0.7)_0.5px,transparent_0.7px)] [background-size:3px_3px]" />
    </div>
  );
}
