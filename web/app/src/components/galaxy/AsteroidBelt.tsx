"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  createAsteroidGeometry,
  createAsteroidMaterial,
  type AsteroidTone,
} from "@/lib/three/asteroid";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";
import { useGalaxyStore } from "@/lib/galaxy-store";

/**
 * The asteroid belt — and beyond. Three regions reach outward from the
 * solar system's edge into the galaxy:
 *  - the MAIN BELT (r 15.4–19.8): dense, clickable — clicking any rock
 *    carries the camera out beyond the belt to circle it from outside;
 *  - the SCATTER FIELD (r 20–30): sparser drifting rocks;
 *  - the DEEP FIELD (r 30–44): faint far shapes and dust.
 * Every layer uses its own seeded geometry plus per-instance scale,
 * rotation, and color jitter, so the population reads as endless
 * variation rather than clones.
 */

export const BELT_INNER = 15.4;
export const BELT_OUTER = 19.8;

interface RockLayerProps {
  seed: number;
  count: number;
  detail: number;
  minScale: number;
  maxScale: number;
  tone: AsteroidTone;
  rotationSpeed: number;
  paused: boolean;
  inner: number;
  outer: number;
  thickness: number;
  /** Bias instances toward the sun-warmed inner edge of the region. */
  innerBias?: boolean;
  /** Main-belt rocks are clickable anchors into belt-exploration mode. */
  clickable?: boolean;
}

function RockLayer({
  seed,
  count,
  detail,
  minScale,
  maxScale,
  tone,
  rotationSpeed,
  paused,
  inner,
  outer,
  thickness,
  innerBias = false,
  clickable = false,
}: RockLayerProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const mode = useGalaxyStore((s) => s.mode);

  const half = (outer - inner) / 2;
  const center = (inner + outer) / 2;

  const geometry = useMemo(
    () => createAsteroidGeometry(seed, { detail, tone, craters: 3 }),
    [seed, detail, tone],
  );
  const material = useMemo(
    // Low rim so rocks read as diffuse-lit stone, not glass bubbles.
    () => createAsteroidMaterial({ tone, rim: 0.14 }),
    [tone],
  );

  const instances = useMemo(() => {
    const random = mulberry32(seed ^ 0xbe17);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];

    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      // Triangular radial distribution → densest mid-region, feathered edges.
      const radialOffset = innerBias
        ? -half * (0.25 + random() * 0.65)
        : (random() + random() - 1) * half;
      const distance = center + radialOffset;
      const taper = 1 - (Math.abs(radialOffset) / half) * 0.3;
      position.set(
        Math.cos(angle) * distance,
        (random() + random() - 1) * thickness * taper,
        Math.sin(angle) * distance,
      );
      rotation.set(
        random() * Math.PI * 2,
        random() * Math.PI * 2,
        random() * Math.PI * 2,
      );
      quaternion.setFromEuler(rotation);
      // Squared bias favors smaller fragments within each tier.
      const s = minScale + (maxScale - minScale) * random() ** 2;
      scale.set(
        s * (0.8 + random() * 0.4),
        s * (0.8 + random() * 0.4),
        s * (0.8 + random() * 0.4),
      );
      matrices.push(matrix.compose(position, quaternion, scale).clone());
      // Per-instance tint jitter: brightness and a whisper of hue drift.
      const brightness = 0.72 + random() * 0.55;
      const warm = random() * 0.08;
      colors.push(
        new THREE.Color(
          brightness * (1 + warm),
          brightness,
          brightness * (1 - warm * 0.6),
        ),
      );
    }
    return { matrices, colors };
  }, [seed, count, innerBias, minScale, maxScale, half, center, thickness]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    instances.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    instances.colors.forEach((color, i) => mesh.setColorAt(i, color));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [instances]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useFrame((_, delta) => {
    if (!paused && meshRef.current) {
      meshRef.current.rotation.y += delta * rotationSpeed;
    }
  });

  const handleClick = clickable
    ? (event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const state = useGalaxyStore.getState();
        // From the solar system AND from the belt, a click dives INTO the
        // rock: every ordinary asteroid hides its own hollow biome (and a
        // few loose fragments).
        if (state.mode !== "system" && state.mode !== "belt") return;
        state.enterRock({
          angle: Math.atan2(event.point.z, event.point.x),
          radius: Math.hypot(event.point.x, event.point.z),
        });
      }
    : undefined;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      // Instances span the whole ring; per-geometry bounds would cull wrongly.
      frustumCulled={false}
      onClick={handleClick}
      onPointerOver={
        clickable && (mode === "system" || mode === "belt")
          ? (event) => {
              event.stopPropagation();
              document.body.style.cursor = "pointer";
            }
          : undefined
      }
      onPointerOut={
        clickable
          ? () => {
              document.body.style.cursor = "auto";
            }
          : undefined
      }
    />
  );
}

/**
 * The ever-growing belt: new rocks continuously condense out of the dust,
 * each one farther out than the last — the ring visibly creeps deeper
 * into the galaxy for as long as you watch. A fixed instance pool recycles
 * the oldest rocks into ever-newer, farther positions, so growth is
 * endless at constant cost.
 */
const GROWTH_CAPACITY = 150;
const GROWTH_EASE_SECONDS = 2.4;

function GrowthLayer({ paused, dense }: { paused: boolean; dense: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const mode = useGalaxyStore((s) => s.mode);
  const stateRef = useRef<{
    random: () => number;
    born: number[];
    scales: number[];
    matrixBases: THREE.Matrix4[];
    nextSlot: number;
    grownTotal: number;
    spawnTimer: number;
    clock: number;
  } | null>(null);

  const capacity = dense ? GROWTH_CAPACITY : Math.round(GROWTH_CAPACITY * 0.4);
  const geometry = useMemo(
    () => createAsteroidGeometry(0x96011, { detail: 1, craters: 2 }),
    [],
  );
  const material = useMemo(
    () => createAsteroidMaterial({ tone: "silver", rim: 0.14 }),
    [],
  );
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh || paused) return;
    if (stateRef.current == null) {
      stateRef.current = {
        random: mulberry32(0x9601),
        born: Array.from({ length: capacity }, () => -1),
        scales: Array.from({ length: capacity }, () => 0),
        matrixBases: Array.from({ length: capacity }, () => new THREE.Matrix4()),
        nextSlot: 0,
        grownTotal: 0,
        spawnTimer: 1.5,
        clock: 0,
      };
    }
    const state = stateRef.current;
    state.clock += delta;
    state.spawnTimer -= delta;

    if (state.spawnTimer <= 0) {
      state.spawnTimer = 2 + state.random() * 3;
      const slot = state.nextSlot;
      state.nextSlot = (state.nextSlot + 1) % capacity;
      state.grownTotal += 1;
      // Each new rock condenses a little farther out; past the fog line the
      // creep loops back through the whole growth band, forever.
      const reach = 21 + (state.grownTotal * 0.4) % 110;
      const angle = state.random() * Math.PI * 2;
      const position = new THREE.Vector3(
        Math.cos(angle) * reach,
        (state.random() * 2 - 1) * (2 + reach * 0.09),
        Math.sin(angle) * reach,
      );
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          state.random() * Math.PI * 2,
          state.random() * Math.PI * 2,
          state.random() * Math.PI * 2,
        ),
      );
      state.matrixBases[slot].compose(
        position,
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      state.scales[slot] = 0.12 + state.random() * 0.55;
      state.born[slot] = state.clock;
    }

    const matrix = new THREE.Matrix4();
    const scaleMatrix = new THREE.Matrix4();
    for (let i = 0; i < capacity; i++) {
      if (state.born[i] < 0) {
        matrix.makeScale(0.0001, 0.0001, 0.0001);
        mesh.setMatrixAt(i, matrix);
        continue;
      }
      const age = state.clock - state.born[i];
      const grow = Math.min(age / GROWTH_EASE_SECONDS, 1);
      const eased = 1 - (1 - grow) ** 3;
      const s = Math.max(state.scales[i] * eased, 0.0001);
      scaleMatrix.makeScale(s, s, s);
      matrix.multiplyMatrices(state.matrixBases[i], scaleMatrix);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.rotation.y += delta * 0.0018;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacity]}
      frustumCulled={false}
      // Even the freshly condensed rocks are enterable worlds.
      onClick={(event) => {
        event.stopPropagation();
        const state = useGalaxyStore.getState();
        if (state.mode !== "system" && state.mode !== "belt") return;
        state.enterRock({
          angle: Math.atan2(event.point.z, event.point.x),
          radius: Math.hypot(event.point.x, event.point.z),
        });
      }}
      onPointerOver={
        mode === "system" || mode === "belt"
          ? (event) => {
              event.stopPropagation();
              document.body.style.cursor = "pointer";
            }
          : undefined
      }
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    />
  );
}

interface DustLayerProps {
  seed: number;
  count: number;
  size: number;
  opacity: number;
  color: string;
  rotationSpeed: number;
  paused: boolean;
  inner: number;
  outer: number;
  thickness: number;
}

function DustLayer({
  seed,
  count,
  size,
  opacity,
  color,
  rotationSpeed,
  paused,
  inner,
  outer,
  thickness,
}: DustLayerProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const half = (outer - inner) / 2;
  const center = (inner + outer) / 2;

  const positions = useMemo(() => {
    const random = mulberry32(seed);
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const distance = center + (random() + random() - 1) * half * 1.1;
      data[i * 3] = Math.cos(angle) * distance;
      data[i * 3 + 1] = (random() + random() - 1) * thickness;
      data[i * 3 + 2] = Math.sin(angle) * distance;
    }
    return data;
  }, [seed, count, half, center, thickness]);

  useFrame((_, delta) => {
    if (!paused && pointsRef.current) {
      pointsRef.current.rotation.y += delta * rotationSpeed;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </points>
  );
}

export function AsteroidBelt({
  paused,
  dense,
}: {
  paused: boolean;
  dense: boolean;
}) {
  const scale = dense ? 1 : 0.35;
  const n = (count: number) => Math.max(4, Math.round(count * scale));

  // Layer recipes: {seed, count, detail, min, max, tone, speed, region}.
  // Ten distinct geometry seeds inside the main belt alone.
  const mainBelt: Array<[number, number, number, number, number, AsteroidTone, number, boolean?]> = [
    [901, 18, 2, 0.42, 0.95, "silver", 0.0045],
    [907, 16, 2, 0.4, 0.85, "silver", 0.005],
    [917, 12, 2, 0.34, 0.7, "ember", 0.005, true],
    [919, 8, 2, 0.3, 0.6, "ember", 0.0042, true],
    [933, 70, 1, 0.18, 0.42, "silver", 0.006],
    [947, 70, 1, 0.16, 0.38, "silver", 0.0035],
    [953, 60, 1, 0.17, 0.4, "silver", 0.0052],
    [961, 170, 1, 0.06, 0.17, "silver", 0.0075],
    [967, 170, 1, 0.05, 0.15, "silver", 0.0058],
    [971, 130, 1, 0.07, 0.18, "silver", 0.0066],
  ];
  // Scatter field: the belt frays outward into the galaxy.
  const scatter: Array<[number, number, number, number, number, AsteroidTone, number]> = [
    [1013, 60, 2, 0.3, 0.85, "silver", 0.003],
    [1019, 110, 1, 0.12, 0.4, "silver", 0.0024],
    [1021, 150, 1, 0.06, 0.2, "silver", 0.0036],
    [1031, 26, 1, 0.2, 0.55, "ember", 0.0028],
  ];
  // Deep field: faint far silhouettes, reaching far into the galaxy.
  const deep: Array<[number, number, number, number, number, AsteroidTone, number]> = [
    [1049, 110, 1, 0.35, 1.4, "silver", 0.0016],
    [1051, 150, 1, 0.15, 0.65, "silver", 0.0021],
    [1061, 50, 1, 0.3, 1.0, "ember", 0.0013],
    [1063, 90, 1, 0.4, 1.7, "silver", 0.001],
  ];

  return (
    <group>
      {mainBelt.map(([seed, count, detail, min, max, tone, speed, innerBias]) => (
        <RockLayer
          key={seed}
          seed={seed}
          count={n(count)}
          detail={detail}
          minScale={min}
          maxScale={max}
          tone={tone}
          rotationSpeed={speed}
          paused={paused}
          inner={BELT_INNER}
          outer={BELT_OUTER}
          thickness={2.6}
          innerBias={innerBias}
          clickable
        />
      ))}
      {scatter.map(([seed, count, detail, min, max, tone, speed]) => (
        <RockLayer
          key={seed}
          seed={seed}
          count={n(count)}
          detail={detail}
          minScale={min}
          maxScale={max}
          tone={tone}
          rotationSpeed={speed}
          paused={paused}
          inner={20}
          outer={30}
          thickness={5}
          clickable
        />
      ))}
      {deep.map(([seed, count, detail, min, max, tone, speed]) => (
        <RockLayer
          key={seed}
          seed={seed}
          count={n(count)}
          detail={detail}
          minScale={min}
          maxScale={max}
          tone={tone}
          rotationSpeed={speed}
          paused={paused}
          inner={30}
          outer={64}
          thickness={10}
          clickable
        />
      ))}

      {/* the belt never stops growing */}
      <GrowthLayer paused={paused} dense={dense} />

      {/* Dust & particles across all three regions. */}
      <DustLayer seed={977} count={n(2400)} size={0.06} opacity={0.38} color="#8f99a1" rotationSpeed={0.008} paused={paused} inner={BELT_INNER} outer={BELT_OUTER} thickness={3} />
      <DustLayer seed={991} count={n(1200)} size={0.045} opacity={0.26} color="#dde2e5" rotationSpeed={0.0055} paused={paused} inner={BELT_INNER} outer={BELT_OUTER} thickness={3} />
      <DustLayer seed={1009} count={n(500)} size={0.055} opacity={0.22} color="#8a5a30" rotationSpeed={0.007} paused={paused} inner={BELT_INNER} outer={BELT_INNER + 2} thickness={2.4} />
      <DustLayer seed={1091} count={n(1600)} size={0.07} opacity={0.2} color="#7b858c" rotationSpeed={0.004} paused={paused} inner={20} outer={30} thickness={5.6} />
      <DustLayer seed={1093} count={n(1400)} size={0.09} opacity={0.14} color="#5f6a73" rotationSpeed={0.0025} paused={paused} inner={30} outer={44} thickness={8.6} />
    </group>
  );
}
