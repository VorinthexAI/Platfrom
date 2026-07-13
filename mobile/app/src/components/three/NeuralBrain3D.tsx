import { useMemo, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { Canvas } from "@/components/three/Canvas";
import { getDotTexture } from "@/components/three/dot-texture";
import { createRandom } from "@/lib/random";

const SILVER_50 = "#f5f7f8";
const SILVER_300 = "#aeb6bc";
const SILVER_500 = "#7b858c";
const OBSIDIAN = "#030507";

/** Same curve the progress line uses (Reanimated Easing.inOut(cubic)). */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Side-profile brain volume: cerebrum + cerebellum + tapering stem. */
function insideBrain(x: number, y: number, z: number): boolean {
  const cerebrum =
    (x / 1.15) ** 2 + ((y - 0.28) / 0.95) ** 2 + (z / 0.8) ** 2 <= 1;
  const cerebellum =
    ((x - 0.58) / 0.42) ** 2 + ((y + 0.52) / 0.4) ** 2 + (z / 0.34) ** 2 <= 1;
  const stemRadius = Math.max(0.05, 0.16 - (-0.55 - y) * 0.08);
  const stem =
    y <= -0.5 && y >= -1.2 && Math.hypot(x - 0.42 - (y + 0.5) * 0.2, z) <= stemRadius;
  return cerebrum || cerebellum || stem;
}

type BrainGeometry = {
  positions: Float32Array;
  edges: Float32Array;
  pulses: Float32Array;
  streams: Float32Array;
};

function buildBrain(seed: number): BrainGeometry {
  const random = createRandom(seed);
  const points: THREE.Vector3[] = [];
  let guard = 0;
  while (points.length < 240 && guard < 20000) {
    guard += 1;
    const x = (random() * 2 - 1) * 1.3;
    const y = (random() * 2 - 1) * 1.4;
    const z = (random() * 2 - 1) * 0.9;
    if (insideBrain(x, y, z)) points.push(new THREE.Vector3(x, y, z));
  }

  // Center-out reveal order: drawRange walks this sorted list.
  const core = new THREE.Vector3(0, 0.1, 0);
  points.sort((a, b) => a.distanceTo(core) - b.distanceTo(core));

  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => p.toArray(positions, i * 3));

  type Edge = { a: number; b: number; order: number };
  const edgeList: Edge[] = [];
  points.forEach((point, i) => {
    const near = points
      .map((other, j) => ({ j, d: point.distanceTo(other) }))
      .filter((entry) => entry.j > i && entry.d < 0.5)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of near) {
      edgeList.push({ a: i, b: j, order: Math.max(i, j) });
    }
  });
  // Edges appear once both endpoints are revealed.
  edgeList.sort((a, b) => a.order - b.order);
  const edges = new Float32Array(edgeList.length * 6);
  edgeList.forEach((edge, i) => {
    const a = points[edge.a];
    const b = points[edge.b];
    if (!a || !b) return;
    a.toArray(edges, i * 6);
    b.toArray(edges, i * 6 + 3);
  });

  const pulsePoints = points.filter((_, i) => i % 14 === 0);
  const pulses = new Float32Array(pulsePoints.length * 3);
  pulsePoints.forEach((p, i) => p.toArray(pulses, i * 3));

  // Filament streams descending from the stem toward the progress line,
  // flattened into one segment list so a single material drives them all.
  const streamSegments: number[] = [];
  [-0.06, 0, 0.06].forEach((offset, s) => {
    const sway = (random() - 0.5) * 0.5;
    const top = new THREE.Vector3(0.32 + offset * 2, -1.05, offset);
    const segments = 14;
    let prevX = top.x;
    let prevY = top.y;
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const y = top.y - t * 1.7;
      const x = top.x + Math.sin(t * Math.PI * (1.3 + s * 0.3)) * sway * t;
      streamSegments.push(prevX, prevY, top.z, x, y, top.z);
      prevX = x;
      prevY = y;
    }
  });

  return { positions, edges, pulses, streams: new Float32Array(streamSegments) };
}

function BrainScene({ seed, durationMs }: { seed: number; durationMs: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const pointsGeometryRef = useRef<THREE.BufferGeometry>(null);
  const edgesGeometryRef = useRef<THREE.BufferGeometry>(null);
  const pulseMaterialRef = useRef<THREE.PointsMaterial>(null);
  const streamMaterialRef = useRef<THREE.LineBasicMaterial>(null);

  const { positions, edges, pulses, streams } = useMemo(() => buildBrain(seed), [seed]);
  const pointCount = positions.length / 3;
  const edgeCount = edges.length / 6;

  useFrame((state) => {
    const progress = easeInOutCubic(
      Math.min(1, (state.clock.elapsedTime * 1000) / durationMs),
    );

    if (pointsGeometryRef.current) {
      pointsGeometryRef.current.setDrawRange(0, Math.floor(pointCount * progress));
    }
    if (edgesGeometryRef.current) {
      edgesGeometryRef.current.setDrawRange(0, Math.floor(edgeCount * progress) * 2);
    }
    if (pulseMaterialRef.current) {
      const t = state.clock.elapsedTime;
      pulseMaterialRef.current.opacity = progress * (0.55 + 0.4 * Math.sin(t * 2.1));
    }
    if (streamMaterialRef.current) {
      streamMaterialRef.current.opacity =
        Math.max(0, Math.min(1, (progress - 0.75) / 0.25)) * 0.4;
    }
    if (groupRef.current) {
      // Gentle sway keeps the profile readable while showing its depth.
      groupRef.current.rotation.y = 0.55 * Math.sin(state.clock.elapsedTime * 0.4);
    }
  });

  return (
    <group ref={groupRef}>
      <points>
        <bufferGeometry ref={pointsGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={SILVER_50}
          size={0.075}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.85}
          depthWrite={false}
        />
      </points>
      <lineSegments>
        <bufferGeometry ref={edgesGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[edges, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={SILVER_300} transparent opacity={0.22} depthWrite={false} />
      </lineSegments>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pulses, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={pulseMaterialRef}
          color="#ffffff"
          size={0.13}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </points>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[streams, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={streamMaterialRef}
          color={SILVER_500}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

export type NeuralBrain3DProps = {
  /** Total build duration; the reveal eases in sync with the progress line. */
  durationMs: number;
  seed?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Monochrome neural brain rendered with three.js: a 3D point-cloud brain
 * assembling center-out from nodes, filaments, and light pulses.
 */
export function NeuralBrain3D({ durationMs, seed = 19, style }: NeuralBrain3DProps) {
  return (
    <Canvas
      style={style}
      camera={{ position: [0, -0.2, 4.4], fov: 45, near: 0.1, far: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
    >
      <color attach="background" args={[OBSIDIAN]} />
      <BrainScene seed={seed} durationMs={durationMs} />
    </Canvas>
  );
}
