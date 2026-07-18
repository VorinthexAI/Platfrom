import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

/** Dev stub so the Founders Gate shell is explorable without a backend. */
const DEV_STUB = {
  scopes: [
    { key: "dev-scope-nexus", name: "Nexus", position: 1, parentKey: null, path: ["Nexus"] },
    { key: "dev-scope-core", name: "Core", position: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Core"] },
    { key: "dev-scope-launch", name: "Launch", position: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Launch"] },
  ],
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationKey: string }> },
) {
  const { organizationKey } = await context.params;
  if (!backendConfigured()) return NextResponse.json(DEV_STUB);
  const result = await backendFetch(
    `/founders/organizations/${encodeURIComponent(organizationKey)}/scopes`,
    { headers: await foundersAuthHeaders() },
  );
  const response = NextResponse.json(
    result.data ?? { error: "backend unavailable" },
    { status: result.ok ? 200 : result.status },
  );
  applyFoundersSessionRotation(response, result.headers);
  return response;
}
