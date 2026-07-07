"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { queueExplosion } from "@/lib/three/effects-bus";
import { getDotTexture } from "@/lib/three/dot-texture";
import { mulberry32 } from "@/lib/three/procedural";
import { BELT_INNER, BELT_OUTER } from "./AsteroidBelt";

/**
 * Extragalactic meteors: quick strikes of light that dive in from far
 * outside the galaxy, slam into belt asteroids, and blow them into
 * shards. They come often — the belt is a shooting gallery.
 */

const METEORS = 8;

interface MeteorState {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  totalDistance: number;
  traveled: number;
  strength: number;
}

function makeMeteor(): MeteorState {
  return {
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    target: new THREE.Vector3(),
    totalDistance: 0,
    traveled: 0,
    strength: 1,
  };
}

export function MeteorShower({ paused }: { paused: boolean }) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const headRefs = useRef<Array<THREE.Sprite | null>>([]);
  const meteorsRef = useRef<MeteorState[] | null>(null);
  const randomRef = useRef(mulberry32(0x3e7e0));
  const spawnTimerRef = useRef(0.8);
  if (meteorsRef.current == null) {
    meteorsRef.current = Array.from({ length: METEORS }, makeMeteor);
  }

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(METEORS * 6), 3),
    );
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    const line = lineRef.current;
    const meteors = meteorsRef.current;
    if (!line || !meteors || paused) return;
    const random = randomRef.current;

    // A steady barrage: something is always inbound.
    spawnTimerRef.current -= delta;
    if (spawnTimerRef.current <= 0) {
      spawnTimerRef.current = 0.6 + random() * 1.6;
      const meteor = meteors.find((m) => !m.active);
      if (meteor) {
        // Strike point on the belt (any height — the belt is 3D now).
        const angle = random() * Math.PI * 2;
        const radius = BELT_INNER + random() * (BELT_OUTER - BELT_INNER);
        meteor.target.set(
          Math.cos(angle) * radius,
          (random() * 2 - 1) * 2.2,
          Math.sin(angle) * radius,
        );
        // Origin far outside the galaxy, biased above/below the plane so
        // strikes visibly dive in.
        const originAngle = angle + (random() - 0.5) * 2.4;
        const originRadius = 55 + random() * 25;
        meteor.position.set(
          Math.cos(originAngle) * originRadius,
          (random() < 0.5 ? 1 : -1) * (14 + random() * 22),
          Math.sin(originAngle) * originRadius,
        );
        meteor.totalDistance = meteor.position.distanceTo(meteor.target);
        meteor.traveled = 0;
        meteor.velocity
          .copy(meteor.target)
          .sub(meteor.position)
          .normalize()
          .multiplyScalar(55 + random() * 35);
        meteor.strength = 1.1 + random() * 1.3;
        meteor.active = true;
      }
    }

    const positionAttr = line.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    meteors.forEach((meteor, index) => {
      if (meteor.active) {
        meteor.traveled += meteor.velocity.length() * delta;
        meteor.position.addScaledVector(meteor.velocity, delta);
        if (meteor.traveled >= meteor.totalDistance) {
          // Impact: the struck asteroid shatters.
          queueExplosion(
            [meteor.target.x, meteor.target.y, meteor.target.z],
            meteor.strength,
          );
          meteor.active = false;
        }
      }
      if (!meteor.active) {
        positionAttr.setXYZ(index * 2, 0, -999, 0);
        positionAttr.setXYZ(index * 2 + 1, 0, -999, 0);
      } else {
        // Bright streak: head at the meteor, tail trailing its motion.
        const tailLength = 3 + meteor.velocity.length() * 0.045;
        const head = meteor.position;
        positionAttr.setXYZ(index * 2, head.x, head.y, head.z);
        positionAttr.setXYZ(
          index * 2 + 1,
          head.x - (meteor.velocity.x / meteor.velocity.length()) * tailLength,
          head.y - (meteor.velocity.y / meteor.velocity.length()) * tailLength,
          head.z - (meteor.velocity.z / meteor.velocity.length()) * tailLength,
        );
      }
      const headSprite = headRefs.current[index];
      if (headSprite) {
        headSprite.visible = meteor.active;
        if (meteor.active) {
          headSprite.position.copy(meteor.position);
          headSprite.scale.setScalar(0.9 + meteor.strength * 0.4);
        }
      }
    });
    positionAttr.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments ref={lineRef} geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial
          color="#e8f2fa"
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      {Array.from({ length: METEORS }, (_, i) => (
        <sprite
          key={i}
          ref={(sprite) => {
            headRefs.current[i] = sprite;
          }}
          visible={false}
        >
          <spriteMaterial
            map={getDotTexture()}
            color="#ffffff"
            transparent
            opacity={0.85}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}
