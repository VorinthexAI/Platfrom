import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

const bodySchema = z.strictObject({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  flow: z.enum(["member", "user"]).optional(),
});

const EXPLORER_COOKIE = "vx_explorer";

interface MagicValidatePayload {
  status: string;
  totp_challenge_token_hash?: string;
  expires_at?: string;
  access_token?: string;
  refresh_token?: string;
  access_token_max_age_seconds?: number;
  refresh_token_max_age_seconds?: number;
  alias?: string;
  alias_slug?: string | null;
  waitlist_number?: number | null;
  welcome_line?: string;
}

/**
 * Validates a magic link. The backend answers with the auth status —
 * "authenticated" for waitlist explorers (a direct session, no TOTP), or a
 * TOTP setup/verify challenge for members and super admins.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid link." }, { status: 400 });
  }

  if (backendConfigured()) {
    // Fragments collected anonymously in this browser (as its explorerId)
    // merge into the account on every sign in — not just the first join.
    const explorerId = (await cookies()).get(EXPLORER_COOKIE)?.value;
    const result = await backendFetch<MagicValidatePayload>("/auth/magic/validate", {
      method: "POST",
      body: JSON.stringify({
        token_hash: parsed.data.token_hash,
        ...(explorerId ? { explorer_id: explorerId } : {}),
      }),
    });
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, error: "This sign-in link is invalid or expired." },
        { status: result.status === 401 ? 401 : 502 },
      );
    }

    if (result.data.status === "authenticated") {
      const { access_token, refresh_token, access_token_max_age_seconds, refresh_token_max_age_seconds, ...publicPayload } = result.data;
      const response = NextResponse.json({ ok: true, ...publicPayload });
      setAuthSessionCookies(response, { accessToken: access_token, refreshToken: refresh_token, accessTokenMaxAgeSeconds: access_token_max_age_seconds, refreshTokenMaxAgeSeconds: refresh_token_max_age_seconds });
      return response;
    }

    return NextResponse.json({ ok: true, ...result.data });
  }

  // Frontend-only development: simulate the flow the link asked for.
  if (parsed.data.flow === "member") {
    return NextResponse.json({
      ok: true,
      status: "totp_setup_required",
      totp_challenge_token_hash: "0".repeat(64),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  }
  return NextResponse.json({
    ok: true,
    status: "authenticated",
    alias: "Local Explorer",
    alias_slug: "devx-local-explorer",
    waitlist_number: 1,
    welcome_line: "Welcome back, Local Explorer.",
  });
}
