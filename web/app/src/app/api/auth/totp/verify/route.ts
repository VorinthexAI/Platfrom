import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

const bodySchema = z.strictObject({
  challenge_token_hash: z.string().min(8).max(128),
  code: z.string().regex(/^\d{6}$/),
});
const ACCESS_COOKIE = "vorinthex_access";
const REFRESH_COOKIE = "vorinthex_refresh";

/** Verifies a TOTP code for returning members and issues their session. */
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
      { ok: false, error: "Enter the 6-digit code." },
      { status: 400 },
    );
  }

  if (backendConfigured()) {
    const result = await backendFetch<{
      userId?: string;
      name?: string | null;
      organizationTitle?: string | null;
      accessToken?: string;
      refreshToken?: string;
    }>("/auth/totp/verify", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, error: "Invalid code — try the next one." },
        { status: result.status === 401 ? 401 : 502 },
      );
    }
    const response = NextResponse.json({
      ok: true,
      authenticated: true,
      name: result.data.name ?? null,
      title: result.data.organizationTitle ?? null,
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
