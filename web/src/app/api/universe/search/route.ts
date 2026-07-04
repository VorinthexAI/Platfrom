// neural-map.md §10.7 — fuzzy node search proxy, backing the floating
// island's Universe command bar (§6.5) and `use-universe-search.ts`.
//
// Not in the originally-enumerated file list for this agent, but required
// for `useUniverseSearch` (an explicit cross-agent-contract export) to
// actually resolve results — added because `src/app/api/universe/**` is
// squarely this subsystem's territory and no other agent owns it.

import { backendFetch } from "@/server/backend-client";
import { verifySessionForRoute } from "@/server/dal/session";
import type { SearchResult } from "@/features/universe/types";

export const runtime = "nodejs";

type BackendSearchResult = {
  id: string;
  label: string;
  type: string;
  position: { x: number; y: number; z: number };
};

export async function GET(request: Request) {
  const session = await verifySessionForRoute();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  if (query.length < 2) {
    return Response.json([] satisfies SearchResult[]);
  }

  const backendResponse = await backendFetch(
    `/universe/search?q=${encodeURIComponent(query)}`,
  );
  if (!backendResponse.ok) {
    return Response.json(
      { error: "Search failed" },
      { status: backendResponse.status },
    );
  }

  const results = (await backendResponse.json()) as BackendSearchResult[];
  const mapped: SearchResult[] = results.map((r) => ({
    id: r.id,
    label: r.label,
    type: r.type,
    position: [r.position.x, r.position.y, r.position.z],
  }));
  return Response.json(mapped);
}
