import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ organizationKey: string; providerSlug: string }> }) {
  const { organizationKey, providerSlug } = await context.params;
  if (!backendConfigured()) return NextResponse.json({ error: "backend unavailable" }, { status: 503 });
  const result = await backendFetch(
    `/founders/organizations/${encodeURIComponent(organizationKey)}/providers/${encodeURIComponent(providerSlug)}/credentials`,
    { method: "PUT", headers: await foundersAuthHeaders(), body: await request.text() },
  );
  const response = NextResponse.json(result.data ?? { error: "backend unavailable" }, { status: result.ok ? 200 : result.status });
  applyFoundersSessionRotation(response, result.headers);
  return response;
}
