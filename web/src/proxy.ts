import { NextResponse, type NextRequest } from "next/server";

import {
  decryptSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session-codec";

// neural-map.md §4.3: routes reachable while signed out (or mid-MFA) that
// should bounce an already-fully-authenticated visitor onward to the
// console instead of showing them the auth flow again.
const PUBLIC_AUTH_ROUTES = [
  "/signin",
  "/login",
  "/login/verify",
  "/signup",
  "/signup/mfa-setup",
  "/auth/totp/verify",
  "/auth/totp/setup",
  "/auth/totp/reset",
];

// Cheap, optimistic, cookie-shape-only check — no backend round-trip here.
// This is a UX convenience, not the security boundary (neural-map.md
// §15.1): the authoritative check is `verifySession()` in the DAL.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isConsoleRoute = pathname.startsWith("/console");

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = cookie ? await decryptSessionCookie(cookie) : null;

  if (isConsoleRoute && session?.state !== "authenticated") {
    const loginUrl = new URL("/signin", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (PUBLIC_AUTH_ROUTES.includes(pathname) && session?.state === "authenticated") {
    return NextResponse.redirect(new URL("/console/home", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|svg|webmanifest)$).*)",
  ],
};
