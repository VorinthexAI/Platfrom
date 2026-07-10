import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { emailSchema } from "@/lib/email";

const bodySchema = z.strictObject({
  email: emailSchema.optional(),
  challenge_token_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
const isProduction = process.env.NODE_ENV === "production";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Use a valid email address." }, { status: 400 });
  }

  if (!parsed.data.email && !parsed.data.challenge_token_hash) {
    return NextResponse.json(
      { ok: false, error: "Missing recovery target." },
      { status: 400 },
    );
  }

  if (!backendConfigured()) {
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "MFA reset is temporarily unavailable." },
        { status: 503 },
      );
    }
    return parsed.data.challenge_token_hash
      ? NextResponse.json({
          ok: true,
          reset: true,
          setup_challenge_token_hash: "0".repeat(64),
          secret: "DEVSECRETDEVSECRET",
          otpauth_url: "otpauth://totp/Vorinthex:dev?secret=DEVSECRETDEVSECRET",
          qr_code_data_url:
            "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iMTYwIj48cmVjdCB3aWR0aD0iMTYwIiBoZWlnaHQ9IjE2MCIgZmlsbD0iIzBkMTExNyIvPjx0ZXh0IHg9IjgwIiB5PSI4NCIgZmlsbD0iIzdiODU4YyIgZm9udC1zaXplPSIxMSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+REVWIFE8L3RleHQ+PC9zdmc+",
        })
      : NextResponse.json({ ok: true });
  }

  const result = await backendFetch<{
    ok?: boolean;
    reset?: boolean;
    setup_challenge_token_hash?: string;
    secret?: string;
    otpauth_url?: string;
    qr_code_data_url?: string;
  }>("/auth/totp/reset/request", {
    method: "POST",
    body: JSON.stringify(parsed.data),
  });

  if (!result.ok) {
    console.error("mfa reset backend request failed", { status: result.status });
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "Could not send an MFA reset link. Try again." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true, ...(result.data ?? {}) });
}
