"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { galaxyMotion, useGalaxyStore } from "@/lib/galaxy-store";
import { mulberry32 } from "@/lib/three/procedural";

/**
 * Scroll-momentum physics. Repeated scrolling spins the whole cosmos
 * faster and faster until belt and planets smear into circular light
 * streaks; easing off (or scrolling up) throttles the spin back down
 * quickly. The camera pull-back lives in CameraRig; this group owns the
 * actual rotation and the streak overlay.
 */
export function SpinRig({ children }: { children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const mode = useGalaxyStore((s) => s.mode);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const idleMs = performance.now() - galaxyMotion.lastScrollAt;
    // Fresh input keeps momentum alive; going quiet bleeds it off fast.
    const decayTau = idleMs < 350 ? 2.6 : 0.55;
    galaxyMotion.momentum = THREE.MathUtils.damp(
      galaxyMotion.momentum,
      0,
      1 / decayTau,
      delta,
    );
    if (mode !== "system") {
      galaxyMotion.momentum = 0;
    }
    const spin = galaxyMotion.momentum ** 1.6 * 3.4;
    groupRef.current.rotation.y += delta * spin;

    // At high belt velocity the cosmos counter-rotates against the
    // circling camera — perceived speed compounds until everything is
    // pure light strips.
    if (mode === "belt") {
      const surge = Math.max(0, galaxyMotion.beltVelocity - 0.4);
      groupRef.current.rotation.y -= delta * surge * 0.9;
    }
  });

  return (
    <group ref={groupRef}>
      {children}
      <SpeedStreaks />
    </group>
  );
}

/**
 * Circular light streaks that fade in as the spin approaches escape
 * velocity — the visual of the whole system smearing into strips. Feeds
 * on both spin sources: system-mode scroll momentum AND belt-mode
 * circling velocity, so riding the belt at lightning speed turns the
 * entire solar system + belt into rings of light.
 */
function SpeedStreaks() {
  const materialRef = useRef<THREE.LineBasicMaterial>(null);
  const mode = useGalaxyStore((s) => s.mode);

  const geometry = useMemo(() => {
    const random = mulberry32(0x57f3a);
    const positions: number[] = [];
    const streaks = 260;
    for (let i = 0; i < streaks; i++) {
      // Cover the whole cosmos: inner system through the deep belt field.
      const radius = 4 + random() * 38;
      const angle = random() * Math.PI * 2;
      const y = (random() + random() - 1) * 3.6;
      const arc = 0.14 + random() * 0.5;
      positions.push(
        Math.cos(angle) * radius, y, Math.sin(angle) * radius,
        Math.cos(angle + arc) * radius, y, Math.sin(angle + arc) * radius,
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    return geo;
  }, []);

  useFrame(() => {
    if (!materialRef.current) return;
    const momentumReveal = Math.max(0, (galaxyMotion.momentum - 0.3) / 0.7);
    const beltReveal =
      mode === "belt"
        ? Math.min(Math.max((galaxyMotion.beltVelocity - 0.3) / 1.7, 0), 1)
        : 0;
    const reveal = Math.max(momentumReveal, beltReveal);
    materialRef.current.opacity = reveal * 0.85;
    materialRef.current.visible = reveal > 0.01;
  });

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        ref={materialRef}
        color="#dde2e5"
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}
