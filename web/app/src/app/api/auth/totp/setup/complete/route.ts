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
    return NextResponse.json({ ok: true, authenticated: true });
  }

  return NextResponse.json({ ok: true, authenticated: true });
}
