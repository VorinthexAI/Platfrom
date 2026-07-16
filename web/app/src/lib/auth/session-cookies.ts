export const ACCESS_COOKIE = "vorinthex_access";
export const REFRESH_COOKIE = "vorinthex_refresh";

interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
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
) {
  const options = (maxAge: number) => ({
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  } as const);
  if (tokens.accessToken) response.cookies.set(ACCESS_COOKIE, tokens.accessToken, options(requireMaxAge(tokens.accessTokenMaxAgeSeconds, ACCESS_COOKIE)));
  if (tokens.refreshToken) response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, options(requireMaxAge(tokens.refreshTokenMaxAgeSeconds, REFRESH_COOKIE)));
}
