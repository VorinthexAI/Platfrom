import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Confirm your email to secure your Vorinthex waitlist spot.",
  robots: { index: false, follow: false },
};

/**
 * Waitlist verification deep link (?token_hash=…): the galaxy loads and
 * the camera dives straight into the Ember Vault, where the token is
 * verified and the explorer's alias and waitlist number are revealed.
 */
export default function WaitlistVerifyPage() {
  return <LandingPage initialCave="waitlist-verify" />;
}
