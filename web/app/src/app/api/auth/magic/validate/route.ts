import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

const bodySchema = z.strictObject({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * Validates a members magic link. The backend answers with the auth
 * status — either TOTP setup is required (first sign-in) or a TOTP code
 * verify is next — plus the challenge token that continues the flow.
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
    const result = await backendFetch<{
      status: string;
      totp_challenge_token_hash: string;
      expires_at: string;
    }>("/auth/magic/validate", {
      method: "POST",
      body: JSON.stringify({ token_hash: parsed.data.token_hash }),
    });
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, error: "This sign-in link is invalid or expired." },
        { status: result.status === 401 ? 401 : 502 },
      );
    }
    return NextResponse.json({ ok: true, ...result.data });
  }

  // Frontend-only development: pretend TOTP setup is required.
  return NextResponse.json({
    ok: true,
    status: "totp_setup_required",
    totp_challenge_token_hash: "0".repeat(64),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
}
