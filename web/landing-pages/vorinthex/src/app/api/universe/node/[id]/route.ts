// neural-map.md §10.6 — node detail endpoint proxy, backing R3's detail card
// (§8.1) and the chat citation "View in Universe" jump (§7.9).

import { backendFetch } from "@/server/backend-client";
import { verifySessionForRoute } from "@/server/dal/session";
import type { NodeDetail } from "@/features/universe/types";

export const runtime = "nodejs";

type BackendNodeDetailResponse = {
  _key: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
  position?: { x: number; y: number; z: number };
  neighborCount: number;
};

function toNodeDetail(doc: BackendNodeDetailResponse): NodeDetail {
  return {
    id: doc._key,
    label: doc.label,
    type: doc.type,
    properties: doc.properties,
    neighborCount: doc.neighborCount,
    position: doc.position
      ? [doc.position.x, doc.position.y, doc.position.z]
      : undefined,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await verifySessionForRoute();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const backendResponse = await backendFetch(
    `/universe/nodes/${encodeURIComponent(id)}`,
  );
  if (!backendResponse.ok) {
    return Response.json(
      { error: "Node not found" },
      { status: backendResponse.status },
    );
  }

  const doc = (await backendResponse.json()) as BackendNodeDetailResponse;
  return Response.json(toNodeDetail(doc));
}
