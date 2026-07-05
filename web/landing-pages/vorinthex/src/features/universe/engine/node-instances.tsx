"use client";

// neural-map.md §9.3.1/§9.3.4/§30.1 — InstancedMesh-backed node rendering for
// R1-R3. Bypasses drei's declarative <Instances>/<Instance> reconciliation
// and writes directly to the InstancedMesh's instanceMatrix/custom instanced
// attribute buffers via a ref, calling `needsUpdate = true` once per commit
// — the imperative form the plan calls out as the one that should ship for
// R2 at realistic (5,000+ concurrently-loaded) node counts.
//
// Geometry/material are module-level singletons (created once, at import
// time, entirely outside the component/hook system) rather than
// `useMemo`/`useRef` — Next 16's default eslint-config-next now enforces the
// React Compiler's hooks-purity rules (`react-hooks/refs`,
// `react-hooks/immutability`), which flag both "mutate a useMemo-returned
// value" and "read/write a ref during render." Module scope is the one
// place genuinely exempt from both, and is the standard three.js pattern
// for shared, mutation-heavy GPU resources anyway. The one instance this
// component is ever mounted (SceneContents) owns the buffer sizing, so a
// singleton is safe here — documented rather than generalized, since a
// second concurrent mount would incorrectly share buffers.
// Per-instance mutable buffers (instanceMatrix, colorAttr, intensityAttr,
// the fade-in tracking Map) are created and swapped in inside effects only
// — never read/written synchronously in the render body — satisfying the
// same purity rules without fighting them.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { LoadedNode } from "../types";
// Turbopack import-attribute loader (next.config.ts needs no changes for
// this — `turbopackModuleType: "raw"` is a per-import inline loader, §next
// docs "Inline loader configuration with import attributes").
import nodeGlowVert from "./shaders/node-glow.vert.glsl" with { turbopackModuleType: "raw" };
import nodeGlowFrag from "./shaders/node-glow.frag.glsl" with { turbopackModuleType: "raw" };
import { readCapabilitySnapshot } from "@/lib/capability-snapshot";

// --vx-console-accent (§6.1's note: "used for the universe's node-glow accent too").
const DEFAULT_COLOR = new THREE.Color("#7c9cff");
const FADE_IN_MS = 600; // §30.1's per-instance new-node glow ramp

const NODE_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const NODE_MATERIAL = new THREE.ShaderMaterial({
  vertexShader: nodeGlowVert,
  fragmentShader: nodeGlowFrag,
  transparent: true,
  depthWrite: false,
});

export type NodeInstancesProps = {
  nodes: LoadedNode[];
  maxInstances?: number;
  displayScale?: number;
  /** Exposes the underlying InstancedMesh for external raycasting (§9.5). */
  onMeshReady?: (mesh: THREE.InstancedMesh | null) => void;
};

export function NodeInstances({
  nodes,
  maxInstances = 8000,
  displayScale = 1,
  onMeshReady,
}: NodeInstancesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const previousIds = useRef<Set<string>>(new Set());
  // Only the mid-fade subset is scanned per frame (§30.1) — never the whole buffer.
  const fadingIndices = useRef<Map<number, number>>(new Map());
  const colorAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const intensityAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Allocates the per-instance attribute buffers for the current
  // `maxInstances` ceiling and attaches them (+ the shared geometry/
  // material) onto the mesh. Runs on mount and whenever `maxInstances`
  // changes (rare — driven by capability-snapshot's memoryClass, §14.3).
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const colorAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances * 3),
      3,
    );
    const intensityAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(maxInstances),
      1,
    );
    NODE_GEOMETRY.setAttribute("instanceColor", colorAttr);
    NODE_GEOMETRY.setAttribute("instanceIntensity", intensityAttr);

    mesh.geometry = NODE_GEOMETRY;
    mesh.material = NODE_MATERIAL;
    colorAttrRef.current = colorAttr;
    intensityAttrRef.current = intensityAttr;
    previousIds.current = new Set();
    fadingIndices.current.clear();

    onMeshReady?.(mesh);
    return () => onMeshReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxInstances]);

  useEffect(() => {
    const mesh = meshRef.current;
    const colorAttr = colorAttrRef.current;
    const intensityAttr = intensityAttrRef.current;
    if (!mesh || !colorAttr || !intensityAttr) return;

    const reducedMotion = readCapabilitySnapshot().reducedMotion;
    const tmp = new THREE.Matrix4();
    const nextIds = new Set<string>();
    fadingIndices.current.clear();

    const count = Math.min(nodes.length, maxInstances);
    for (let i = 0; i < count; i++) {
      const node = nodes[i];
      nextIds.add(node.id);
      const [x, y, z] = node.position;
      const scale = displayScale * (0.5 + Math.min(node.weight, 5) * 0.1);
      tmp.makeScale(scale, scale, scale);
      tmp.setPosition(x, y, z);
      mesh.setMatrixAt(i, tmp);

      const color = node.color
        ? new THREE.Color(node.color[0], node.color[1], node.color[2])
        : DEFAULT_COLOR;
      colorAttr.setXYZ(i, color.r, color.g, color.b);

      const isNew = !previousIds.current.has(node.id);
      if (isNew && !reducedMotion) {
        intensityAttr.setX(i, 0);
        fadingIndices.current.set(i, 0);
      } else {
        intensityAttr.setX(i, node.intensity ?? 1);
      }
    }

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
    intensityAttr.needsUpdate = true;
    previousIds.current = nextIds;
  }, [nodes, maxInstances, displayScale]);

  useFrame((_state, delta) => {
    const intensityAttr = intensityAttrRef.current;
    if (!intensityAttr || fadingIndices.current.size === 0) return;
    const deltaMs = delta * 1000;
    for (const [index, elapsed] of fadingIndices.current) {
      const nextElapsed = elapsed + deltaMs;
      const t = Math.min(nextElapsed / FADE_IN_MS, 1);
      intensityAttr.setX(index, t);
      if (t >= 1) {
        fadingIndices.current.delete(index);
      } else {
        fadingIndices.current.set(index, nextElapsed);
      }
    }
    intensityAttr.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, maxInstances]}
      frustumCulled={false}
    />
  );
}
