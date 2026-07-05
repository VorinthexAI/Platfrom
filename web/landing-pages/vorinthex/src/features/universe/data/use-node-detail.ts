"use client";

// neural-map.md §34.3 — node detail hook, backing the R3 detail card
// (§8.1) and the chat citation "View in Universe" jump (§7.9).

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchNodeDetail } from "./universe-api";

export function useNodeDetail(nodeId: string | null) {
  return useQuery({
    queryKey: nodeId ? queryKeys.nodeDetail(nodeId) : ["universe", "node", "none"],
    queryFn: () => fetchNodeDetail(nodeId!),
    enabled: nodeId !== null,
    // Node details can change (properties edited elsewhere, neighbor count
    // shifting) — short-lived freshness, unlike the immutable tile cache.
    staleTime: 60_000,
  });
}
