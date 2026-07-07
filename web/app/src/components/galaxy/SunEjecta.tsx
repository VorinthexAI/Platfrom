"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createAsteroidGeometry } from "@/lib/three/asteroid";
import { queueExplosion } from "@/lib/three/effects-bus";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";
import { BELT_INNER, BELT_OUTER } from "./AsteroidBelt";

/**
 * The pulsing sun spits molten ejecta — small sparks and big lava chunks
 * that arc out through the system. Chunks that reach the belt detonate
 * against the rock there (via the shared explosion pool); the rest burn
 * out quietly in the deep field.
 */

const CHUNKS = 12;

interface ChunkState {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  size: number;
  /** Radius at which this chunk hits belt rock (0 = sails through). */
  impactRadius: number;
  age: number;
}

function makeChunk(): ChunkState {
  return {
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    size: 0.1,
    impactRadius: 0,
    age: 0,
  };
}

export function SunEjecta({ paused }: { paused: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowRefs = useRef<Array<THREE.Sprite | null>>([]);
  const chunksRef = useRef<ChunkState[] | null>(null);
  const randomRef = useRef(mulberry32(0x1afa));
  const spawnTimerRef = useRef(1.2);
  if (chunksRef.current == null) {
    chunksRef.current = Array.from({ length: CHUNKS }, makeChunk);
  }

  const geometry = useMemo(
    () => createAsteroidGeometry(0xe1ec7, { detail: 1, craters: 0, tone: "ember" }),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.1,
        roughness: 0.5,
        emissive: new THREE.Color("#e8842e"),
        emissiveIntensity: 1.7,
      }),
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
    const chunks = chunksRef.current;
    if (!mesh || !chunks || paused) return;
    const random = randomRef.current;

    // Eruptions ride the sun's heartbeat cadence.
    spawnTimerRef.current -= delta;
    if (spawnTimerRef.current <= 0) {
      spawnTimerRef.current = 0.5 + random() * 1.4;
      const chunk = chunks.find((c) => !c.active);
      if (chunk) {
        const angle = random() * Math.PI * 2;
        const lift = (random() * 2 - 1) * 0.55;
        const dir = new THREE.Vector3(
          Math.cos(angle),
          lift,
          Math.sin(angle),
        ).normalize();
        chunk.active = true;
        chunk.age = 0;
        chunk.position.copy(dir).multiplyScalar(1.5);
        chunk.velocity.copy(dir).multiplyScalar(3.2 + random() * 5.5);
        chunk.spin.set(
          (random() - 0.5) * 5,
          (random() - 0.5) * 5,
          (random() - 0.5) * 5,
        );
        // Small sparks and big lava boulders alike.
        chunk.size = random() < 0.3 ? 0.18 + random() * 0.14 : 0.05 + random() * 0.08;
        // ~65% of chunks meet belt rock; the rest thread the gaps.
        chunk.impactRadius =
          random() < 0.65 ? BELT_INNER + random() * (BELT_OUTER - BELT_INNER) : 0;
      }
    }

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scaleVector = new THREE.Vector3();
    chunks.forEach((chunk, index) => {
      if (chunk.active) {
        chunk.age += delta;
        chunk.position.addScaledVector(chunk.velocity, delta);
        const r = chunk.position.length();
        if (chunk.impactRadius > 0 && r >= chunk.impactRadius) {
          // Lava meets rock: detonate into shards.
          queueExplosion(
            [chunk.position.x, chunk.position.y, chunk.position.z],
            0.8 + chunk.size * 5,
          );
          chunk.active = false;
        } else if (r > 34 || chunk.age > 14) {
          chunk.active = false;
        }
      }
      if (!chunk.active) {
        matrix.makeScale(0.0001, 0.0001, 0.0001);
        mesh.setMatrixAt(index, matrix);
      } else {
        euler.set(
          chunk.spin.x * chunk.age,
          chunk.spin.y * chunk.age,
          chunk.spin.z * chunk.age,
        );
        quaternion.setFromEuler(euler);
        scaleVector.setScalar(chunk.size);
        mesh.setMatrixAt(
          index,
          matrix.compose(chunk.position, quaternion, scaleVector),
        );
      }
      const glow = glowRefs.current[index];
      if (glow) {
        glow.visible = chunk.active;
        if (chunk.active) {
          glow.position.copy(chunk.position);
          glow.scale.setScalar(chunk.size * 6);
          glow.material.opacity = 0.4 + Math.sin(chunk.age * 6) * 0.12;
        }
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, CHUNKS]}
        frustumCulled={false}
      />
      {Array.from({ length: CHUNKS }, (_, i) => (
        <sprite
          key={i}
          ref={(sprite) => {
            glowRefs.current[i] = sprite;
          }}
          visible={false}
        >
          <spriteMaterial
            map={getDotTexture()}
            color="#ffb25c"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}
