import { NextResponse } from "next/server";
import { z } from "zod";
import { backendConfigured, backendFetch } from "@/lib/backend";

export const dynamic = "force-dynamic";

const coordinate = z.number().finite().min(-5000).max(5000);
const bodySchema = z.strictObject({
  sessionKey: z.string().min(8).max(80),
  position: z.tuple([coordinate, coordinate, coordinate]),
});

/** Heartbeat + camera position; keeps the presence session alive. */
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
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const result = await backendFetch<{ ok: boolean }>("/presence/beat", {
    method: "POST",
    body: JSON.stringify({
      session_key: parsed.data.sessionKey,
      position: parsed.data.position,
    }),
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : undefined,
  });
  // 410 tells the client its session expired and it should re-join.
  return NextResponse.json(
    { ok: result.ok },
    { status: result.ok ? 200 : result.status === 410 ? 410 : 502 },
  );
}
