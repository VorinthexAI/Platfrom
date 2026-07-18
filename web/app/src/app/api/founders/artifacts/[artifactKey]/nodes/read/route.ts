import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ artifactKey: string }> }) {
  const { artifactKey } = await context.params;
  const result = await backendFetch(`/founders/artifacts/${encodeURIComponent(artifactKey)}/nodes/read`, { method: "POST", headers: await foundersAuthHeaders(), body: await request.text() });
  const response = NextResponse.json(result.data ?? { error: "backend unavailable" }, { status: result.ok ? 200 : result.status });
  applyFoundersSessionRotation(response, result.headers);
  return response;
}
