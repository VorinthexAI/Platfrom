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
};

type BackendSessionResponse = {
  userId: string;
  state: "authenticated";
  displayName: string;
  avatarUrl: string | null;
};

function toSession(data: BackendSessionResponse): Session {
  return {
    userId: data.userId,
    displayName: data.displayName,
    avatarUrl: data.avatarUrl,
  };
}

/**
 * Authoritative session check for Server Components. Call this from any
 * layout/page that must be authenticated — it hard-redirects to /signin on
 * any failure (missing cookie, unreachable backend, expired/invalid
 * session). Memoized per-request via React `cache()` so multiple call
 * sites in one render pass only hit the backend once.
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
 * instead of redirecting, letting the caller respond with a plain 401.
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
