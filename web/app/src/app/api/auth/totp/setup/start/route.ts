import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

const bodySchema = z.strictObject({
  challenge_token_hash: z.string().min(8).max(128),
});

/** A neutral placeholder QR for frontend-only development. */
const DEV_QR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#0d1117"/><text x="80" y="84" fill="#7b858c" font-size="11" font-family="monospace" text-anchor="middle">DEV QR</text></svg>`,
  );

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid challenge." }, { status: 400 });
  }

  if (backendConfigured()) {
    const result = await backendFetch<{
      setup_challenge_token_hash: string;
      secret: string;
      otpauth_url: string;
      qr_code_data_url: string;
    }>("/auth/totp/setup/start", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    if (!result.ok || !result.data) {
      return NextResponse.json(
        { ok: false, error: "Could not start authenticator setup." },
        { status: result.status === 401 ? 401 : 502 },
      );
    }
    return NextResponse.json({ ok: true, ...result.data });
  }

  return NextResponse.json({
    ok: true,
    setup_challenge_token_hash: "0".repeat(64),
    secret: "DEVSECRETDEVSECRET",
    otpauth_url: "otpauth://totp/Vorinthex:dev?secret=DEVSECRETDEVSECRET",
    qr_code_data_url: DEV_QR,
  });
}
