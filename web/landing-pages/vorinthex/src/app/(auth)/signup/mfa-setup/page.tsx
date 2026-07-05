import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ENROLLMENT_COOKIE_NAME, type EnrollmentPayload } from "../enrollment-cookie";
import { MfaSetupForm } from "./mfa-setup-form";

export const metadata: Metadata = {
  title: "Set up two-factor authentication",
};

export default async function MfaSetupPage() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ENROLLMENT_COOKIE_NAME)?.value;

  if (!raw) {
    // No (or expired) enrollment payload — the user must sign up again to
    // get a fresh TOTP secret/QR from the backend.
    redirect("/signup");
  }

  let enrollment: EnrollmentPayload;
  try {
    enrollment = JSON.parse(raw) as EnrollmentPayload;
  } catch {
    redirect("/signup");
  }

  return <MfaSetupForm enrollment={enrollment} />;
}
