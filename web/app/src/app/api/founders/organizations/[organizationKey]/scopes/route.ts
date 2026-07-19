import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

/** Dev stub so the Founders Gate shell is explorable without a backend. */
const DEV_STUB = {
  scopes: [
    { key: "dev-scope-nexus", name: "Nexus", position: 1, level: 1, parentKey: null, path: ["Nexus"] },
    { key: "dev-scope-core", name: "Core", position: 1, level: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Core"] },
    { key: "dev-scope-launch", name: "Launch", position: 2, level: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Launch"] },
    { key: "dev-scope-studio", name: "Studio", position: 3, level: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Studio"] },
    { key: "dev-scope-head-quarters", name: "Head Quarters", position: 4, level: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Head Quarters"] },
    { key: "dev-scope-replica", name: "Replica", position: 5, level: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Replica"] },
    { key: "dev-scope-pilot", name: "Pilot", position: 6, level: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Pilot"] },
    { key: "dev-scope-command", name: "Command", position: 7, level: 2, parentKey: "dev-scope-nexus", path: ["Nexus", "Command"] },
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
