import { NextResponse } from "next/server";
import { clearHandoffCookies } from "@/lib/auth/handoff-cookies";

/**
 * Ends the explorer's session. Expires the auth cookies and any parked
 * cross-device handoff, but deliberately KEEPS `vx_explorer` so the
 * fragments this browser collected anonymously still merge back in on the
 * next sign-in.
 */
const ACCESS_COOKIE = "vorinthex_access";
const REFRESH_COOKIE = "vorinthex_refresh";

export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { path: "/", maxAge: 0 });
  clearHandoffCookies(response);
  return response;
}
