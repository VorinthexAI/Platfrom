import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

const bodySchema = z.strictObject({
  challenge_token_hash: z.string().min(8).max(128),
  code: z.string().regex(/^\d{6}$/),
});

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
      accessTokenMaxAgeSeconds?: number;
      refreshTokenMaxAgeSeconds?: number;
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
    setAuthSessionCookies(response, result.data);
    return response;
  }

  return NextResponse.json({ ok: true, authenticated: true, name: null, title: null });
}
