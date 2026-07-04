// neural-map.md §11.1/§11.2 — proxies the backend's binary tile endpoint.
// Binary body pass-through (never buffered into JSON) — the whole point of
// §11.1's custom framing is to avoid a JSON parse/stringify tax on dense
// numeric arrays, so this route must not decode-then-re-encode the payload.
//
// Node.js runtime required (not Edge) per next.config.ts's note — streaming
// a `Response.body` ReadableStream straight through from `backendFetchStream`
// is the shape this depends on.

import { decodeCellIds, encodeCellIds } from "@/lib/shared-spatial-index";
import { backendFetchStream } from "@/server/backend-client";
import { verifySessionForRoute } from "@/server/dal/session";

export const runtime = "nodejs";

// Defense-in-depth mirror of §11.2's client-side cap — the client should
// never send more than this, but the route enforces it too rather than
// trusting the caller.
const MAX_CELL_IDS = 512;

export async function GET(request: Request) {
  const session = await verifySessionForRoute();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier");
  const cells = searchParams.get("cells");
  const pyramidVersion = searchParams.get("pyramidVersion");
  const cursor = searchParams.get("cursor");

  if (!tier || !cells) {
    return Response.json(
      { error: "tier and cells query params are required" },
      { status: 400 },
    );
  }

  const cellIds = decodeCellIds(cells);
  if (cellIds.length === 0 || cellIds.length > MAX_CELL_IDS) {
    return Response.json(
      { error: `cells must contain 1-${MAX_CELL_IDS} entries` },
      { status: 400 },
    );
  }

  const backendParams = new URLSearchParams({ tier, cells: encodeCellIds(cellIds) });
  if (pyramidVersion) backendParams.set("pyramidVersion", pyramidVersion);
  if (cursor) backendParams.set("cursor", cursor);

  const backendResponse = await backendFetchStream(
    `/universe/tiles?${backendParams.toString()}`,
  );

  if (!backendResponse.ok || !backendResponse.body) {
    return new Response(null, { status: backendResponse.status || 502 });
  }

  return new Response(backendResponse.body, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
}
