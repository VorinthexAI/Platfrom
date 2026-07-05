"use server";

import { cookies } from "next/headers";

import { backendFetch } from "@/server/backend-client";

import {
  ENROLLMENT_COOKIE_NAME,
  ENROLLMENT_COOKIE_TTL_SECONDS,
  type EnrollmentPayload,
} from "./enrollment-cookie";
import { signupSchema, type SignupInput } from "./schema";

export type SignupResult =
  | { ok: true }
  | { ok: false; message: string };

// §4.2 step 1: not part of the §45 OpenAPI reference (the plan's own doc
// notes signup isn't enumerated there even though §4.2 describes it), so
// this uses a reasonable POST /auth/signup shape returning the TOTP
// enrollment payload the existing <TotpSetup/> component expects. That
// payload is carried to /signup/mfa-setup via a short-lived httpOnly
// cookie (not a query string, to keep it out of browser history/referrer
// headers) rather than being encrypted — it's the same data already baked
// into the QR image the user is about to scan, so it isn't gaining any new
// exposure by living in a cookie for a few minutes (neural-map.md §15.1).
export async function signupAction(input: SignupInput): Promise<SignupResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email and a stronger password." };
  }

  let res: Response;
  try {
    res = await backendFetch("/auth/signup", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Try again." };
  }

  if (!res.ok) {
    return { ok: false, message: await extractErrorMessage(res) };
  }

  const data = (await res.json().catch(() => ({}))) as Partial<EnrollmentPayload>;
  if (!data.otpauthUri || !data.qrCodeImageSrc) {
    return { ok: false, message: "Something went wrong creating your account." };
  }

  const enrollment: EnrollmentPayload = {
    accountLabel: data.accountLabel ?? parsed.data.email,
    issuerLabel: data.issuerLabel ?? "Vorinthex AI",
    otpauthUri: data.otpauthUri,
    qrCodeImageSrc: data.qrCodeImageSrc,
  };

  const cookieStore = await cookies();
  cookieStore.set(ENROLLMENT_COOKIE_NAME, JSON.stringify(enrollment), {
    httpOnly: true,
    maxAge: ENROLLMENT_COOKIE_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return { ok: true };
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    return data.message ?? data.error ?? "Something went wrong. Please try again.";
  } catch {
    return "Something went wrong. Please try again.";
  }
}
