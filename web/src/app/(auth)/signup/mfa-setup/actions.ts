"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import {
  buildSessionPayload,
  encryptSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session-codec";
import { backendFetch } from "@/server/backend-client";

import { ENROLLMENT_COOKIE_NAME } from "../enrollment-cookie";

const confirmSchema = z.object({
  code: z.string().regex(/^[0-9]{6}$/, "Enter the 6-digit code."),
});

export type ConfirmEnrollmentResult = { ok: true } | { ok: false; message: string };

// §4.2 step 2: the confirm-code submit that proves the user actually
// enrolled the factor (not just saw the QR code). Reasonable endpoint shape
// since — like /auth/signup — this isn't enumerated in the §45 reference.
export async function confirmMfaEnrollmentAction(
  code: string,
): Promise<ConfirmEnrollmentResult> {
  const parsed = confirmSchema.safeParse({ code });
  if (!parsed.success) {
    return { ok: false, message: "Enter the 6-digit code." };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/signup/mfa/confirm", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    return {
      ok: false,
      message: body?.message ?? "That code didn't match. Try again.",
    };
  }

  const body = (await res.json().catch(() => ({}))) as { userId?: string };
  const payload = buildSessionPayload(body.userId ?? "authenticated-user", "authenticated");
  const cookieValue = await encryptSessionCookie(payload);
  const cookieStore = await cookies();
  cookieStore.delete(ENROLLMENT_COOKIE_NAME);
  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    maxAge: payload.exp - payload.iat,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { ok: true };
}
