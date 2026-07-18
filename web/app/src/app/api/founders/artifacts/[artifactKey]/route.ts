import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

type ArtifactRouteContext = { params: Promise<{ artifactKey: string }> };

async function proxy(request: Request, context: ArtifactRouteContext, method: "GET" | "PATCH" | "DELETE") {
  const { artifactKey } = await context.params;
  const url = new URL(request.url);
  const result = await backendFetch(`/founders/artifacts/${encodeURIComponent(artifactKey)}${url.search}`, {
    method, headers: await foundersAuthHeaders(), ...(method === "PATCH" ? { body: await request.text() } : {}),
  });
  if (method === "DELETE" && result.ok) {
    const response = new NextResponse(null, { status: 204 }); applyFoundersSessionRotation(response, result.headers); return response;
  }
  const response = NextResponse.json(result.data ?? { error: "backend unavailable" }, { status: result.ok ? 200 : result.status });
  applyFoundersSessionRotation(response, result.headers); return response;
}

export function GET(request: Request, context: ArtifactRouteContext) { return proxy(request, context, "GET"); }
export function PATCH(request: Request, context: ArtifactRouteContext) { return proxy(request, context, "PATCH"); }
export function DELETE(request: Request, context: ArtifactRouteContext) { return proxy(request, context, "DELETE"); }
