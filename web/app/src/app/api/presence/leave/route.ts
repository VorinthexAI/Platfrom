import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  sessionKey: z.string().min(8).max(80),
});

/** Explicit goodbye (fired via sendBeacon on pagehide). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!backendConfigured()) {
    return NextResponse.json({ ok: true });
  }

  await backendFetch("/presence/leave", {
    method: "POST",
    body: JSON.stringify({ session_key: parsed.data.sessionKey }),
  });
  return NextResponse.json({ ok: true });
}
