"use server";

import { cookies } from "next/headers";

import {
  buildSessionPayload,
  encryptSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/server/auth/session-codec";
import { backendFetch } from "@/server/backend-client";

type BackendError = {
  error?: string;
  message?: string;
};

type LoginEmailResponse = {
  ok?: boolean;
  email_sent?: boolean;
  expires_at?: string;
};

type MagicValidateResponse = {
  userId?: string;
};

export type RequestSignInResult =
  | { ok: true; emailSent: true; expiresAt?: string }
  | { ok: false; message: string };

export type MagicValidateResult = { ok: true } | { ok: false; message: string };

export async function requestSignInEmailAction(input: {
  email: string;
}): Promise<RequestSignInResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as BackendError | null;
    return {
      ok: false,
      message:
        body?.error ?? body?.message ?? "We couldn't send a sign-in email. Try again.",
    };
  }

  const body = (await res.json().catch(() => ({}))) as LoginEmailResponse;
  return { ok: true, emailSent: true, expiresAt: body.expires_at };
}

export async function validateMagicLinkAction(
  tokenHash: string,
): Promise<MagicValidateResult> {
  if (!tokenHash) {
    return {
      ok: false,
      message: "This sign-in link is missing its token. Request a new sign-in email.",
    };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/magic/validate", {
      method: "POST",
      body: JSON.stringify({ token_hash: tokenHash }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as BackendError | null;
    return {
      ok: false,
      message:
        body?.error ??
        body?.message ??
        "This sign-in link is invalid or expired. Request a new sign-in email.",
    };
  }

  const body = (await res.json().catch(() => ({}))) as MagicValidateResponse;
  const payload = buildSessionPayload(body.userId ?? "authenticated-user");
  const cookieValue = await encryptSessionCookie(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { ok: true };
}
