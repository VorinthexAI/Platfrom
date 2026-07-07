import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Member sign-in",
  description: "Complete your Vorinthex member sign-in.",
  robots: { index: false, follow: false },
};

/**
 * Members magic-link deep link (?token_hash=…): the galaxy loads and the
 * camera dives into the Cipher Chamber for TOTP setup or verification,
 * then hyper-jumps into /galaxy/private.
 */
export default function AuthTokenPage() {
  return <LandingPage initialCave="magic" />;
}
