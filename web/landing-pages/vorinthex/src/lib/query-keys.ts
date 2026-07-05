// Central query-key registry (neural-map.md §12.2). Keeping every TanStack
// Query key in one place prevents the two easy-to-get-wrong mistakes called
// out in the plan: unsorted array segments producing duplicate cache entries
// for the same logical request, and ad-hoc key shapes drifting across files.

import { encodeCellIds } from "./shared-spatial-index";

export const queryKeys = {
  chatThread: (threadId: string) => ["chat", "thread", threadId] as const,
  chatMessages: (threadId: string, cursor?: string) =>
    ["chat", "thread", threadId, "messages", cursor ?? null] as const,
  universeTile: (tier: number, cellIds: string[], pyramidVersion: string) =>
    [
      "universe",
      "tile",
      tier,
      // `encodeCellIds` (not a plain `.join(",")`) — gridCell ids are
      // themselves comma-shaped (`L2:14,-3,7`), so a naive comma join here
      // would make this cache key ambiguous between different cell sets.
      // See the comment on `encodeCellIds` for the full story.
      encodeCellIds([...cellIds].sort()),
      pyramidVersion,
    ] as const,
  nodeDetail: (nodeId: string) => ["universe", "node", nodeId] as const,
  universeSearch: (query: string) => ["universe", "search", query] as const,
  session: () => ["auth", "session"] as const,
};
