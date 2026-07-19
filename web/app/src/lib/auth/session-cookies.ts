export const ACCESS_COOKIE = "vorinthex_access";
export const REFRESH_COOKIE = "vorinthex_refresh";

interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
  domain?: string;
}

interface SessionCookieResponse {
  cookies: {
    set(name: string, value: string, options: SessionCookieOptions): unknown;
  };
}

interface AuthSessionTokens {
  accessToken?: string;
  refreshToken?: string;
  accessTokenMaxAgeSeconds?: number;
  refreshTokenMaxAgeSeconds?: number;
}

function requireMaxAge(value: number | undefined, cookieName: string) {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    throw new Error(`Missing valid ${cookieName} max age from backend session policy`);
  }
  return value;
}

/** Applies the backend-selected access and refresh lifetimes at every auth entry point. */
export function setAuthSessionCookies(
  response: SessionCookieResponse,
  tokens: AuthSessionTokens,
  secure = process.env.NODE_ENV === "production",
  domain = process.env.NODE_ENV === "production" ? "vorinthex.com" : undefined,
) {
  const options = (maxAge: number, cookieDomain: string | null = domain ?? null) => ({
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  } as const);
  if (tokens.accessToken) {
    // Remove the pre-root-domain cookie. Otherwise an old host-only refresh
    // token can win when the browser sends duplicate cookie names.
    if (domain) response.cookies.set(ACCESS_COOKIE, "", options(0, null));
    response.cookies.set(ACCESS_COOKIE, tokens.accessToken, options(requireMaxAge(tokens.accessTokenMaxAgeSeconds, ACCESS_COOKIE)));
  }
  if (tokens.refreshToken) {
    if (domain) response.cookies.set(REFRESH_COOKIE, "", options(0, null));
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, options(requireMaxAge(tokens.refreshTokenMaxAgeSeconds, REFRESH_COOKIE)));
  }
}
