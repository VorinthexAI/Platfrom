import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { backendFetch } from "@/server/backend-client";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-codec";

export type Session = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  mfaLevel: "totp";
};

type BackendSessionResponse = {
  userId: string;
  state: "authenticated";
  displayName: string;
  avatarUrl: string | null;
  mfaLevel: "totp";
};

function toSession(data: BackendSessionResponse): Session {
  return {
    userId: data.userId,
    displayName: data.displayName,
    avatarUrl: data.avatarUrl,
    mfaLevel: data.mfaLevel,
  };
}

/**
 * Authoritative session check for Server Components (neural-map.md §4.4).
 * `console/layout.tsx` (owned by another agent) is expected to call this —
 * i.e. this is the SHELL-LEVEL check.
 *
 * Per ADR-007 (§20): `unauthorized()`/`app/console/unauthorized.tsx` is
 * deliberately NOT used here, even though §3.2/§4.2's earlier, more
 * illustrative framing suggested it. Using it at `console/layout.tsx` would
 * re-render the whole segment tree in place of the persistently-mounted
 * shell on every session hiccup — destroying the WebGL context and the
 * chat composer's draft exactly when an *unplanned* interruption makes
 * preserving that state matter most. So both failure modes (missing
 * cookie, and an invalid/expired/not-fully-MFA'd session) hard-redirect to
 * /login instead. `unauthorized()` is reserved for narrow, leaf-level
 * checks (e.g. inside a specific Server Action) — not wired up anywhere
 * yet, but `app/console/unauthorized.tsx` stays in place as the file
 * Next's convention requires for any future such call site.
 *
 * Memoized per-request via React `cache()` so multiple call sites in one
 * render pass only hit the backend once.
 */
export const verifySession = cache(async (): Promise<Session> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) {
    redirect("/signin");
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/session", { method: "GET" });
  } catch {
    redirect("/signin");
  }

  if (!res.ok) {
    redirect("/signin");
  }

  const data = (await res.json().catch(() => null)) as
    | BackendSessionResponse
    | null;
  if (!data || data.state !== "authenticated") {
    redirect("/signin");
  }

  return toSession(data);
});

/**
 * Route-handler-safe variant: route handlers can't render `unauthorized.tsx`
 * (that's a page/Server Component convention), so this returns `null`
 * instead of throwing, letting the caller respond with a plain 401 JSON body.
 */
export const verifySessionForRoute = cache(
  async (): Promise<Session | null> => {
    const cookieStore = await cookies();
    const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!raw) return null;

    let res: Response;
    try {
      res = await backendFetch("/auth/session", { method: "GET" });
    } catch {
      return null;
    }

    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as
      | BackendSessionResponse
      | null;
    if (!data || data.state !== "authenticated") return null;

    return toSession(data);
  },
);
