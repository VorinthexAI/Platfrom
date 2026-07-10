import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

const bodySchema = z.strictObject({
  challenge_token_hash: z.string().min(8).max(128),
  codes: z.tuple([
    z.string().regex(/^\d{6}$/),
    z.string().regex(/^\d{6}$/),
  ]),
});
const ACCESS_COOKIE = "vorinthex_access";
const REFRESH_COOKIE = "vorinthex_refresh";

/** Completes TOTP setup: two successive codes prove the authenticator. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Enter two consecutive 6-digit codes." },
      { status: 400 },
    );
  }

  if (backendConfigured()) {
    const result = await backendFetch<{
      ok: boolean;
      authenticated: boolean;
      userId: string;
      name?: string | null;
      organization_title?: string | null;
      accessToken?: string;
      refreshToken?: string;
    }>("/auth/totp/setup/complete", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    if (!result.ok || !result.data?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            (result.data as { error?: string } | null)?.error ??
            "Codes did not match — try the next two codes.",
        },
        { status: result.status >= 500 ? 502 : 400 },
      );
    }
    const response = NextResponse.json({
      ok: true,
      authenticated: true,
      name: result.data.name ?? null,
      title: result.data.organization_title ?? null,
    });
    const secure = process.env.NODE_ENV === "production";
    if (result.data.accessToken) {
      response.cookies.set(ACCESS_COOKIE, result.data.accessToken, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 60 * 60 * 24,
      });
    }
    if (result.data.refreshToken) {
      response.cookies.set(REFRESH_COOKIE, result.data.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  }

  return NextResponse.json({ ok: true, authenticated: true, name: null, title: null });
}
