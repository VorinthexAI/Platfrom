import type { NextResponse } from "next/server";

/**
 * Cross-device handoff cookies, set by the routes that request emailed
 * links and consumed by /api/auth/handoff/*:
 *
 * - HANDOFF_COOKIE holds the claim secret. httpOnly — page scripts never
 *   see it; only the claim/stream proxy routes read it.
 * - HANDOFF_MARKER_COOKIE is a plain, secretless "something is pending"
 *   flag the client reads to know a claim attempt is worth making.
 */
export const HANDOFF_COOKIE = "vx_handoff";
export const HANDOFF_MARKER_COOKIE = "vx_handoff_pending";

const isProduction = process.env.NODE_ENV === "production";

export function setHandoffCookies(
  response: NextResponse,
  handoffTokenHash: string,
  expiresAt: Date,
) {
  const maxAge = Math.max(
    60,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  response.cookies.set(HANDOFF_COOKIE, handoffTokenHash, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge,
  });
  response.cookies.set(HANDOFF_MARKER_COOKIE, "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge,
  });
}

export function clearHandoffCookies(response: NextResponse) {
  response.cookies.set(HANDOFF_COOKIE, "", { path: "/", maxAge: 0 });
  response.cookies.set(HANDOFF_MARKER_COOKIE, "", { path: "/", maxAge: 0 });
}

/** A decoy secret so responses look identical for unknown emails. */
export function randomDecoyHandoff() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
