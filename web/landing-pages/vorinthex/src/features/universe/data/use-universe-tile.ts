"use client";

// neural-map.md §34.1 — universe tile fetching hook.

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchUniverseTile } from "./universe-api";

export function useUniverseTile(
  tier: number,
  cellIds: string[],
  pyramidVersion: string,
) {
  return useQuery({
    queryKey: queryKeys.universeTile(tier, cellIds, pyramidVersion),
    queryFn: () => fetchUniverseTile({ tier, cellIds, pyramidVersion }),
    // Tiles are immutable for a given (tier, cells, pyramidVersion) triple —
    // once fetched, they never need refetching under the same key. §12.2's
    // pyramidVersion-in-key convention is what makes `Infinity` safe here.
    // Targeted realtime invalidation (§11.4/use-universe-realtime.ts) is the
    // freshness mechanism for incremental updates that don't bump the
    // pyramidVersion (§10.5.4/§38).
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000, // still evict from memory eventually if unused,
    // just never treat as "stale" while cached
    enabled: cellIds.length > 0,
  });
}
