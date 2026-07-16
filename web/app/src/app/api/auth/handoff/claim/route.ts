import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendConfigured, backendFetch } from "@/lib/backend";
import {
  clearHandoffCookies,
  HANDOFF_COOKIE,
} from "@/lib/auth/handoff-cookies";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

interface HandoffClaimPayload {
  status: string;
  access_token?: string;
  refresh_token?: string;
  access_token_max_age_seconds?: number;
  refresh_token_max_age_seconds?: number;
  alias?: string;
  alias_slug?: string | null;
  waitlist_number?: number | null;
  welcome_line?: string;
  totp_challenge_token_hash?: string;
  expires_at?: string;
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
      alias_slug: "devx-local-explorer",
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

  if (!result.ok || !result.data) {
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

  if (
    result.data.status === "totp_setup_required" ||
    result.data.status === "totp_required"
  ) {
    const response = NextResponse.json({
      ok: true,
      status: result.data.status,
      totp_challenge_token_hash: result.data.totp_challenge_token_hash,
      expires_at: result.data.expires_at,
    });
    clearHandoffCookies(response);
    return response;
  }

  if (result.data.status !== "authenticated") {
    const response = NextResponse.json(
      { ok: false, status: "unclaimable" },
      { status: 200 },
    );
    return response;
  }

  const { access_token, refresh_token, access_token_max_age_seconds, refresh_token_max_age_seconds, ...publicPayload } = result.data;
  const response = NextResponse.json({ ok: true, ...publicPayload });
  setAuthSessionCookies(response, { accessToken: access_token, refreshToken: refresh_token, accessTokenMaxAgeSeconds: access_token_max_age_seconds, refreshTokenMaxAgeSeconds: refresh_token_max_age_seconds });
  clearHandoffCookies(response);
  return response;
}
