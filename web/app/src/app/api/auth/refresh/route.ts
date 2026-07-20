import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

/** Probes founder auth so middleware rotates and returns one fresh token pair. */
export async function POST() {
  if (!backendConfigured()) return NextResponse.json({ ok: true });

  const result = await backendFetch("/founders/me", {
    headers: await foundersAuthHeaders(),
  });
  const response = NextResponse.json(
    { ok: result.ok },
    { status: result.ok ? 200 : result.status },
  );
  applyFoundersSessionRotation(response, result.headers);
  return response;
}
