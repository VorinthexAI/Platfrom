import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import * as THREE from "three";

import { Canvas } from "@/components/three/Canvas";

type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];

const OBSIDIAN = "#030507";
const SILVER = "#e5eef2";
const CENTER: Point2 = [192, 408];
const PIXELS_PER_WORLD_UNIT = 104;

const UPPER_RIGHT: readonly Point2[] = [
  CENTER,
  [214, 384],
  [236, 359],
  [258, 335],
  [281, 311],
  [298, 292],
  [314, 275],
];
const LOWER_RIGHT: readonly Point2[] = [
  CENTER,
  [217, 429],
  [241, 451],
  [264, 473],
  [287, 494],
  [307, 511],
  [327, 524],
];
const DOWN: readonly Point2[] = [
  CENTER,
  [192, 445],
  [192, 482],
  [192, 521],
  [192, 563],
  [192, 607],
  [192, 653],
];

function mirror([x, y]: Point2): Point2 {
  return [384 - x, y];
}

function toWorld([x, y]: Point2, z = 0): Point3 {
  return [
    (x - CENTER[0]) / PIXELS_PER_WORLD_UNIT,
    (CENTER[1] - y) / PIXELS_PER_WORLD_UNIT,
    z,
  ];
}

const UPPER_LEFT = UPPER_RIGHT.map(mirror);
const LOWER_LEFT = LOWER_RIGHT.map(mirror);
const MAIN_PATHS = [UPPER_RIGHT, UPPER_LEFT, LOWER_RIGHT, LOWER_LEFT, DOWN];
const CURVES = MAIN_PATHS.map(
  (path, index) =>
    new THREE.CatmullRomCurve3(
      path.map((point, pointIndex) => {
        const depth = index === 4 ? 0 : Math.sin((pointIndex / (path.length - 1)) * Math.PI) * 0.08;
        return new THREE.Vector3(...toWorld(point, depth));
      }),
      false,
      "centripetal",
    ),
);

const RIGHT_CELLS: readonly (readonly Point2[])[] = [
  [UPPER_RIGHT[1]!, [227, 393], UPPER_RIGHT[2]!],
  [UPPER_RIGHT[2]!, [247, 371], UPPER_RIGHT[3]!],
  [UPPER_RIGHT[3]!, [271, 349], UPPER_RIGHT[4]!],
  [UPPER_RIGHT[4]!, [294, 326], UPPER_RIGHT[5]!],
  [LOWER_RIGHT[1]!, [230, 416], LOWER_RIGHT[2]!],
  [LOWER_RIGHT[2]!, [253, 438], LOWER_RIGHT[3]!],
  [LOWER_RIGHT[3]!, [278, 459], LOWER_RIGHT[4]!],
  [LOWER_RIGHT[4]!, [302, 480], LOWER_RIGHT[5]!],
];
const SIDE_CELLS = [...RIGHT_CELLS, ...RIGHT_CELLS.map((cell) => cell.map(mirror))];
const DOWN_CELLS: readonly (readonly Point2[])[] = [
  [DOWN[2]!, [176, 501], DOWN[3]!],
  [DOWN[2]!, [208, 501], DOWN[3]!],
];
const RIGHT_TWIGS: readonly (readonly Point2[])[] = [
  [UPPER_RIGHT[3]!, [273, 327], [284, 321]],
  [UPPER_RIGHT[5]!, [305, 280], [311, 267]],
  [LOWER_RIGHT[3]!, [280, 481], [290, 488]],
  [LOWER_RIGHT[5]!, [315, 520], [324, 535]],
];
const TWIGS = [...RIGHT_TWIGS, ...RIGHT_TWIGS.map((twig) => twig.map(mirror))];
const SECONDARY_PATHS = [...SIDE_CELLS, ...DOWN_CELLS, ...TWIGS];

function segmentPositions(paths: readonly (readonly Point2[])[]) {
  const positions: number[] = [];
  for (const path of paths) {
    for (let index = 1; index < path.length; index += 1) {
      positions.push(...toWorld(path[index - 1]!), ...toWorld(path[index]!));
    }
  }
  return new Float32Array(positions);
}

function curveSegmentPositions() {
  const positions: number[] = [];
  for (const curve of CURVES) {
    const samples = curve.getPoints(48);
    for (let index = 1; index < samples.length; index += 1) {
      positions.push(...samples[index - 1]!.toArray(), ...samples[index]!.toArray());
    }
  }
  return new Float32Array(positions);
}

function nodePositions() {
  const positions: number[] = [];
  for (const path of [...MAIN_PATHS, ...SECONDARY_PATHS]) {
    for (const point of path) positions.push(...toWorld(point, 0.05));
  }
  return new Float32Array(positions);
}

function particleFieldPositions() {
  const positions: number[] = [];
  let seed = 0x19106;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (const [curveIndex, curve] of CURVES.entries()) {
    for (let index = 0; index < 16; index += 1) {
      const point = curve.getPointAt(0.08 + random() * 0.9);
      const spread = curveIndex === 4 ? 0.13 : 0.2;
      const xOffset = (random() - 0.5) * spread;
      positions.push(
        point.x + xOffset,
        point.y + (random() - 0.5) * spread,
        (random() - 0.5) * 0.45,
      );
    }
  }

  for (let index = 0; index < 28; index += 1) {
    const x = 0.12 + random() * 1.25;
    const y = (random() - 0.5) * 2.25;
    const z = (random() - 0.5) * 0.65;
    positions.push(x, y, z, -x, y, z);
  }
  return new Float32Array(positions);
}

const MAIN_SEGMENTS = curveSegmentPositions();
const SECONDARY_SEGMENTS = segmentPositions(SECONDARY_PATHS);
const NODES = nodePositions();
const PARTICLE_FIELD = particleFieldPositions();

type FlowParticleProps = {
  curve: THREE.CatmullRomCurve3;
  offset: number;
  speed: number;
};

function FlowParticle({ curve, offset, speed }: FlowParticleProps) {
  const particleRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    const progress = (elapsed * speed + offset) % 1;
    const particle = particleRef.current;
    if (!particle) return;
    particle.position.copy(curve.getPointAt(progress));
    const pulse = 0.84 + Math.sin(elapsed * 3.2 + offset * 9) * 0.18;
    particle.scale.setScalar(pulse);
  });

  return (
    <group ref={particleRef}>
      <mesh>
        <sphereGeometry args={[0.018, 8, 8]} />
        <meshBasicMaterial color="#f7fcff" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.055, 10, 10]} />
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          color="#a9ddf5"
          depthWrite={false}
          opacity={0.12}
          transparent
        />
      </mesh>
    </group>
  );
}

function NeuralStar() {
  const mainMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const secondaryMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const nodeMaterialRef = useRef<THREE.PointsMaterial>(null);
  const fieldMaterialRef = useRef<THREE.PointsMaterial>(null);
  const glowGroupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    const pulse = (Math.sin(elapsed * 1.15) + 1) / 2;
    if (mainMaterialRef.current) mainMaterialRef.current.opacity = 0.34 + pulse * 0.14;
    if (secondaryMaterialRef.current) secondaryMaterialRef.current.opacity = 0.18 + pulse * 0.08;
    if (nodeMaterialRef.current) nodeMaterialRef.current.opacity = 0.48 + pulse * 0.28;
    if (fieldMaterialRef.current) fieldMaterialRef.current.opacity = 0.2 + pulse * 0.13;
    glowGroupRef.current?.children.forEach((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) {
        child.material.opacity = 0.055 + pulse * 0.045;
      }
    });
  });

  return (
    <group>
      <group ref={glowGroupRef}>
        {CURVES.map((curve, index) => (
          <mesh key={`glow-${index}`}>
            <tubeGeometry args={[curve, 56, 0.018, 5, false]} />
            <meshBasicMaterial
              blending={THREE.AdditiveBlending}
              color="#9fd9f2"
              depthWrite={false}
              opacity={0.08}
              transparent
            />
          </mesh>
        ))}
      </group>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[MAIN_SEGMENTS, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={mainMaterialRef}
          blending={THREE.AdditiveBlending}
          color={SILVER}
          depthWrite={false}
          opacity={0.42}
          transparent
        />
      </lineSegments>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[SECONDARY_SEGMENTS, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={secondaryMaterialRef}
          blending={THREE.AdditiveBlending}
          color="#c5dde8"
          depthWrite={false}
          opacity={0.22}
          transparent
        />
      </lineSegments>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[NODES, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={nodeMaterialRef}
          blending={THREE.AdditiveBlending}
          color="#f4fbff"
          depthWrite={false}
          opacity={0.62}
          size={0.045}
          sizeAttenuation
          transparent
        />
      </points>

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[PARTICLE_FIELD, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={fieldMaterialRef}
          blending={THREE.AdditiveBlending}
          color="#c8e8f6"
          depthWrite={false}
          opacity={0.3}
          size={0.033}
          sizeAttenuation
          transparent
        />
      </points>

      {CURVES.flatMap((curve, curveIndex) =>
        [0.12, 0.45, 0.78].map((offset, particleIndex) => (
          <FlowParticle
            curve={curve}
            key={`flow-${curveIndex}-${particleIndex}`}
            offset={(offset + curveIndex * 0.13) % 1}
            speed={0.045 + particleIndex * 0.012}
          />
        )),
      )}
    </group>
  );
}

export type PersonalAIStar3DProps = {
  style?: StyleProp<ViewStyle>;
};

export function PersonalAIStar3D({ style }: PersonalAIStar3DProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 9.4], fov: 46, near: 0.1, far: 40 }}
      dpr={[1, 1.6]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={[styles.canvas, style]}
    >
      <color attach="background" args={[OBSIDIAN]} />
      <NeuralStar />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: OBSIDIAN,
  },
});
