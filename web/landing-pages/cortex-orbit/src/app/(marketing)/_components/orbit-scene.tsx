"use client";

import { Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import type { Group, Mesh } from "three";

function Planet() {
  const meshRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.05;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1.35, 64, 64]} />
      <meshStandardMaterial color="#1b1c20" roughness={0.4} metalness={0.35} />
    </mesh>
  );
}

function RingSystem() {
  const groupRef = useRef<Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.z += delta * 0.035;
    }
  });

  return (
    <group ref={groupRef} rotation={[1.32, 0.18, 0.25]}>
      <mesh>
        <torusGeometry args={[1.95, 0.0035, 16, 160]} />
        <meshBasicMaterial color="#f4f5f7" transparent opacity={0.4} />
      </mesh>
      <mesh>
        <torusGeometry args={[2.22, 0.0025, 16, 160]} />
        <meshBasicMaterial color="#f4f5f7" transparent opacity={0.18} />
      </mesh>

      {[0, 2.35, 4.3].map((angle, i) => (
        <mesh
          key={angle}
          position={[Math.cos(angle) * 1.95, Math.sin(angle) * 1.95, 0]}
        >
          <sphereGeometry args={[i === 0 ? 0.028 : 0.018, 16, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.22} />
      <directionalLight position={[-4.5, 3.2, 5]} intensity={2.8} color="#ffffff" />
      <directionalLight position={[3, -2, -4]} intensity={0.2} color="#8a8d98" />
      <pointLight position={[-2.2, 1.7, 3.6]} intensity={6} distance={7} decay={2} color="#ffffff" />

      <Planet />
      <RingSystem />

      <Stars radius={70} depth={40} count={1400} factor={1.7} fade speed={0.4} />
    </>
  );
}

export function OrbitScene() {
  return (
    <Canvas
      camera={{ position: [0, 0.15, 6], fov: 38 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ pointerEvents: "none" }}
    >
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
