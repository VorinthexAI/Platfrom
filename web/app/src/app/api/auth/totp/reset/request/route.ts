import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { emailSchema } from "@/lib/email";

const bodySchema = z.strictObject({
  email: emailSchema,
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

  if (!backendConfigured()) {
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "MFA reset is temporarily unavailable." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  const result = await backendFetch("/auth/totp/reset/request", {
    method: "POST",
    body: JSON.stringify({ email: parsed.data.email }),
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

  return NextResponse.json({ ok: true });
}
