import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendConfigured, backendFetch } from "@/lib/backend";
import {
  clearHandoffCookies,
  HANDOFF_COOKIE,
} from "@/lib/auth/handoff-cookies";

const ACCESS_COOKIE = "vorinthex_access";
const REFRESH_COOKIE = "vorinthex_refresh";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

interface HandoffClaimPayload {
  status: string;
  access_token?: string;
  refresh_token?: string;
  alias?: string;
  waitlist_number?: number | null;
  welcome_line?: string;
}

/**
 * One-shot claim of an approved cross-device handoff. The secret only ever
 * lives in the httpOnly cookie parked when the emailed link was requested;
 * a successful claim becomes this browser's real session.
 */
export async function POST() {
  const jar = await cookies();
  const handoff = jar.get(HANDOFF_COOKIE)?.value;
  if (!handoff || !HASH_PATTERN.test(handoff)) {
    return NextResponse.json({ ok: false, status: "none" });
  }

  if (!backendConfigured()) {
    // Frontend-only development: complete the flow with a local explorer.
    const response = NextResponse.json({
      ok: true,
      status: "authenticated",
      alias: "Local Explorer",
      waitlist_number: 1,
      welcome_line: "Welcome back, Local Explorer.",
    });
    clearHandoffCookies(response);
    return response;
  }

  const result = await backendFetch<HandoffClaimPayload>("/auth/handoff/claim", {
    method: "POST",
    body: JSON.stringify({ handoff_token_hash: handoff }),
  });

  if (!result.ok || !result.data || result.data.status !== "authenticated") {
    const response = NextResponse.json(
      { ok: false, status: "unclaimable" },
      { status: 200 },
    );
    if (result.status === 401) {
      // Consumed, expired, or bogus: stop future attempts.
      clearHandoffCookies(response);
    }
    return response;
  }

  const { access_token, refresh_token, ...publicPayload } = result.data;
  const response = NextResponse.json({ ok: true, ...publicPayload });
  const secure = process.env.NODE_ENV === "production";
  if (access_token) {
    response.cookies.set(ACCESS_COOKIE, access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60,
    });
  }
  if (refresh_token) {
    response.cookies.set(REFRESH_COOKIE, refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  clearHandoffCookies(response);
  return response;
}
