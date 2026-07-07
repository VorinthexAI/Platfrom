import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

const bodySchema = z.strictObject({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  flow: z.enum(["member", "user"]).optional(),
});

const ACCESS_COOKIE = "vorinthex_access";
const REFRESH_COOKIE = "vorinthex_refresh";

interface MagicValidatePayload {
  status: string;
  totp_challenge_token_hash?: string;
  expires_at?: string;
  access_token?: string;
  refresh_token?: string;
  alias?: string;
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
    const result = await backendFetch<MagicValidatePayload>("/auth/magic/validate", {
      method: "POST",
      body: JSON.stringify({ token_hash: parsed.data.token_hash }),
    });
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, error: "This sign-in link is invalid or expired." },
        { status: result.status === 401 ? 401 : 502 },
      );
    }

    if (result.data.status === "authenticated") {
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
    waitlist_number: 1,
    welcome_line: "Welcome back, Local Explorer.",
  });
}
