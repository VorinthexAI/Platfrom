"use client";

// neural-map.md §34.2 — prefetching hook, drives §11.3's ring-prefetch and
// §8.4's fly-to path prefetch.

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchUniverseTile } from "./universe-api";

export function useUniversePrefetch() {
  const queryClient = useQueryClient();
  return useCallback(
    (tier: number, cellIds: string[], pyramidVersion: string) => {
      return queryClient.prefetchQuery({
        queryKey: queryKeys.universeTile(tier, cellIds, pyramidVersion),
        queryFn: () => fetchUniverseTile({ tier, cellIds, pyramidVersion }),
        staleTime: Infinity,
      });
    },
    [queryClient],
  );
}
