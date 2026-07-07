"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";

/**
 * Inside the solar system there are no loose asteroids anymore — just the
 * fine texture of space: drifting micro-debris, rare bright sparks that
 * twinkle, and warm ember motes caught in the sun's glow.
 */

interface ParticleLayerProps {
  seed: number;
  count: number;
  inner: number;
  outer: number;
  ySpread: number;
  size: number;
  color: string;
  baseOpacity: number;
  rotationSpeed: number;
  /** Twinkle frequency (0 = steady). */
  twinkle?: number;
  additive?: boolean;
  paused: boolean;
}

function ParticleLayer({
  seed,
  count,
  inner,
  outer,
  ySpread,
  size,
  color,
  baseOpacity,
  rotationSpeed,
  twinkle = 0,
  additive = false,
  paused,
}: ParticleLayerProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const timeRef = useRef(seed % 10);

  const positions = useMemo(() => {
    const random = mulberry32(seed);
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const distance = inner + random() * (outer - inner);
      data[i * 3] = Math.cos(angle) * distance;
      data[i * 3 + 1] = (random() + random() - 1) * ySpread;
      data[i * 3 + 2] = Math.sin(angle) * distance;
    }
    return data;
  }, [seed, count, inner, outer, ySpread]);

  useFrame((_, delta) => {
    if (paused) return;
    timeRef.current += delta;
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * rotationSpeed;
    }
    if (materialRef.current && twinkle > 0) {
      materialRef.current.opacity =
        baseOpacity * (0.55 + 0.45 * Math.sin(timeRef.current * twinkle));
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        color={color}
        size={size}
        sizeAttenuation
        map={getDotTexture()}
        transparent
        opacity={baseOpacity}
        depthWrite={false}
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </points>
  );
}

export function SystemDebris({
  paused,
  dense,
}: {
  paused: boolean;
  dense: boolean;
}) {
  const scale = dense ? 1 : 0.4;
  const n = (count: number) => Math.round(count * scale);

  return (
    <group>
      {/* fine drifting debris throughout the system */}
      <ParticleLayer
        seed={311}
        count={n(900)}
        inner={2.5}
        outer={14}
        ySpread={1.6}
        size={0.03}
        color="#8f99a1"
        baseOpacity={0.34}
        rotationSpeed={0.012}
        paused={paused}
      />
      <ParticleLayer
        seed={331}
        count={n(500)}
        inner={3}
        outer={13}
        ySpread={2.4}
        size={0.022}
        color="#5f6a73"
        baseOpacity={0.28}
        rotationSpeed={0.008}
        paused={paused}
      />
      {/* rare bright sparks — twinkling energy traces */}
      <ParticleLayer
        seed={353}
        count={n(120)}
        inner={3}
        outer={13.5}
        ySpread={1.8}
        size={0.055}
        color="#f5f7f8"
        baseOpacity={0.7}
        rotationSpeed={0.016}
        twinkle={2.3}
        additive
        paused={paused}
      />
      <ParticleLayer
        seed={359}
        count={n(70)}
        inner={4}
        outer={12}
        ySpread={2}
        size={0.045}
        color="#c2d5e4"
        baseOpacity={0.55}
        rotationSpeed={0.01}
        twinkle={1.4}
        additive
        paused={paused}
      />
      {/* warm ember motes near the sun */}
      <ParticleLayer
        seed={379}
        count={n(140)}
        inner={1.8}
        outer={5}
        ySpread={1}
        size={0.04}
        color="#b06a38"
        baseOpacity={0.5}
        rotationSpeed={0.022}
        twinkle={1.8}
        additive
        paused={paused}
      />
    </group>
  );
}
