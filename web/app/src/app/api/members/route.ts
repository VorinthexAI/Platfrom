import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";
import { emailSchema } from "@/lib/email";

const membersSchema = z.strictObject({
  email: emailSchema,
});
const isProduction = process.env.NODE_ENV === "production";

/**
 * Members sign-in: requests a short-lived magic link from the backend.
 * The response is deliberately identical for unknown members, but production
 * must not claim success if the backend bridge itself is unavailable.
 */
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

  const parsed = membersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Use a valid email address." },
      { status: 400 },
    );
  }

  if (!backendConfigured()) {
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "Members sign-in is temporarily unavailable." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  const result = await backendFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: parsed.data.email }),
  });

  if (!result.ok && result.status !== 403) {
    console.error("members sign-in backend request failed", {
      status: result.status,
    });
    if (isProduction) {
      return NextResponse.json(
        { ok: false, error: "Could not send a sign-in link. Try again." },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true });
}
