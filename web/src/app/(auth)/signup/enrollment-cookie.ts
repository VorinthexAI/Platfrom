import "server-only";

// Shared between signup/actions.ts (writes it) and signup/mfa-setup/page.tsx
// + mfa-setup/actions.ts (read/clear it), so the cookie name/TTL can't drift
// between the two halves of the enrollment hand-off.
export const ENROLLMENT_COOKIE_NAME = "vx_signup_enrollment";
export const ENROLLMENT_COOKIE_TTL_SECONDS = 10 * 60;

export type EnrollmentPayload = {
  accountLabel: string;
  issuerLabel: string;
  otpauthUri: string;
  qrCodeImageSrc: string;
};
