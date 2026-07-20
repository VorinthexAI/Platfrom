"use client";

import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const TOTAL_POINTS = 720;
const NEIGHBOR_LINKS = 3;
const EDGE_CAP = 0.34;
const GLOBE_RADIUS = 1.12;
const STATION_SCALE = 0.78;

type BrainGeometry = {
  positions: Float32Array;
  edges: Float32Array;
  pulses: Float32Array;
};

export type NexusBrainCoreProps = {
  selected: boolean;
  active: boolean;
  paused: boolean;
  onSelect: () => void;
  onEnter: () => void;
};

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBrainCore(): BrainGeometry {
  const random = createRandom(19);
  const points: THREE.Vector3[] = [];

  const unitDirection = () => {
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
    const inverseLength = 1 / Math.sqrt(lengthSq);
    return new THREE.Vector3(x * inverseLength, y * inverseLength, z * inverseLength);
  };

  for (let index = 0; index < TOTAL_POINTS; index += 1) {
    const radius = GLOBE_RADIUS * (1 + (random() - 0.5) * 0.03);
    points.push(unitDirection().multiplyScalar(radius));
  }

  const pole = new THREE.Vector3(0, GLOBE_RADIUS, 0);
  points.sort((left, right) => left.distanceTo(pole) - right.distanceTo(pole));

  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => point.toArray(positions, index * 3));

  const edgeList: Array<{ a: number; b: number; order: number }> = [];
  const seen = new Set<number>();
  points.forEach((point, index) => {
    const nearest = points
      .map((other, otherIndex) => ({ otherIndex, distance: point.distanceTo(other) }))
      .filter(({ otherIndex, distance }) => otherIndex !== index && distance < EDGE_CAP)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, NEIGHBOR_LINKS);

    for (const { otherIndex } of nearest) {
      const key = index < otherIndex
        ? index * TOTAL_POINTS + otherIndex
        : otherIndex * TOTAL_POINTS + index;
      if (seen.has(key)) continue;
      seen.add(key);
      edgeList.push({ a: index, b: otherIndex, order: Math.max(index, otherIndex) });
    }
  });

  edgeList.sort((left, right) => left.order - right.order);
  const edges = new Float32Array(edgeList.length * 6);
  edgeList.forEach((edge, index) => {
    points[edge.a]?.toArray(edges, index * 6);
    points[edge.b]?.toArray(edges, index * 6 + 3);
  });

  const pulsePoints = points.filter((_, index) => index % 16 === 0);
  const pulses = new Float32Array(pulsePoints.length * 3);
  pulsePoints.forEach((point, index) => point.toArray(pulses, index * 3));

  return { positions, edges, pulses };
}

function createDotTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const alpha = distance >= 1 ? 0 : 1 - distance;
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(255 * alpha * alpha * (3 - 2 * alpha));
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export default function NexusBrainCore({
  selected,
  active,
  paused,
  onSelect,
  onEnter,
}: NexusBrainCoreProps) {
  const groupRef = useRef<THREE.Group>(null);
  const pulseMaterialRef = useRef<THREE.PointsMaterial>(null);
  const reducedMotion = Boolean(useReducedMotion());
  const motionPaused = paused || reducedMotion;
  const energized = active || selected;

  const resources = useMemo(() => {
    const brain = buildBrainCore();
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute("position", new THREE.BufferAttribute(brain.positions, 3));
    const edgesGeometry = new THREE.BufferGeometry();
    edgesGeometry.setAttribute("position", new THREE.BufferAttribute(brain.edges, 3));
    const pulseGeometry = new THREE.BufferGeometry();
    pulseGeometry.setAttribute("position", new THREE.BufferAttribute(brain.pulses, 3));
    return { pointsGeometry, edgesGeometry, pulseGeometry, texture: createDotTexture() };
  }, []);

  useEffect(() => () => {
    resources.pointsGeometry.dispose();
    resources.edgesGeometry.dispose();
    resources.pulseGeometry.dispose();
    resources.texture.dispose();
  }, [resources]);

  useFrame(({ clock }, delta) => {
    if (groupRef.current) {
      if (!motionPaused) groupRef.current.rotation.y += delta * 0.12;
      const targetScale = STATION_SCALE * (selected ? 1.06 : 1);
      const scale = THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 7, delta);
      groupRef.current.scale.setScalar(scale);
    }
    if (pulseMaterialRef.current) {
      pulseMaterialRef.current.opacity = motionPaused
        ? (energized ? 0.78 : 0.58)
        : 0.55 + 0.4 * Math.sin(clock.elapsedTime * 2.1);
    }
  });

  const activate = () => {
    onSelect();
    onEnter();
  };
  const handlePointerClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta <= 8) activate();
  };

  return (
    <group ref={groupRef} scale={STATION_SCALE}>
      <points geometry={resources.pointsGeometry}>
        <pointsMaterial
          color={selected ? "#ffe0a3" : active ? "#ffc267" : "#e8edf0"}
          size={0.05}
          sizeAttenuation
          map={resources.texture}
          transparent
          opacity={energized ? 0.98 : 0.9}
          depthWrite={false}
          toneMapped={false}
        />
      </points>
      <lineSegments geometry={resources.edgesGeometry}>
        <lineBasicMaterial
          color={selected ? "#e89a42" : active ? "#c7833d" : "#b8c0c5"}
          transparent
          opacity={energized ? 0.42 : 0.31}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <points geometry={resources.pulseGeometry}>
        <pointsMaterial
          ref={pulseMaterialRef}
          color={energized ? "#fff0bd" : "#ffbb66"}
          size={0.11}
          sizeAttenuation
          map={resources.texture}
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </points>

      <mesh
        onClick={handlePointerClick}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[1.38, 16, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      <Html center position={[0, -1.48, 0]} distanceFactor={10} zIndexRange={[20, 0]}>
        <button
          id="entity-control-product-core"
          type="button"
          tabIndex={-1}
          aria-label="Enter Core, Your AI Brain"
          aria-pressed={selected}
          onFocus={onSelect}
          onClick={(event) => {
            event.stopPropagation();
            activate();
          }}
          className="flex min-w-[112px] flex-col items-center rounded-md px-3 py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-[#ffc267] focus-visible:shadow-[0_0_20px_rgba(255,160,54,0.65)]"
        >
          <span className={`font-mono text-[0.55rem] tracking-[0.24em] uppercase ${energized ? "text-[#ffd18a]" : "text-[#d8dde0]"}`}>
            Core
          </span>
          <span className={`mt-0.5 whitespace-nowrap text-[0.62rem] font-medium tracking-[0.12em] ${energized ? "text-[#fff0d1]" : "text-[#b9c0c5]"}`}>
            Your AI Brain
          </span>
        </button>
      </Html>
    </group>
  );
}
