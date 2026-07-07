"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createAsteroidGeometry } from "@/lib/three/asteroid";
import { drainExplosions, queueExplosion } from "@/lib/three/effects-bus";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";
import { BELT_INNER, BELT_OUTER } from "./AsteroidBelt";

/**
 * Shared explosion system: any impact (sun ejecta landing, meteor strike,
 * two belt rocks colliding) bursts an asteroid into tumbling shard
 * fragments with a flash. A fixed pool keeps the cost flat no matter how
 * violent the belt gets. Random rock-on-rock collisions fire on their own
 * cadence so the belt always feels alive.
 */

const BURSTS = 10;
const SHARDS_PER_BURST = 16;
const TOTAL_SHARDS = BURSTS * SHARDS_PER_BURST;
const BURST_LIFE = 1.6;

interface BurstState {
  active: boolean;
  life: number;
  strength: number;
  center: THREE.Vector3;
  velocities: THREE.Vector3[];
  spins: THREE.Vector3[];
  scales: number[];
}

function makeBurstState(): BurstState {
  return {
    active: false,
    life: 0,
    strength: 1,
    center: new THREE.Vector3(),
    velocities: Array.from({ length: SHARDS_PER_BURST }, () => new THREE.Vector3()),
    spins: Array.from({ length: SHARDS_PER_BURST }, () => new THREE.Vector3()),
    scales: Array.from({ length: SHARDS_PER_BURST }, () => 0),
  };
}

export function ExplosionField({ paused }: { paused: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const flashRefs = useRef<Array<THREE.Sprite | null>>([]);
  const burstsRef = useRef<BurstState[] | null>(null);
  const randomRef = useRef(mulberry32(0xb0011));
  const collisionTimerRef = useRef(3);
  if (burstsRef.current == null) {
    burstsRef.current = Array.from({ length: BURSTS }, makeBurstState);
  }

  const geometry = useMemo(
    () => createAsteroidGeometry(0xf5a6, { detail: 1, craters: 1 }),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.4,
        roughness: 0.6,
        emissive: new THREE.Color("#3a2412"),
        emissiveIntensity: 0.8,
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
    const bursts = burstsRef.current;
    if (!mesh || !bursts || paused) return;
    const random = randomRef.current;

    // The belt collides with itself on a loose cadence: two rocks meet,
    // both lose — shards everywhere.
    collisionTimerRef.current -= delta;
    if (collisionTimerRef.current <= 0) {
      collisionTimerRef.current = 2.5 + random() * 4.5;
      const angle = random() * Math.PI * 2;
      const radius = BELT_INNER + random() * (BELT_OUTER - BELT_INNER);
      queueExplosion(
        [
          Math.cos(angle) * radius,
          (random() * 2 - 1) * 2,
          Math.sin(angle) * radius,
        ],
        0.7 + random() * 1.2,
      );
    }

    // Activate queued explosions into free pool slots.
    for (const request of drainExplosions()) {
      const slot = bursts.find((b) => !b.active) ?? bursts[0];
      slot.active = true;
      slot.life = BURST_LIFE;
      slot.strength = request.strength;
      slot.center.set(...request.position);
      for (let i = 0; i < SHARDS_PER_BURST; i++) {
        slot.velocities[i]
          .set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
          .normalize()
          .multiplyScalar((1.2 + random() * 2.6) * request.strength);
        slot.spins[i].set(
          (random() - 0.5) * 6,
          (random() - 0.5) * 6,
          (random() - 0.5) * 6,
        );
        slot.scales[i] = (0.05 + random() * 0.13) * request.strength;
      }
    }

    // Advance every active burst; park inactive shards at zero scale.
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scaleVector = new THREE.Vector3();
    bursts.forEach((burst, burstIndex) => {
      if (burst.active) {
        burst.life -= delta;
        if (burst.life <= 0) burst.active = false;
      }
      const progress = burst.active ? 1 - burst.life / BURST_LIFE : 1;
      const fade = burst.active ? Math.max(0, 1 - progress * progress) : 0;
      for (let i = 0; i < SHARDS_PER_BURST; i++) {
        const index = burstIndex * SHARDS_PER_BURST + i;
        if (!burst.active) {
          matrix.makeScale(0.0001, 0.0001, 0.0001);
          mesh.setMatrixAt(index, matrix);
          continue;
        }
        const t = progress * BURST_LIFE;
        position
          .copy(burst.center)
          .addScaledVector(burst.velocities[i], t);
        euler.set(
          burst.spins[i].x * t,
          burst.spins[i].y * t,
          burst.spins[i].z * t,
        );
        quaternion.setFromEuler(euler);
        scaleVector.setScalar(Math.max(burst.scales[i] * fade, 0.0001));
        mesh.setMatrixAt(
          index,
          matrix.compose(position, quaternion, scaleVector),
        );
      }
      // Impact flash: expands hard, dies fast.
      const flash = flashRefs.current[burstIndex];
      if (flash) {
        if (burst.active && progress < 0.4) {
          flash.visible = true;
          const flashT = progress / 0.4;
          flash.position.copy(burst.center);
          flash.scale.setScalar((0.6 + flashT * 3.2) * burst.strength);
          flash.material.opacity = (1 - flashT) * 0.9;
        } else {
          flash.visible = false;
        }
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, TOTAL_SHARDS]}
        frustumCulled={false}
      />
      {Array.from({ length: BURSTS }, (_, i) => (
        <sprite
          key={i}
          ref={(sprite) => {
            flashRefs.current[i] = sprite;
          }}
          visible={false}
        >
          <spriteMaterial
            map={getDotTexture()}
            color="#ffd9a0"
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
