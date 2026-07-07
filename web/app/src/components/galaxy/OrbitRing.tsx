"use client";

import { useMemo } from "react";
import * as THREE from "three";

/** Thin, chrome, semi-transparent orbit path. */
export function OrbitRing({
  radius,
  opacity = 0.14,
}: {
  radius: number;
  opacity?: number;
}) {
  const line = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
      );
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: "#aeb6bc",
      transparent: true,
      opacity,
    });
    return new THREE.Line(geometry, material);
  }, [radius, opacity]);

  return <primitive object={line} />;
}
