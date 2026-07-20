import { NextResponse } from "next/server";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { applyFoundersSessionRotation, foundersAuthHeaders } from "@/lib/founders/server";

export const dynamic = "force-dynamic";

/** Rotates the single-use founder refresh token and persists its replacement. */
export async function POST() {
  if (!backendConfigured()) return NextResponse.json({ ok: true });

  const result = await backendFetch("/auth/refresh", {
    method: "POST",
    headers: await foundersAuthHeaders(),
    body: "{}",
  });
  const response = NextResponse.json(
    { ok: result.ok },
    { status: result.ok ? 200 : result.status },
  );
  applyFoundersSessionRotation(response, result.headers);
  return response;
}
