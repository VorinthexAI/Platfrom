import "server-only";

import { cookies } from "next/headers";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

/**
 * Founders Gate route handlers forward the httpOnly access and refresh
 * cookies to the backend. The backend re-resolves the user and enforces
 * root-organization, organization, and scope access on its own — these
 * handlers are a transport bridge, never an authorization layer.
 */
export async function foundersAuthHeaders(): Promise<Record<string, string>> {
  const store = await cookies();
  const accessToken = store.get("vorinthex_access")?.value;
  const refreshToken = store.get("vorinthex_refresh")?.value;
  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(refreshToken ? { "X-Refresh-Token": refreshToken } : {}),
  };
}

interface CookieResponse {
  cookies: {
    set(name: string, value: string, options: {
      httpOnly: true;
      sameSite: "lax";
      secure: boolean;
      path: "/";
      maxAge: number;
    }): unknown;
  };
}

/** Persist a token pair rotated by the backend's global auth middleware. */
export function applyFoundersSessionRotation(response: CookieResponse, headers: Headers | null) {
  if (!headers) return;
  const accessToken = headers.get("x-access-token");
  const refreshToken = headers.get("x-refresh-token");
  const accessTokenMaxAgeSeconds = Number(headers.get("x-access-token-max-age"));
  const refreshTokenMaxAgeSeconds = Number(headers.get("x-refresh-token-max-age"));
  if (!accessToken || !refreshToken || !Number.isInteger(accessTokenMaxAgeSeconds) || accessTokenMaxAgeSeconds <= 0
    || !Number.isInteger(refreshTokenMaxAgeSeconds) || refreshTokenMaxAgeSeconds <= 0) return;
  setAuthSessionCookies(response, {
    accessToken,
    refreshToken,
    accessTokenMaxAgeSeconds,
    refreshTokenMaxAgeSeconds,
  });
}
