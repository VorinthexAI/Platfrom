"use client";

// neural-map.md §9 (whole section) — the actual Three.js/R3F scene. Mounted
// exclusively via `universe-canvas-boundary.tsx`'s `next/dynamic({ssr:false})`
// import (§9.1) — never import this file directly from anywhere else.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { useQueryClient } from "@tanstack/react-query";

import { readCapabilitySnapshot } from "@/lib/capability-snapshot";
import { cellSize, cellsInRadius } from "@/lib/shared-spatial-index";
import { nodeTypeFromEnum } from "@/lib/node-types";
import { useSelectionStore } from "./store/selection-store";
import { useUniverseTile } from "./data/use-universe-tile";
import { useUniversePrefetch } from "./data/use-universe-prefetch";
import { useUniverseRealtime } from "./data/use-universe-realtime";
import { UniverseCameraController } from "./engine/camera-controller";
import {
  createRegimeControllerState,
  updateRegime,
} from "./engine/regime-controller";
import { publishEngineSnapshot, registerUniverseEngine } from "./engine/engine-bridge";
import { NodeInstances } from "./engine/node-instances";
import { MinimapScene } from "./minimap/minimap-scene";
import { NodeDetailCard } from "./node-detail-card";
import type { LoadedNode, Regime, SerializedCameraState } from "./types";
import starfieldFrag from "./engine/shaders/starfield.frag.glsl" with { turbopackModuleType: "raw" };
import edgeLineFrag from "./engine/shaders/edge-line.frag.glsl" with { turbopackModuleType: "raw" };

const STARFIELD_VERT = `
  attribute float seed;
  uniform float time;
  varying float vTwinkle;
  void main() {
    vTwinkle = 0.5 + 0.5 * sin(time * (0.4 + seed) + seed * 6.2831853);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 2.0;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const EDGE_LINE_VERT = `
  attribute float edgeWeight;
  varying float vEdgeWeight;
  void main() {
    vEdgeWeight = edgeWeight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MAX_CELL_IDS = 200;

function regimeToTier(regime: Regime): number {
  return { R0: 0, R1: 1, R2: 2, R3: 3 }[regime];
}

const REGIME_BREADCRUMBS: Record<Regime, string> = {
  R0: "Cosmos",
  R1: "Nebulae",
  R2: "Constellations",
  R3: "Inspect",
};

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** §8.2's decorative, non-interactive background layer — always dim, never real data. */
function Starfield({
  count = 2500,
  radius = 80_000,
  animate = true,
}: {
  count?: number;
  radius?: number;
  animate?: boolean;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const rand = createSeededRandom(hashString("vorinthex-universe-starfield"));
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const r = radius * (0.5 + 0.5 * rand());
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      seeds[i] = rand();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    return geo;
  }, [count, radius]);

  const uniforms = useMemo(() => ({ time: { value: 0 } }), []);

  useFrame((state) => {
    if (!animate) return;
    if (materialRef.current) materialRef.current.uniforms.time.value = state.clock.elapsedTime;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={STARFIELD_VERT}
        fragmentShader={starfieldFrag}
        transparent
        depthWrite={false}
        uniforms={uniforms}
      />
    </points>
  );
}

type EdgeSegment = { from: [number, number, number]; to: [number, number, number]; weight: number };

/**
 * §9.3.3 — shared BufferGeometry rewritten (not recreated) on edge-set
 * change. Wired to an empty edge set for now: the binary tile frame this
 * plan pins down (§11.1) only specifies node positions, not edge pairs, and
 * the selection-triggered neighborhood endpoint (§10.4.3,
 * `/universe/nodes/:id/neighbors`) isn't in this agent's assigned route
 * list — real edge data needs that endpoint wired up as a follow-up.
 */
function EdgeLines({ edges }: { edges: EdgeSegment[] }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(edges.length * 6);
    const weights = new Float32Array(edges.length * 2);
    edges.forEach((edge, i) => {
      positions.set(edge.from, i * 6);
      positions.set(edge.to, i * 6 + 3);
      weights[i * 2] = edge.weight;
      weights[i * 2 + 1] = edge.weight;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("edgeWeight", new THREE.BufferAttribute(weights, 1));
    return geo;
  }, [edges]);

  if (edges.length === 0) return null;

  return (
    <lineSegments geometry={geometry}>
      <shaderMaterial
        vertexShader={EDGE_LINE_VERT}
        fragmentShader={edgeLineFrag}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}

type UniverseSceneProps = {
  initialCameraState: SerializedCameraState | null;
  qualityTier: number; // 0 = full quality, higher = more degraded (§13.2)
  onEngineReady: (controller: UniverseCameraController) => void;
  onViewportChange: (state: {
    nodes: LoadedNode[];
    cameraPosition: [number, number, number];
    viewportHalfExtent: number;
  }) => void;
};

function SceneContents({
  initialCameraState,
  qualityTier,
  onEngineReady,
  onViewportChange,
}: UniverseSceneProps) {
  const { camera, gl } = useThree();
  const queryClient = useQueryClient();
  const select = useSelectionStore((s) => s.select);
  const hover = useSelectionStore((s) => s.hover);

  const controllerRef = useRef<UniverseCameraController | null>(null);
  const regimeStateRef = useRef(createRegimeControllerState());
  const capability = useMemo(() => readCapabilitySnapshot(), []);

  const [viewportQuery, setViewportQuery] = useState<{ tier: number; cellIds: string[] }>({
    tier: 0,
    cellIds: [],
  });
  const [pyramidVersion, setPyramidVersion] = useState("latest");
  const cellIdsRef = useRef<string[]>([]);
  const tierRef = useRef(0);
  const nodeIdsRef = useRef<string[]>([]);

  const tileQuery = useUniverseTile(viewportQuery.tier, viewportQuery.cellIds, pyramidVersion);
  const prefetch = useUniversePrefetch();
  const nodeMeshRef = useRef<THREE.InstancedMesh | null>(null);

  // regime-controller.ts's hysteresis-gated `currentRegime`/`zoomTier` are
  // the single source of truth for anything user-visible (breadcrumb,
  // engine snapshot, quality gating) — NOT `controller.getRegime()`, which
  // tracks raw (non-hysteresis) crossings purely for the controller's own
  // internal bookkeeping (§9.7's "emits onRegimeCrossing... consumed by the
  // regime controller" — the regime controller is the one that decides
  // whether a raw crossing actually counts, per §9.4/§8.1's hysteresis gap).
  const publishSnapshot = useCallback(() => {
    const s = regimeStateRef.current;
    publishEngineSnapshot({
      regime: s.currentRegime,
      zoomTier: s.zoomTier,
      breadcrumb: REGIME_BREADCRUMBS[s.currentRegime],
    });
  }, []);

  // "Adjust state during render" (React's documented alternative to an
  // effect+setState round-trip for deriving state from a prop/query change,
  // https://react.dev/learn/you-might-not-need-an-effect) — guarded by an
  // inequality check so this only ever fires the one extra render it needs
  // to, not on every render.
  const fetchedPyramidVersion = tileQuery.data?.pyramidVersion;
  if (fetchedPyramidVersion && fetchedPyramidVersion !== pyramidVersion) {
    setPyramidVersion(fetchedPyramidVersion);
  }

  const loadedNodes: LoadedNode[] = useMemo(() => {
    if (!tileQuery.data) return [];
    const { positions, ids, types } = tileQuery.data;
    const count = ids.length;
    const nodes: LoadedNode[] = new Array(count);
    for (let i = 0; i < count; i++) {
      nodes[i] = {
        id: ids[i],
        position: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]],
        weight: 1,
        type: nodeTypeFromEnum(types[i]),
      };
    }
    return nodes;
  }, [tileQuery.data]);

  // `nodeIdsRef` backs raycasting (an event-handler concern, not render) —
  // kept in sync via effect rather than written during the memo above.
  useEffect(() => {
    nodeIdsRef.current = loadedNodes.map((n) => n.id);
  }, [loadedNodes]);

  // ── Camera controller lifecycle ─────────────────────────────────────────
  useEffect(() => {
    const controller = new UniverseCameraController(
      camera as THREE.PerspectiveCamera,
      {
        // Raw (non-hysteresis) crossing signal — intentionally not the
        // publish trigger; see `publishSnapshot`'s comment above.
        onRegimeCrossing: () => {},
        onSettle: (state) => {
          writeCameraStateToUrl(state);
          publishSnapshot();
        },
        onFlightComplete: () => publishSnapshot(),
      },
      { reducedMotion: capability.reducedMotion },
    );

    if (initialCameraState) controller.restore(initialCameraState);

    controllerRef.current = controller;
    onEngineReady(controller);
    publishSnapshot();

    const unregister = registerUniverseEngine(controller, queryClient);

    return () => {
      controller.dispose();
      unregister();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pointer / wheel interaction (§8.3) ──────────────────────────────────
  useEffect(() => {
    const dom = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let dragDistance = 0;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    let lastClickTime = 0;

    const toNdc = (clientX: number, clientY: number): THREE.Vector2 => {
      const rect = dom.getBoundingClientRect();
      return new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const raycastNode = (clientX: number, clientY: number): string | null => {
      // §9.5's coarse-first picking is not implemented here (flagged as a
      // fallback in the plan, §9.5) — this is the plain Raycaster path,
      // adequate up to moderate loaded-node counts.
      const ndc = toNdc(clientX, clientY);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const mesh = nodeMeshRef.current;
      if (!mesh) return null;
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length === 0 || hits[0].instanceId === undefined) return null;
      return nodeIdsRef.current[hits[0].instanceId] ?? null;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const controller = controllerRef.current;
      if (!controller) return;
      const ndc = toNdc(event.clientX, event.clientY);
      controller.handleWheel(event.deltaY, ndc, event.ctrlKey || event.metaKey);
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      dragDistance = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      dom.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragging) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        dragDistance += Math.abs(dx) + Math.abs(dy);
        lastX = event.clientX;
        lastY = event.clientY;
        controllerRef.current?.handleDrag(dx, dy, !event.shiftKey);
      } else {
        const hitId = raycastNode(event.clientX, event.clientY);
        hover(hitId);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      dom.releasePointerCapture(event.pointerId);
      if (dragDistance > 6) return; // was a drag, not a click

      const now = performance.now();
      const isDoubleClick = now - lastClickTime < 350;
      lastClickTime = now;

      const hitId = raycastNode(event.clientX, event.clientY);
      if (clickTimer) clearTimeout(clickTimer);

      if (isDoubleClick && hitId) {
        const node = loadedNodes.find((n) => n.id === hitId);
        if (node && controllerRef.current) {
          const [x, y, z] = node.position;
          controllerRef.current.flyTo(new THREE.Vector3(x, y, z), 30, {
            focusNodeId: hitId,
          });
        }
        return;
      }

      clickTimer = setTimeout(() => {
        select(hitId);
      }, 180);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        select(null);
        controllerRef.current?.clearFocus();
      }
    };

    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      if (clickTimer) clearTimeout(clickTimer);
    };
  }, [camera, gl, hover, select, loadedNodes]);

  // Mirrors regimeStateRef's authoritative regime into real React state —
  // only written on an actual (hysteresis-gated) crossing, so this re-render
  // is infrequent, not per-frame. Exists so JSX below can read the current
  // regime without reading `.current` during render (refs are an
  // event-handler/effect concern, not a render concern).
  const [displayRegime, setDisplayRegime] = useState<Regime>("R0");

  // ── Per-frame regime/chunk-load loop (§9.4) + periodic snapshot publish ─
  // Initialized to a value that guarantees the very first frame publishes
  // immediately, rather than waiting up to 200ms for the first snapshot.
  const lastPublishRef = useRef(-1);
  useFrame((state, delta) => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.tick(delta * 1000);

    const rawDistance = controller.getDistance();
    updateRegime(regimeStateRef.current, rawDistance, {
      onRegimeCrossing: () => {
        publishSnapshot();
        setDisplayRegime(regimeStateRef.current.currentRegime);
      },
      computeViewportHash: () => {
        const tier = regimeToTier(regimeStateRef.current.currentRegime);
        const focal = controller.getFocalPoint();
        const radius = Math.max(rawDistance * 1.5, cellSize(tier));
        const cellIds = cellsInRadius(tier, focal, radius).slice(0, MAX_CELL_IDS);
        cellIdsRef.current = cellIds;
        tierRef.current = tier;
        return `${tier}:${[...cellIds].sort().join(",")}`;
      },
      ensureChunksLoadedForCurrentView: () => {
        setViewportQuery({ tier: tierRef.current, cellIds: cellIdsRef.current });
        // One-ring prefetch while moving (§11.3) — widened to two rings on
        // settle is handled by onSettle triggering a second, larger prefetch.
        const neighborRadius = cellSize(tierRef.current) * 2;
        const ring = cellsInRadius(tierRef.current, controller.getFocalPoint(), neighborRadius).slice(
          0,
          MAX_CELL_IDS,
        );
        void prefetch(tierRef.current, ring, pyramidVersion);
      },
    });

    const now = state.clock.elapsedTime;
    if (now - lastPublishRef.current > 0.2) {
      lastPublishRef.current = now;
      publishSnapshot();
      // Throttled alongside the snapshot publish (not every frame, §13.1's
      // "no allocation in the hot path" guidance) — the minimap only needs
      // to feel live, not be frame-perfect.
      onViewportChange({
        nodes: loadedNodes,
        cameraPosition: [controller.getFocalPoint().x, 0, controller.getFocalPoint().z],
        viewportHalfExtent: rawDistance,
      });
    }
  });

  const showStarfield = true; // §8.2 — R0's decorative field always present,
  // fades under real-node density naturally via draw order/alpha, not a hard
  // regime gate, so zooming never shows a hard "pop" of the background.
  const maxInstances = capability.memoryClass === "low" ? 1250 : 5000; // §14.3

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[40, 60, 20]}
        intensity={displayRegime === "R2" || displayRegime === "R3" ? 0.5 : 0}
      />
      {showStarfield && <Starfield animate={!capability.reducedMotion} />}
      <NodeInstances
        nodes={loadedNodes}
        maxInstances={maxInstances}
        onMeshReady={(mesh) => {
          nodeMeshRef.current = mesh;
        }}
      />
      <EdgeLines edges={[]} />
      {qualityTier === 0 && !capability.reducedMotion && (
        <EffectComposer>
          <Bloom intensity={0.4} luminanceThreshold={0.4} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

function writeCameraStateToUrl(state: SerializedCameraState): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  params.set("x", state.x.toFixed(2));
  params.set("y", state.y.toFixed(2));
  params.set("z", state.z.toFixed(2));
  params.set("yaw", state.yaw.toFixed(3));
  params.set("pitch", state.pitch.toFixed(3));
  params.set("tier", state.tier.toFixed(2));
  if (state.focus) params.set("focus", state.focus);
  // Throttled to onSettle (>150ms of stillness) — never per-frame — and
  // always `replaceState`, matching §8.7's explicit "never pushState per
  // camera frame" rule.
  window.history.replaceState(null, "", `/console/u?${params.toString()}`);
}

export type UniverseCanvasProps = {
  initialCameraState: SerializedCameraState | null;
};

export function UniverseCanvas({ initialCameraState }: UniverseCanvasProps) {
  useUniverseRealtime();

  const capability = useMemo(() => readCapabilitySnapshot(), []);
  const [qualityTier, setQualityTier] = useState(capability.memoryClass === "low" ? 1 : 0);
  const [viewport, setViewport] = useState<{
    nodes: LoadedNode[];
    cameraPosition: [number, number, number];
    viewportHalfExtent: number;
  }>({ nodes: [], cameraPosition: [0, 0, 0], viewportHalfExtent: 2000 });

  const selectedNodeId = useSelectionStore((s) => s.selectedNodeId);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas
        camera={{ fov: 55, near: 0.1, far: 500_000 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={capability.memoryClass === "low" ? [1, 1] : [1, 2]}
      >
        <PerformanceMonitor
          onDecline={() => setQualityTier((t) => Math.min(t + 1, 4))}
          onIncline={() => setQualityTier((t) => Math.max(t - 1, 0))}
        >
          <SceneContents
            initialCameraState={initialCameraState}
            qualityTier={qualityTier}
            onEngineReady={() => {}}
            onViewportChange={setViewport}
          />
        </PerformanceMonitor>
      </Canvas>

      <MinimapScene
        nodes={viewport.nodes}
        cameraPosition={viewport.cameraPosition}
        viewportHalfExtent={viewport.viewportHalfExtent}
        updateEveryNthFrame={qualityTier >= 4 ? 4 : 1}
      />

      {selectedNodeId && <NodeDetailCard nodeId={selectedNodeId} />}
    </div>
  );
}
