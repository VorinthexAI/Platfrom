"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { galaxyMotion, useGalaxyStore } from "@/lib/galaxy-store";
import { mulberry32 } from "@/lib/three/procedural";

/**
 * The star-wars hyper-jump: a camera-locked tunnel of light streaks that
 * race past and stretch as the jump accelerates. Members jump on cold
 * blue-steel light into /galaxy/private; explorers ride warm ember-silver
 * into /galaxy/public. The same tunnel fires as a short silver burst when
 * warping between world interiors.
 */

const WARP_BURST_MS = 620;

const STREAKS = 260;
const TUNNEL_DEPTH = 150;

interface StreakOffset {
  x: number;
  y: number;
  z: number;
  speed: number;
}

function buildOffsets(): StreakOffset[] {
  const random = mulberry32(0x50eed);
  const offsets: StreakOffset[] = [];
  for (let i = 0; i < STREAKS; i++) {
    const radius = 0.7 + random() ** 1.6 * 7.5;
    const angle = random() * Math.PI * 2;
    offsets.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: -random() * TUNNEL_DEPTH,
      speed: 0.7 + random() * 0.6,
    });
  }
  return offsets;
}

export function HyperJumpStreaks() {
  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<THREE.LineSegments>(null);
  const materialRef = useRef<THREE.LineBasicMaterial>(null);
  const camera = useThree((state) => state.camera);
  const mode = useGalaxyStore((s) => s.mode);
  const jumpTarget = useGalaxyStore((s) => s.jumpTarget);
  const elapsedRef = useRef(0);
  // Mutable simulation state — owned by the frame loop, not React.
  const offsetsRef = useRef<StreakOffset[] | null>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3),
    );
    return geo;
  }, []);
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame((_, delta) => {
    const warpAge = performance.now() - galaxyMotion.warpAt;
    const warping = warpAge >= 0 && warpAge < WARP_BURST_MS;
    const active = mode === "jump" || warping;
    if (!groupRef.current || !materialRef.current || !lineRef.current) return;
    groupRef.current.visible = active;
    if (!active) {
      elapsedRef.current = 0;
      return;
    }
    if (offsetsRef.current == null) {
      offsetsRef.current = buildOffsets();
    }
    elapsedRef.current += delta;
    const t = elapsedRef.current;
    const speed = Math.min(30 + t * t * 260, 640);
    const stretch = Math.min(1.5 + t * 26, 46);

    // Lock the tunnel onto the camera.
    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);

    const positionAttr = lineRef.current.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const offsets = offsetsRef.current;
    for (let i = 0; i < STREAKS; i++) {
      const streak = offsets[i];
      streak.z += speed * streak.speed * delta;
      if (streak.z > 4) streak.z -= TUNNEL_DEPTH;
      positionAttr.setXYZ(i * 2, streak.x, streak.y, streak.z);
      positionAttr.setXYZ(i * 2 + 1, streak.x, streak.y, streak.z - stretch);
    }
    positionAttr.needsUpdate = true;

    if (mode === "jump") {
      materialRef.current.opacity = Math.min(t * 2.2, 0.9);
      materialRef.current.color.set(
        jumpTarget === "private" ? "#9fb4c7" : "#ffb25c",
      );
    } else {
      // Interior warp: a fast silver burst that fades as the veil closes.
      const envelope = Math.sin((warpAge / WARP_BURST_MS) * Math.PI);
      materialRef.current.opacity = envelope * 0.8;
      materialRef.current.color.set("#dde2e5");
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <lineSegments ref={lineRef} geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial
          ref={materialRef}
          color="#dde2e5"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
