import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendConfigured, backendFetch } from "@/lib/backend";

export const dynamic = "force-dynamic";

const DID_COOKIE = "vx_did";
/** The distinct id lives for one day, then a fresh one is rolled. */
const DID_MAX_AGE_SECONDS = 60 * 60 * 24;
const ACCESS_COOKIE = "vorinthex_access";

interface BackendJoinResponse {
  ok: boolean;
  session_key?: string;
  visitor_key?: string;
  alias?: string;
}

/**
 * Register this browser as a live galaxy visitor. Identity: the member
 * access token when present (backend derives the email hash from it),
 * with the 1-day `vx_did` distinct-id cookie as the anonymous fallback —
 * generated and (re)set here on every join.
 */
export async function POST(request: Request) {
  const jar = await cookies();
  const distinctId = jar.get(DID_COOKIE)?.value ?? crypto.randomUUID();
  const accessToken = jar.get(ACCESS_COOKIE)?.value;
  const forwardedFor = request.headers.get("x-forwarded-for");

  let payload: Record<string, unknown> = { ok: false };
  if (backendConfigured()) {
    const result = await backendFetch<BackendJoinResponse>("/presence/join", {
      method: "POST",
      body: JSON.stringify({ distinct_id: distinctId, source: "web" }),
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      },
    });
    if (result.ok && result.data?.ok) {
      payload = {
        ok: true,
        sessionKey: result.data.session_key,
        alias: result.data.alias ?? null,
      };
    }
  }

  const response = NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
  });
  response.cookies.set(DID_COOKIE, distinctId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: DID_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
