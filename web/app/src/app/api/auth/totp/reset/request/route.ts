import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { emailSchema } from "@/lib/email";

const bodySchema = z.strictObject({
  email: emailSchema,
});

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

  if (backendConfigured()) {
    await backendFetch("/auth/totp/reset/request", {
      method: "POST",
      body: JSON.stringify({ email: parsed.data.email }),
    });
  }

  return NextResponse.json({ ok: true });
}
