import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { getDotTexture } from "@/components/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";

interface StarLayerProps {
  count: number;
  radius: [number, number];
  size: number;
  opacity: number;
  rotationSpeed: number;
  paused: boolean;
  seed: number;
}

function StarLayer({
  count,
  radius,
  size,
  opacity,
  rotationSpeed,
  paused,
  seed,
}: StarLayerProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const random = mulberry32(seed);
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform direction, biased slightly toward the galactic plane.
      const theta = random() * Math.PI * 2;
      const y = (random() * 2 - 1) * 0.75;
      const horizontal = Math.sqrt(1 - y * y);
      const distance = radius[0] + random() * (radius[1] - radius[0]);
      data[i * 3] = Math.cos(theta) * horizontal * distance;
      data[i * 3 + 1] = y * distance;
      data[i * 3 + 2] = Math.sin(theta) * horizontal * distance;
    }
    return data;
  }, [count, radius, seed]);

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
        color="#dde2e5"
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

/** Three depth layers of monochrome stars, thinned for mobile GPUs. */
export function Starfield({ paused }: { paused: boolean }) {
  return (
    <group>
      <StarLayer
        count={520}
        radius={[24, 60]}
        size={0.14}
        opacity={0.75}
        rotationSpeed={0.004}
        paused={paused}
        seed={11}
      />
      <StarLayer
        count={300}
        radius={[16, 30]}
        size={0.1}
        opacity={0.5}
        rotationSpeed={0.007}
        paused={paused}
        seed={29}
      />
      <StarLayer
        count={140}
        radius={[10, 17]}
        size={0.07}
        opacity={0.35}
        rotationSpeed={0.011}
        paused={paused}
        seed={47}
      />
    </group>
  );
}
