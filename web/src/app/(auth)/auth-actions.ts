"use server";

import { cookies } from "next/headers";

import {
  buildSessionPayload,
  encryptSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session-codec";
import { backendFetch } from "@/server/backend-client";

type BackendError = {
  action?: string;
  error?: string;
  message?: string;
};

type LoginEmailResponse = {
  ok?: boolean;
  email_sent?: boolean;
  expires_at?: string;
};

type MagicValidateResponse = {
  status?: "totp_required" | "totp_setup_required";
  totp_challenge_token_hash?: string;
  expires_at?: string;
};

type TotpSetupStartResponse = {
  setup_challenge_token_hash?: string;
  secret?: string;
  otpauth_url?: string;
  qr_code_data_url?: string;
};

type AuthSuccessResponse = {
  authenticated?: boolean;
  ok?: boolean;
  userId?: string;
};

export type RequestSignInResult =
  | { ok: true; emailSent: true; expiresAt?: string }
  | { ok: false; action?: string; message: string };

export type MagicValidateResult =
  | {
      ok: true;
      status: "totp_required" | "totp_setup_required";
      challengeTokenHash: string;
      expiresAt?: string;
    }
  | { ok: false; message: string };

export type TotpSetupStartResult =
  | {
      ok: true;
      otpauthUrl: string;
      qrCodeDataUrl: string;
      secret: string;
      setupChallengeTokenHash: string;
    }
  | { ok: false; message: string };

export type AuthSubmitResult =
  | { ok: true }
  | { ok: false; expired?: boolean; message: string };

export type ResetRequestResult =
  | { ok: true; expiresAt?: string }
  | { ok: false; message: string };

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
      action: body?.action,
      message:
        body?.error ??
        body?.message ??
        "We couldn't send a sign-in email. Try again.",
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
  if (
    (body.status === "totp_required" ||
      body.status === "totp_setup_required") &&
    body.totp_challenge_token_hash
  ) {
    return {
      ok: true,
      status: body.status,
      challengeTokenHash: body.totp_challenge_token_hash,
      expiresAt: body.expires_at,
    };
  }

  return {
    ok: false,
    message: "This sign-in link returned an unexpected response. Request a new one.",
  };
}

export async function startTotpSetup(
  challengeTokenHash: string,
): Promise<TotpSetupStartResult> {
  if (!challengeTokenHash) {
    return {
      ok: false,
      message: "This setup link is missing its challenge. Request a new sign-in email.",
    };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/totp/setup/start", {
      method: "POST",
      body: JSON.stringify({ challenge_token_hash: challengeTokenHash }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as BackendError | null;
    return {
      ok: false,
      message: friendlySetupError(body?.error ?? body?.message),
    };
  }

  const body = (await res.json().catch(() => ({}))) as TotpSetupStartResponse;
  if (
    body.setup_challenge_token_hash &&
    body.secret &&
    body.otpauth_url &&
    body.qr_code_data_url
  ) {
    return {
      ok: true,
      otpauthUrl: body.otpauth_url,
      qrCodeDataUrl: body.qr_code_data_url,
      secret: body.secret,
      setupChallengeTokenHash: body.setup_challenge_token_hash,
    };
  }

  return { ok: false, message: "Authenticator setup did not return a QR code." };
}

export async function verifyTotpAction(input: {
  challengeTokenHash: string;
  code: string;
}): Promise<AuthSubmitResult> {
  if (!/^[0-9]{6}$/.test(input.code)) {
    return { ok: false, message: "Enter the 6-digit code." };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/totp/verify", {
      method: "POST",
      body: JSON.stringify({
        challenge_token_hash: input.challengeTokenHash,
        code: input.code,
      }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as BackendError | null;
    return {
      ok: false,
      expired: res.status === 401,
      message:
        body?.error ??
        body?.message ??
        "That code did not work. Check your authenticator and try again.",
    };
  }

  const body = (await res.json().catch(() => ({}))) as AuthSuccessResponse;
  await setAuthenticatedSession(body.userId ?? "authenticated-user");
  return { ok: true };
}

export async function completeTotpSetupAction(input: {
  setupChallengeTokenHash: string;
  codes: [string, string];
}): Promise<AuthSubmitResult> {
  if (!input.codes.every((code) => /^[0-9]{6}$/.test(code))) {
    return { ok: false, message: "Enter two consecutive 6-digit codes." };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/totp/setup/complete", {
      method: "POST",
      body: JSON.stringify({
        challenge_token_hash: input.setupChallengeTokenHash,
        codes: input.codes,
      }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as BackendError | null;
    const raw = body?.error ?? body?.message;
    return {
      ok: false,
      expired: raw?.includes("expired"),
      message: friendlySetupError(raw),
    };
  }

  const body = (await res.json().catch(() => ({}))) as AuthSuccessResponse;
  await setAuthenticatedSession(body.userId ?? "authenticated-user");
  return { ok: true };
}

export async function requestMfaResetAction(input: {
  email: string;
}): Promise<ResetRequestResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/totp/reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    return {
      ok: false,
      message: "We couldn't request a reset link. Try again.",
    };
  }

  const body = (await res.json().catch(() => ({}))) as { expires_at?: string };
  return { ok: true, expiresAt: body.expires_at };
}

async function setAuthenticatedSession(userId: string) {
  const payload = buildSessionPayload(userId, "authenticated");
  const cookieValue = await encryptSessionCookie(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    maxAge: payload.exp - payload.iat,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function friendlySetupError(error: string | undefined) {
  if (!error) {
    return "Authenticator setup is not available for this link. Request a new sign-in or reset link.";
  }

  if (error.includes("expired")) {
    return "This reset link expired. Request a new reset link.";
  }
  if (error.includes("totp codes") || error.includes("code")) {
    return "Those codes did not work. Wait for two fresh codes and try again.";
  }
  if (error.includes("unavailable") || error.includes("already enabled")) {
    return "Authenticator setup is not available for this link. Request a new sign-in or reset link.";
  }
  if (error.includes("challenge")) {
    return "This verification session expired. Request a new sign-in email.";
  }

  return error;
}
