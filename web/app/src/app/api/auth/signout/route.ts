import { NextResponse } from "next/server";
import { clearHandoffCookies } from "@/lib/auth/handoff-cookies";
import { clearAuthSessionCookies } from "@/lib/auth/session-cookies";

/**
 * Ends the explorer's session. Expires the auth cookies and any parked
 * cross-device handoff, but deliberately KEEPS `vx_explorer` so the
 * fragments this browser collected anonymously still merge back in on the
 * next sign-in.
 */
export function POST() {
  const response = NextResponse.json({ ok: true });
  clearAuthSessionCookies(response);
  clearHandoffCookies(response);
  return response;
}
