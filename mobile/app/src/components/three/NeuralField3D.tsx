import { useMemo, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { Canvas } from "@/components/three/Canvas";
import { getDotTexture } from "@/components/three/dot-texture";
import { createRandom } from "@/lib/random";

const SILVER_100 = "#dde2e5";
const SILVER_300 = "#aeb6bc";
const OBSIDIAN = "#030507";

type FieldGeometry = {
  positions: Float32Array;
  edges: Float32Array;
  pulses: Float32Array;
};

/** Seeded 3D constellation: points biased toward the viewing plane. */
function buildField(seed: number, count: number, radius: number): FieldGeometry {
  const random = createRandom(seed);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const theta = random() * Math.PI * 2;
    const y = (random() * 2 - 1) * 0.85;
    const horizontal = Math.sqrt(1 - y * y);
    const distance = radius * (0.25 + 0.75 * Math.cbrt(random()));
    points.push(
      new THREE.Vector3(
        Math.cos(theta) * horizontal * distance,
        y * distance * 0.8,
        Math.sin(theta) * horizontal * distance * 0.6,
      ),
    );
  }

  const positions = new Float32Array(count * 3);
  points.forEach((p, i) => p.toArray(positions, i * 3));

  const edgePairs: number[] = [];
  const maxDistance = radius * 0.42;
  points.forEach((point, i) => {
    const near = points
      .map((other, j) => ({ j, d: point.distanceTo(other) }))
      .filter((entry) => entry.j > i && entry.d < maxDistance)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of near) {
      const other = points[j];
      if (!other) continue;
      edgePairs.push(point.x, point.y, point.z, other.x, other.y, other.z);
    }
  });

  const pulsePoints = points.filter((_, i) => i % 9 === 0);
  const pulses = new Float32Array(pulsePoints.length * 3);
  pulsePoints.forEach((p, i) => p.toArray(pulses, i * 3));

  return { positions, edges: new Float32Array(edgePairs), pulses };
}

function FieldScene({
  seed,
  count,
  radius,
  speed,
  coreGlow,
}: {
  seed: number;
  count: number;
  radius: number;
  speed: number;
  coreGlow: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const pulseMaterialRef = useRef<THREE.PointsMaterial>(null);
  const { positions, edges, pulses } = useMemo(
    () => buildField(seed, count, radius),
    [seed, count, radius],
  );

  useFrame((state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * speed;
    }
    if (pulseMaterialRef.current) {
      const t = state.clock.elapsedTime;
      pulseMaterialRef.current.opacity = 0.45 + 0.4 * Math.sin(t * 1.6);
    }
  });

  return (
    <>
      <group ref={groupRef} rotation={[0.18, 0, 0]}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <pointsMaterial
            color={SILVER_100}
            size={radius * 0.035}
            sizeAttenuation
            map={getDotTexture()}
            transparent
            opacity={0.75}
            depthWrite={false}
          />
        </points>
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[edges, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={SILVER_300} transparent opacity={0.14} depthWrite={false} />
        </lineSegments>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[pulses, 3]} />
          </bufferGeometry>
          <pointsMaterial
            ref={pulseMaterialRef}
            color="#ffffff"
            size={radius * 0.055}
            sizeAttenuation
            map={getDotTexture()}
            transparent
            opacity={0.6}
            depthWrite={false}
          />
        </points>
      </group>
      {coreGlow ? (
        <>
          <sprite scale={[radius * 1.1, radius * 1.1, 1]}>
            <spriteMaterial
              map={getDotTexture()}
              color={SILVER_100}
              transparent
              opacity={0.22}
              depthWrite={false}
            />
          </sprite>
          <sprite scale={[radius * 0.22, radius * 0.22, 1]}>
            <spriteMaterial
              map={getDotTexture()}
              color="#ffffff"
              transparent
              opacity={0.95}
              depthWrite={false}
            />
          </sprite>
        </>
      ) : null}
    </>
  );
}

export type NeuralField3DProps = {
  seed?: number;
  /** Number of constellation nodes. */
  count?: number;
  /** Scene radius in world units; controls spread. */
  radius?: number;
  /** Y-rotation speed in radians per second. */
  speed?: number;
  /** Soft specular core at the center of the field. */
  coreGlow?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Reusable monochrome neural background rendered with three.js — a slowly
 * rotating 3D constellation of nodes, filaments, and light pulses,
 * matching web/app's Starfield language.
 */
export function NeuralField3D({
  seed = 7,
  count = 90,
  radius = 5,
  speed = 0.05,
  coreGlow = false,
  style,
}: NeuralField3DProps) {
  return (
    <Canvas
      style={style}
      camera={{ position: [0, 0, radius * 2.1], fov: 46, near: 0.1, far: radius * 8 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
    >
      <color attach="background" args={[OBSIDIAN]} />
      <FieldScene seed={seed} count={count} radius={radius} speed={speed} coreGlow={coreGlow} />
    </Canvas>
  );
}
