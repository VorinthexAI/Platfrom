import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

/** Dev stub so the Founders Gate shell is explorable without a backend. */
const DEV_STUB = {
  user: { key: "dev-founder", name: "Dev Founder", alias: null, email: "founder@vorinthex.dev" },
  rootOrganization: { key: "dev-root-org", name: "Vorinthex AI", alias: null },
  rootMembership: { role: "owner", title: "Owner" },
  applicationRole: "superAdmin",
};

export async function GET() {
  if (!backendConfigured()) return NextResponse.json(DEV_STUB);
  const result = await backendFetch("/founders/me", { headers: await foundersAuthHeaders() });
  return NextResponse.json(
    result.data ?? { error: "backend unavailable" },
    { status: result.ok ? 200 : result.status },
  );
}
