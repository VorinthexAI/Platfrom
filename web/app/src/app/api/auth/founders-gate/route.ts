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
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Use a valid email address." },
      { status: 400 },
    );
  }

  if (!backendConfigured()) {
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "Founders Gate is temporarily unavailable." },
        { status: 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      status: "totp_setup_required",
      totp_challenge_token_hash: "0".repeat(64),
      name: null,
      title: "Founder",
    });
  }

  const result = await backendFetch<{
    status?: "totp_setup_required" | "totp_required";
    totp_challenge_token_hash?: string;
    name?: string | null;
    organization_title?: string | null;
  }>("/auth/founders-gate", {
    method: "POST",
    body: JSON.stringify({ email: parsed.data.email }),
  });

  if (!result.ok || !result.data?.status || !result.data.totp_challenge_token_hash) {
    return NextResponse.json(
      { ok: false, error: "Founder identity not found." },
      { status: result.status === 403 ? 403 : 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.data.status,
    totp_challenge_token_hash: result.data.totp_challenge_token_hash,
    name: result.data.name ?? null,
    title: result.data.organization_title ?? null,
  });
}
