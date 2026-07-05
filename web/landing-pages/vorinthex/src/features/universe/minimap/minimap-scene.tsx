"use client";

// neural-map.md §9.8 — minimap / orientation aid. A small always-visible
// inset (bottom-left, never overlapping the floating island — the island is
// bottom-center per console-theme.css's `.vx-island`, so bottom-left is
// clear) showing the current regime's loaded-chunk footprint as a simple 2D
// top-down projection with a camera-position marker and a viewport-bounds
// rectangle.
//
// Rendered as a genuinely separate, tiny orthographic three scene (its own
// `<Canvas>`, own render loop) — cheap, a few dozen dots — rather than a
// DOM/canvas2d minimap, so it shares the same `LoadedNode[]` data the main
// scene already has without a costly cross-representation sync step. Exists
// specifically to counter the disorientation risk inherent to "infinite
// zoom" navigation (§19).

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadedNode } from "../types";

const MINIMAP_SCALE = 0.02; // world units -> minimap-local units
const MAX_DOTS = 400; // "a few dozen dots" budget, generous ceiling

export type MinimapSceneProps = {
  nodes: LoadedNode[];
  cameraPosition: [number, number, number];
  viewportHalfExtent: number;
  /** §13.2 tier-4 adaptive-quality step: 1 = every frame, 4 = every 4th frame. */
  updateEveryNthFrame?: number;
};

export function MinimapScene({
  nodes,
  cameraPosition,
  viewportHalfExtent,
  updateEveryNthFrame = 1,
}: MinimapSceneProps) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 16,
        bottom: 16,
        width: 140,
        height: 140,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(20,23,27,0.72)",
        pointerEvents: "none",
        zIndex: 15,
      }}
    >
      <Canvas
        orthographic
        camera={{ position: [0, 200, 0], zoom: 6, near: 0.1, far: 2000 }}
        dpr={1}
        gl={{ antialias: false }}
      >
        <MinimapContents
          nodes={nodes}
          cameraPosition={cameraPosition}
          viewportHalfExtent={viewportHalfExtent}
          updateEveryNthFrame={updateEveryNthFrame}
        />
      </Canvas>
    </div>
  );
}

function MinimapContents({
  nodes,
  cameraPosition,
  viewportHalfExtent,
  updateEveryNthFrame,
}: Required<MinimapSceneProps>) {
  const frameCounter = useRef(0);
  const [visible, setVisible] = useState({
    nodes,
    cameraPosition,
    viewportHalfExtent,
  });

  useFrame(() => {
    frameCounter.current += 1;
    if (frameCounter.current % updateEveryNthFrame !== 0) return;
    setVisible({ nodes, cameraPosition, viewportHalfExtent });
  });

  const dots = useMemo(
    () => visible.nodes.slice(0, MAX_DOTS).map((n) => n.position),
    [visible.nodes],
  );

  const boundsGeometry = useMemo(() => {
    const half = visible.viewportHalfExtent * MINIMAP_SCALE;
    const points = [
      new THREE.Vector3(-half, 0, -half),
      new THREE.Vector3(half, 0, -half),
      new THREE.Vector3(half, 0, half),
      new THREE.Vector3(-half, 0, half),
      new THREE.Vector3(-half, 0, -half),
    ];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [visible.viewportHalfExtent]);

  const cx = visible.cameraPosition[0] * MINIMAP_SCALE;
  const cz = visible.cameraPosition[2] * MINIMAP_SCALE;

  return (
    <>
      <ambientLight intensity={1} />
      {dots.map((p, i) => (
        <mesh
          key={i}
          position={[p[0] * MINIMAP_SCALE, 0, p[2] * MINIMAP_SCALE]}
          renderOrder={0}
        >
          <circleGeometry args={[0.5, 6]} />
          {/* Dim, non-interactive dots — this is an orientation aid, not a
              second picking surface (mirrors §8.2's real-vs-decorative
              honesty rule: nothing in the minimap is ever clickable). */}
          <meshBasicMaterial color="#4a5a99" />
        </mesh>
      ))}

      <group position={[cx, 0.5, cz]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.2, 12]} />
          <meshBasicMaterial color="#7c9cff" />
        </mesh>
      </group>

      <lineLoop position={[cx, 0.4, cz]} geometry={boundsGeometry}>
        <lineBasicMaterial color="#7c9cff" transparent opacity={0.6} />
      </lineLoop>
    </>
  );
}
