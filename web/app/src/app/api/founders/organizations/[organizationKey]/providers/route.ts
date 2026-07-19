import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ organizationKey: string }> }) {
  const { organizationKey } = await context.params;
  if (!backendConfigured()) return NextResponse.json({ providers: [] });
  const result = await backendFetch(
    `/founders/organizations/${encodeURIComponent(organizationKey)}/providers`,
    { headers: await foundersAuthHeaders() },
  );
  const response = NextResponse.json(result.data ?? { error: "backend unavailable" }, { status: result.ok ? 200 : result.status });
  applyFoundersSessionRotation(response, result.headers);
  return response;
}
