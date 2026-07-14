import { useMemo, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { Canvas } from "@/components/three/Canvas";
import { getDotTexture } from "@/components/three/dot-texture";
import { createRandom } from "@/lib/random";

const SILVER_50 = "#f5f7f8";
const SILVER_300 = "#aeb6bc";
const OBSIDIAN = "#030507";

const TOTAL_POINTS = 720;
const NEIGHBOR_LINKS = 3;
const EDGE_CAP = 0.34;
const HEMISPHERE_GAP = 0.07;

/** Same curve the progress line uses (Reanimated Easing.inOut(cubic)). */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const CEREBRUM_CENTER = new THREE.Vector3(0, 0.28, 0);
const CEREBRUM_RADII = new THREE.Vector3(1.15, 0.95, 0.8);
const CEREBELLUM_CENTER = new THREE.Vector3(0.58, -0.52, 0);
const CEREBELLUM_RADII = new THREE.Vector3(0.42, 0.4, 0.34);

function insideEllipsoid(
  p: THREE.Vector3,
  center: THREE.Vector3,
  radii: THREE.Vector3,
  shrink = 0.96,
): boolean {
  return (
    ((p.x - center.x) / (radii.x * shrink)) ** 2 +
      ((p.y - center.y) / (radii.y * shrink)) ** 2 +
      ((p.z - center.z) / (radii.z * shrink)) ** 2 <=
    1
  );
}

type BrainGeometry = {
  positions: Float32Array;
  edges: Float32Array;
  pulses: Float32Array;
};

/**
 * Surface-sampled brain shell: unlike the old volume cloud, every node sits
 * ON the cortex so nearest-neighbor filaments triangulate into a readable
 * anatomical silhouette — cerebrum with folded cortex and a sagittal
 * hemisphere fissure, finer-grained cerebellum, tapering stem.
 */
function buildBrainCore(seed: number): BrainGeometry {
  const random = createRandom(seed);
  const phase = Array.from({ length: 6 }, () => random() * Math.PI * 2);
  const points: THREE.Vector3[] = [];

  const unitDirection = () => {
    // Normalized gaussian triple — uniform direction on the sphere.
    let x = 0;
    let y = 0;
    let z = 0;
    let lengthSq = 0;
    do {
      x = random() * 2 - 1;
      y = random() * 2 - 1;
      z = random() * 2 - 1;
      lengthSq = x * x + y * y + z * z;
    } while (lengthSq < 0.001 || lengthSq > 1);
    const inv = 1 / Math.sqrt(lengthSq);
    return new THREE.Vector3(x * inv, y * inv, z * inv);
  };

  const cerebrumCount = Math.floor(TOTAL_POINTS * 0.78);
  const cerebellumCount = Math.floor(TOTAL_POINTS * 0.16);
  const stemCount = TOTAL_POINTS - cerebrumCount - cerebellumCount;

  let guard = 0;
  while (points.length < cerebrumCount && guard < 20000) {
    guard += 1;
    const dir = unitDirection();
    const raw = dir.clone().multiply(CEREBRUM_RADII);
    // Cortical folds: low-frequency radial swell/dip over the shell.
    const fold =
      1 +
      0.055 * Math.sin(raw.x * 6.8 + phase[0]!) * Math.sin(raw.y * 5.9 + phase[1]!) +
      0.035 * Math.sin((raw.x + raw.z) * 8.4 + phase[2]!);
    const offset = raw.multiplyScalar(fold);
    // Sagittal fissure: keep both hemispheres clear of the midline plane.
    if (Math.abs(offset.z) < HEMISPHERE_GAP) {
      offset.z = Math.sign(offset.z || 1) * HEMISPHERE_GAP;
      offset.multiplyScalar(0.97);
    }
    const p = offset.add(CEREBRUM_CENTER);
    if (insideEllipsoid(p, CEREBELLUM_CENTER, CEREBELLUM_RADII)) continue;
    points.push(p);
  }

  guard = 0;
  while (points.length < cerebrumCount + cerebellumCount && guard < 8000) {
    guard += 1;
    const dir = unitDirection();
    const raw = dir.clone().multiply(CEREBELLUM_RADII);
    // Finer folia texture than the cortex above it.
    const fold =
      1 + 0.04 * Math.sin(raw.x * 12.4 + phase[3]!) * Math.sin(raw.y * 11.2 + phase[4]!);
    const p = raw.multiplyScalar(fold).add(CEREBELLUM_CENTER);
    if (insideEllipsoid(p, CEREBRUM_CENTER, CEREBRUM_RADII)) continue;
    points.push(p);
  }

  for (let i = 0; i < stemCount; i += 1) {
    const t = random();
    const y = -0.5 - 0.7 * t;
    const radius = Math.max(0.05, 0.16 - (-0.55 - y) * 0.08);
    const angle = random() * Math.PI * 2;
    const centerX = 0.42 + (y + 0.5) * 0.2;
    points.push(
      new THREE.Vector3(
        centerX + Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius,
      ),
    );
  }

  // Center-out reveal order: drawRange walks this sorted list.
  const core = new THREE.Vector3(0, 0.1, 0);
  points.sort((a, b) => a.distanceTo(core) - b.distanceTo(core));

  const positions = new Float32Array(points.length * 3);
  points.forEach((p, i) => p.toArray(positions, i * 3));

  type Edge = { a: number; b: number; order: number };
  const edgeList: Edge[] = [];
  const seen = new Set<number>();
  points.forEach((point, i) => {
    const near = points
      .map((other, j) => ({ j, d: point.distanceTo(other) }))
      .filter((entry) => entry.j !== i && entry.d < EDGE_CAP)
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBOR_LINKS);
    for (const { j } of near) {
      const key = i < j ? i * TOTAL_POINTS + j : j * TOTAL_POINTS + i;
      if (seen.has(key)) continue;
      seen.add(key);
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

  const pulsePoints = points.filter((_, i) => i % 16 === 0);
  const pulses = new Float32Array(pulsePoints.length * 3);
  pulsePoints.forEach((p, i) => p.toArray(pulses, i * 3));

  return { positions, edges, pulses };
}

export type BrainCoreObjectProps = {
  seed?: number;
  /** Reveal duration; omit to render the brain fully assembled. */
  durationMs?: number;
  /** "sway" oscillates for the profile view; "spin" turns continuously. */
  motion?: "sway" | "spin";
  scale?: number;
};

/** The brain as a plain three.js group — mount inside any existing Canvas. */
export function BrainCoreObject({
  seed = 19,
  durationMs,
  motion = "sway",
  scale = 1,
}: BrainCoreObjectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const pointsGeometryRef = useRef<THREE.BufferGeometry>(null);
  const edgesGeometryRef = useRef<THREE.BufferGeometry>(null);
  const pulseMaterialRef = useRef<THREE.PointsMaterial>(null);

  const { positions, edges, pulses } = useMemo(() => buildBrainCore(seed), [seed]);
  const pointCount = positions.length / 3;
  const edgeCount = edges.length / 6;

  useFrame((state, delta) => {
    const progress = durationMs
      ? easeInOutCubic(Math.min(1, (state.clock.elapsedTime * 1000) / durationMs))
      : 1;

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
    if (groupRef.current) {
      if (motion === "spin") {
        groupRef.current.rotation.y += delta * 0.12;
      } else {
        // Gentle sway keeps the profile readable while showing its depth.
        groupRef.current.rotation.y = 0.55 * Math.sin(state.clock.elapsedTime * 0.4);
      }
    }
  });

  return (
    <group ref={groupRef} scale={scale}>
      <points>
        <bufferGeometry ref={pointsGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={SILVER_50}
          size={0.05}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0.9}
          depthWrite={false}
        />
      </points>
      <lineSegments>
        <bufferGeometry ref={edgesGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[edges, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={SILVER_300} transparent opacity={0.28} depthWrite={false} />
      </lineSegments>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pulses, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={pulseMaterialRef}
          color="#ffffff"
          size={0.11}
          sizeAttenuation
          map={getDotTexture()}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

export type BrainCore3DProps = BrainCoreObjectProps & {
  style?: StyleProp<ViewStyle>;
};

/**
 * Monochrome wireframe brain rendered with three.js: a dense surface shell
 * of nodes and filaments assembling center-out into the cortex.
 */
export function BrainCore3D({ style, ...props }: BrainCore3DProps) {
  return (
    <Canvas
      style={style}
      camera={{ position: [0, -0.2, 4.4], fov: 45, near: 0.1, far: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
    >
      <color attach="background" args={[OBSIDIAN]} />
      <BrainCoreObject {...props} />
    </Canvas>
  );
}
