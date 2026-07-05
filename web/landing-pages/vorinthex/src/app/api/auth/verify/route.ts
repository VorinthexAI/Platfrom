import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { backendFetch } from "@/server/backend-client";
import {
  buildSessionPayload,
  decryptSessionCookie,
  encryptSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session-codec";

const verifySchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, "Enter the 6-digit code."),
});

// Thin proxy to POST /auth/verify (neural-map.md §4.2 step 4, §45). No
// client-side TOTP validation ever happens (§4.5) — the 6 digits are opaque
// here too, always round-tripped to the backend.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "AUTH_INVALID_REQUEST", message: "Enter the 6-digit code." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const existingRaw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const existing = await decryptSessionCookie(existingRaw);
  if (!existing || existing.state !== "mfa_required") {
    return NextResponse.json(
      { code: "AUTH_SESSION_EXPIRED", message: "Your sign-in attempt expired. Start again." },
      { status: 401 },
    );
  }

  let backendRes: Response;
  try {
    backendRes = await backendFetch("/auth/verify", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return NextResponse.json(
      { code: "AUTH_BACKEND_UNREACHABLE", message: "Couldn't reach the server. Try again." },
      { status: 502 },
    );
  }

  if (!backendRes.ok) {
    // 401 (wrong code, includes details.attemptsRemaining) and 423 (locked
    // out, includes details.retryAfterMs) are both just relayed as-is —
    // the verify screen reads those fields directly (§4.5, §40.2).
    const errorBody = await backendRes.json().catch(() => null);
    return NextResponse.json(
      errorBody ?? {
        code: "AUTH_INVALID_CODE",
        message: "That code didn't match. Try again.",
      },
      { status: backendRes.status },
    );
  }

  const data = (await backendRes.json().catch(() => ({}))) as {
    userId?: string;
  };
  const sub = data.userId ?? existing.sub;

  const payload = buildSessionPayload(sub, "authenticated");
  const cookieValue = await encryptSessionCookie(payload);

  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    maxAge: payload.exp - payload.iat,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ state: "authenticated" as const });
}
