"use client";

// neural-map.md §34.6/§11.4 — bridges the realtime WS change feed into
// TanStack Query cache invalidation, with §13.3's burst-coalescing (a 200ms
// window) so a bulk import creating hundreds of nodes at once produces one
// invalidation pass, not hundreds of individual re-renders.

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useConsoleModeStore } from "@/features/console/store/console-mode-store";
import { decodeCellIds } from "@/lib/shared-spatial-index";
import { openUniverseSocket } from "./universe-api";
import type { UniverseChangeEvent } from "../types";

function extractAffectedCells(event: UniverseChangeEvent): string[] {
  switch (event.type) {
    case "node_created":
    case "node_updated":
    case "node_deleted":
      return [event.gridCell];
    case "cluster_rebuilt":
      return event.affectedCells;
    case "edge_created":
    case "edge_deleted":
      // Edges don't carry a gridCell — nothing to spatially invalidate;
      // R2/R3 edge queries are re-derived from the node set already cached.
      return [];
    default:
      return [];
  }
}

/** True if a `queryKeys.universeTile(...)` key's cell set contains `cell`. */
function queryKeyTouchesCell(queryKey: QueryKey, cell: string): boolean {
  if (queryKey[0] !== "universe" || queryKey[1] !== "tile") return false;
  const cellsJoined = queryKey[3];
  if (typeof cellsJoined !== "string") return false;
  return decodeCellIds(cellsJoined).includes(cell);
}

const COALESCE_WINDOW_MS = 200; // §13.3

export function useUniverseRealtime() {
  const queryClient = useQueryClient();
  const markOtherModeActivity = useConsoleModeStore(
    (s) => s.markOtherModeActivity,
  );
  const mode = useConsoleModeStore((s) => s.mode);

  useEffect(() => {
    const socket = openUniverseSocket();
    const pendingCells = new Set<string>();
    let flushHandle: ReturnType<typeof setTimeout> | null = null;

    socket.onMessage((event: UniverseChangeEvent) => {
      const cells = extractAffectedCells(event);
      cells.forEach((c) => pendingCells.add(c));
      if (mode === "chat") markOtherModeActivity();

      if (cells.length === 0) return;

      if (!flushHandle) {
        flushHandle = setTimeout(() => {
          for (const cell of pendingCells) {
            queryClient.invalidateQueries({
              predicate: (q) => queryKeyTouchesCell(q.queryKey, cell),
            });
          }
          pendingCells.clear();
          flushHandle = null;
        }, COALESCE_WINDOW_MS);
      }
    });

    return () => {
      if (flushHandle) clearTimeout(flushHandle);
      socket.close();
    };
  }, [queryClient, mode, markOtherModeActivity]);
}
