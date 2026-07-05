import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { backendFetch } from "@/server/backend-client";
import {
  buildSessionPayload,
  encryptSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session-codec";

const loginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});

// Thin proxy to POST /auth/login (neural-map.md §45). The backend's own
// Set-Cookie header format is unspecified/mocked at this stage, so rather
// than try to forward it verbatim, we mint our own `vx_session` cookie from
// the backend's JSON body — this keeps the cookie's shape entirely owned by
// session-codec.ts regardless of what the backend actually does, and is the
// simpler of the two options the plan explicitly allows for.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "AUTH_INVALID_REQUEST", message: "Enter a valid email and password." },
      { status: 400 },
    );
  }

  let backendRes: Response;
  try {
    backendRes = await backendFetch("/auth/login", {
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
    const errorBody = await backendRes.json().catch(() => null);
    return NextResponse.json(
      errorBody ?? {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "That email and password didn't match.",
      },
      { status: backendRes.status },
    );
  }

  const data = (await backendRes.json().catch(() => ({}))) as {
    userId?: string;
  };
  const sub = data.userId ?? parsed.data.email;

  const payload = buildSessionPayload(sub, "mfa_required");
  const cookieValue = await encryptSessionCookie(payload);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    maxAge: payload.exp - payload.iat,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ state: "mfa_required" as const });
}
