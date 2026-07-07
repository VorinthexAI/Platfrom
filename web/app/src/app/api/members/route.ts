import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

const membersSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
});

/**
 * Members sign-in: requests a short-lived magic link from the backend.
 * The response is deliberately identical whether or not the email is a
 * member — membership can never be probed from here.
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

  if (backendConfigured()) {
    // Fire the request; swallow the outcome — generic success either way.
    await backendFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: parsed.data.email }),
    });
  }

  return NextResponse.json({ ok: true });
}
