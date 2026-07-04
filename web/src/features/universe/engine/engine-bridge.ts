"use client";

// neural-map.md §12.4 (useSyncExternalStore-backed engine state) + the
// cross-agent contract: other agents (console-shell header breadcrumb,
// chat tool-call citations, the universe-command-bar's search results)
// import `useEngineSnapshot` and rely on a `window` "vx:universe:fly-to"
// listener being wired up somewhere in this module.
//
// The camera-math class (UniverseCameraController) is a plain TS class
// driven imperatively from useFrame (§9.7) — it has no business publishing
// through React state on every frame. Instead, `universe-canvas.tsx` calls
// `publishEngineSnapshot(...)` from its regime-crossing/settle callbacks
// (not every frame), and this module fans that out to any subscriber via
// `useSyncExternalStore`, which may render `null` before the first publish.

import { useSyncExternalStore } from "react";
import * as THREE from "three";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { EngineSnapshot } from "../types";
import type { UniverseCameraController } from "./camera-controller";
import { fetchNodeDetail } from "../data/universe-api";

type Listener = () => void;

let snapshot: EngineSnapshot | null = null;
const listeners = new Set<Listener>();

export function publishEngineSnapshot(next: EngineSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): EngineSnapshot | null {
  return snapshot;
}

/** useSyncExternalStore-backed (§12.4) — may return null before first publish. */
export function useEngineSnapshot(): EngineSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

// ── "vx:universe:fly-to" cross-agent bridge ─────────────────────────────
//
// The console-shell agent's universe-command-bar.tsx and the chat agent's
// tool-call-card.tsx both do:
//   window.dispatchEvent(new CustomEvent("vx:universe:fly-to", { detail: { nodeId } }))
// This module owns the single listener that resolves nodeId -> position
// (via the node-detail cache, §34.3) and drives the camera controller's
// flyTo().

type FlyToDetail = { nodeId: string };

let activeController: UniverseCameraController | null = null;
let activeQueryClient: QueryClient | null = null;
let windowListenerAttached = false;

async function handleFlyToEvent(event: Event): Promise<void> {
  const detail = (event as CustomEvent<FlyToDetail>).detail;
  const nodeId = detail?.nodeId;
  if (!nodeId || !activeController || !activeQueryClient) return;

  try {
    const detailResult = await activeQueryClient.fetchQuery({
      queryKey: queryKeys.nodeDetail(nodeId),
      queryFn: () => fetchNodeDetail(nodeId),
      staleTime: 60_000,
    });
    const controller = activeController;
    if (!controller || !detailResult.position) return;
    const [x, y, z] = detailResult.position;
    // R3 "Inspect" distance (§8.1) — flying to a searched/cited node lands
    // the camera close enough to immediately show its detail card.
    controller.flyTo(new THREE.Vector3(x, y, z), 30, { focusNodeId: nodeId });
  } catch {
    // Resolution failure (node deleted, network error, etc.) — silently
    // drop the fly-to rather than throwing inside a DOM event listener.
  }
}

/**
 * Called once from the engine's top-level mount (universe-canvas.tsx) to
 * wire the camera controller up to cross-agent "fly-to" requests. Returns a
 * cleanup function to call on unmount.
 */
export function registerUniverseEngine(
  controller: UniverseCameraController,
  queryClient: QueryClient,
): () => void {
  activeController = controller;
  activeQueryClient = queryClient;

  if (!windowListenerAttached && typeof window !== "undefined") {
    window.addEventListener("vx:universe:fly-to", handleFlyToEvent);
    windowListenerAttached = true;
  }

  return () => {
    activeController = null;
    activeQueryClient = null;
    if (windowListenerAttached && typeof window !== "undefined") {
      window.removeEventListener("vx:universe:fly-to", handleFlyToEvent);
      windowListenerAttached = false;
    }
  };
}
