"use client";

import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { Billboard, Environment, Lightformer, PerspectiveCamera, useTexture } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GalaxyEntity } from "@/lib/galaxy/registry-types";

const AMBER = "#d98432";
const HOT_AMBER = "#ffb35f";
const TITANIUM = "#111519";
const CHROME = "#7f898f";

interface OrchestratorCommandDeckProps {
  orchestrator: GalaxyEntity;
  reducedMotion: boolean;
}

function CameraDrift({ reducedMotion }: { reducedMotion: boolean }) {
  const camera = useRef<THREE.PerspectiveCamera>(null);
  const { size } = useThree();
  const compact = size.width < 680;

  useFrame(({ clock }, delta) => {
    if (reducedMotion || !camera.current) return;
    const time = clock.elapsedTime;
    camera.current.position.x = THREE.MathUtils.damp(camera.current.position.x, Math.sin(time * 0.16) * 0.24, 1.5, delta);
    camera.current.position.y = THREE.MathUtils.damp(camera.current.position.y, 2.45 + Math.sin(time * 0.21) * 0.08, 1.5, delta);
    camera.current.lookAt(Math.sin(time * 0.12) * 0.14, 1.68 + Math.cos(time * 0.17) * 0.04, -6.5);
  });

  return (
    <PerspectiveCamera
      ref={camera}
      makeDefault
      fov={compact ? 56 : 47}
      near={0.1}
      far={80}
      position={[0, compact ? 2.7 : 2.45, compact ? 12.8 : 11.2]}
      rotation={[0.07, 0, 0]}
    />
  );
}

function StarDust({ reducedMotion }: { reducedMotion: boolean }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(600 * 3);
    for (let index = 0; index < 600; index += 1) {
      const seed = index * 16807 % 2147483647;
      const seedTwo = seed * 48271 % 2147483647;
      const seedThree = seedTwo * 69621 % 2147483647;
      values[index * 3] = (seed / 2147483647 - 0.5) * 60;
      values[index * 3 + 1] = (seedTwo / 2147483647 - 0.5) * 34 + 4;
      values[index * 3 + 2] = -14 - seedThree / 2147483647 * 42;
    }
    return values;
  }, []);

  useFrame((_, delta) => {
    if (!reducedMotion && points.current) points.current.rotation.y += delta * 0.003;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#dce5ea" size={0.045} sizeAttenuation transparent opacity={0.72} depthWrite={false} />
    </points>
  );
}

function ExteriorStation({ reducedMotion }: { reducedMotion: boolean }) {
  const station = useRef<THREE.Group>(null);
  const traffic = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    if (reducedMotion) return;
    if (station.current) station.current.rotation.z += delta * 0.012;
    if (traffic.current) {
      traffic.current.position.x = -11 + (clock.elapsedTime * 0.36) % 22;
      traffic.current.position.y = 4.7 + Math.sin(clock.elapsedTime * 0.25) * 0.35;
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
          <torusGeometry args={[8.4, 0.06, 5, 96]} />
          <meshBasicMaterial color={AMBER} toneMapped={false} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[5.8, 0.16, 6, 72]} />
          <meshStandardMaterial color="#252d33" metalness={0.9} roughness={0.38} />
        </mesh>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
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

      <group position={[-10, -0.5, -30]} rotation={[0.08, 0.32, 0.02]}>
        <mesh>
          <boxGeometry args={[4.4, 7.5, 3]} />
          <meshStandardMaterial color="#1c252b" metalness={0.9} roughness={0.5} />
        </mesh>
        {[0, 1, 2, 3].map((index) => (
          <mesh key={index} position={[0, -2.6 + index * 1.7, 1.53]}>
            <boxGeometry args={[3.2, 0.07, 0.04]} />
            <meshBasicMaterial color={index === 2 ? AMBER : "#587181"} toneMapped={false} />
          </mesh>
        ))}
        <mesh position={[0, 5.2, 0]}>
          <cylinderGeometry args={[0.15, 0.34, 5.5, 8]} />
          <meshStandardMaterial color={CHROME} metalness={1} roughness={0.25} />
        </mesh>
      </group>

      <group ref={traffic} position={[-6, 4.7, -18]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[0.16, 0.8, 6]} />
          <meshStandardMaterial color="#8b969c" metalness={0.9} roughness={0.25} />
        </mesh>
        <pointLight color={HOT_AMBER} intensity={0.65} distance={3} />
      </group>
    </group>
  );
}

function Viewport() {
  return (
    <group position={[0, 2.75, -7.1]}>
      <mesh position={[0, 2.35, 0]}>
        <boxGeometry args={[18, 1.9, 0.48]} />
        <meshPhysicalMaterial color={TITANIUM} metalness={0.96} roughness={0.23} clearcoat={0.4} />
      </mesh>
      <mesh position={[0, -2.35, 0]}>
        <boxGeometry args={[18, 1.25, 0.65]} />
        <meshPhysicalMaterial color="#090d10" metalness={0.94} roughness={0.3} clearcoat={0.3} />
      </mesh>
      {[-7.2, -3.6, 0, 3.6, 7.2].map((x, index) => (
        <group key={x} position={[x, 0, index === 2 ? 0.08 : 0]} rotation={[0, 0, x * -0.018]}>
          <mesh>
            <boxGeometry args={[0.3, 5.25, 0.46]} />
            <meshPhysicalMaterial color={index === 2 ? CHROME : "#252c31"} metalness={0.98} roughness={0.2} clearcoat={0.55} />
          </mesh>
          <mesh position={[0, 0, 0.245]}>
            <boxGeometry args={[0.055, 4.35, 0.025]} />
            <meshBasicMaterial color={index === 2 ? "#bf7434" : "#4a3d33"} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {[-5.4, -1.8, 1.8, 5.4].map((x) => (
        <mesh key={x} position={[x, 0, -0.08]}>
          <planeGeometry args={[3.35, 4.2]} />
          <meshPhysicalMaterial color="#19303b" transmission={0.28} transparent opacity={0.16} roughness={0.08} metalness={0.05} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function DeckShell() {
  const ribs = useRef<THREE.InstancedMesh>(null);
  const floorTracks = useRef<THREE.InstancedMesh>(null);

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
    ribs.current!.instanceMatrix.needsUpdate = true;

    for (let index = 0; index < 7; index += 1) {
      matrix.compose(
        new THREE.Vector3(-4.8 + index * 1.6, -0.08, 0.8),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 1),
      );
      floorTracks.current?.setMatrixAt(index, matrix);
    }
    floorTracks.current!.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <mesh position={[0, -0.36, 1.5]} receiveShadow>
        <boxGeometry args={[15.8, 0.55, 17]} />
        <meshPhysicalMaterial color="#090c0e" metalness={0.9} roughness={0.43} clearcoat={0.18} />
      </mesh>
      <mesh position={[0, -0.055, 0.8]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[13.5, 15]} />
        <meshStandardMaterial color="#171c20" metalness={0.97} roughness={0.28} />
      </mesh>
      <instancedMesh ref={floorTracks} args={[undefined, undefined, 7]}>
        <boxGeometry args={[0.035, 0.025, 14]} />
        <meshBasicMaterial color="#5d3c24" toneMapped={false} />
      </instancedMesh>
      <mesh position={[-7.15, 2.6, 0]} rotation={[0, 0, -0.04]} castShadow>
        <boxGeometry args={[1.05, 6.3, 15]} />
        <meshPhysicalMaterial color={TITANIUM} metalness={0.98} roughness={0.24} clearcoat={0.45} />
      </mesh>
      <mesh position={[7.15, 2.6, 0]} rotation={[0, 0, 0.04]} castShadow>
        <boxGeometry args={[1.05, 6.3, 15]} />
        <meshPhysicalMaterial color={TITANIUM} metalness={0.98} roughness={0.24} clearcoat={0.45} />
      </mesh>
      <mesh position={[0, 5.55, 0]}>
        <boxGeometry args={[15.2, 0.75, 15]} />
        <meshPhysicalMaterial color="#0b0f12" metalness={0.95} roughness={0.32} clearcoat={0.25} />
      </mesh>
      <instancedMesh ref={ribs} args={[undefined, undefined, 9]} castShadow>
        <torusGeometry args={[7.05, 0.13, 6, 24, Math.PI]} />
        <meshPhysicalMaterial color="#586168" metalness={1} roughness={0.18} clearcoat={0.6} />
      </instancedMesh>
      <mesh position={[0, 5.12, 0.2]}>
        <boxGeometry args={[0.1, 0.07, 13.2]} />
        <meshBasicMaterial color="#754721" toneMapped={false} />
      </mesh>
    </group>
  );
}

function SideMachinery({ side }: { side: -1 | 1 }) {
  return (
    <group position={[side * 5.95, 1.2, 0.1]} rotation={[0, side * -0.08, 0]}>
      {[-3.7, -0.7, 2.3].map((z, section) => (
        <group key={z} position={[0, 0, z]}>
          <mesh castShadow>
            <boxGeometry args={[1.35, 2.25, 2.25]} />
            <meshPhysicalMaterial color={section === 1 ? "#171d21" : "#20272c"} metalness={0.96} roughness={0.31} clearcoat={0.24} />
          </mesh>
          <mesh position={[-side * 0.69, 0.25, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[1.45, 0.82]} />
            <meshStandardMaterial color="#090e11" emissive="#22150c" emissiveIntensity={0.5} metalness={0.72} roughness={0.24} />
          </mesh>
          {[-0.42, 0, 0.42].map((offset, light) => (
            <mesh key={offset} position={[-side * 0.705, -0.57, offset]}>
              <sphereGeometry args={[0.045, 8, 8]} />
              <meshBasicMaterial color={light === section ? HOT_AMBER : "#48646a"} toneMapped={false} />
            </mesh>
          ))}
          <mesh position={[-side * 0.72, 0.7, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.19, 0.19, 1.2, 10]} />
            <meshStandardMaterial color={CHROME} metalness={1} roughness={0.18} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 2.2, -0.7]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.62, 0.11, 8, 32]} />
        <meshStandardMaterial color="#495259" metalness={1} roughness={0.22} />
      </mesh>
    </group>
  );
}

function Console({ position, rotation = [0, 0, 0] }: { position: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <boxGeometry args={[2.75, 0.7, 1.25]} />
        <meshPhysicalMaterial color="#161c20" metalness={0.95} roughness={0.26} clearcoat={0.35} />
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
      <mesh position={[-0.86, -0.8, 0]}>
        <boxGeometry args={[0.32, 1.25, 0.74]} />
        <meshStandardMaterial color="#22292e" metalness={0.94} roughness={0.34} />
      </mesh>
      <mesh position={[0.86, -0.8, 0]}>
        <boxGeometry args={[0.32, 1.25, 0.74]} />
        <meshStandardMaterial color="#22292e" metalness={0.94} roughness={0.34} />
      </mesh>
    </group>
  );
}

function IdentityMedallion({ orchestrator, reducedMotion }: OrchestratorCommandDeckProps) {
  const texture = useTexture(orchestrator.logo.src);
  const medallion = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (reducedMotion) return;
    if (medallion.current) medallion.current.position.y = 2.35 + Math.sin(clock.elapsedTime * 0.8) * 0.06;
    if (scan.current) scan.current.rotation.z = clock.elapsedTime * 0.18;
  });

  return (
    <group ref={medallion} position={[0, 2.35, -2.55]}>
      <Billboard>
        <mesh position={[0, 0, -0.08]}>
          <circleGeometry args={[0.88, 48]} />
          <meshPhysicalMaterial color="#080b0d" metalness={0.96} roughness={0.18} clearcoat={0.72} />
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

function CommandDeckScene(props: OrchestratorCommandDeckProps) {
  return (
    <>
      <color attach="background" args={["#030608"]} />
      <fog attach="fog" args={["#05090c", 13, 48]} />
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
    </>
  );
}

export default function OrchestratorCommandDeck(props: OrchestratorCommandDeckProps) {
  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden bg-black/70" aria-label={`${props.orchestrator.name} Nexus command deck`}>
      <Canvas
        dpr={[1, 1.35]}
        shadows
        camera={{ position: [0, 2.45, 11.2], fov: 47, near: 0.1, far: 80 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        className="!absolute !inset-0"
      >
        <Suspense fallback={null}>
          <CommandDeckScene {...props} />
        </Suspense>
      </Canvas>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent_20%,rgba(0,0,0,0.66)_100%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:radial-gradient(rgba(255,255,255,0.7)_0.5px,transparent_0.7px)] [background-size:3px_3px]" />
    </div>
  );
}
