import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Verify your email",
  description: "Confirm your email to start tracking your fragments in The Hunt.",
  robots: { index: false, follow: false },
};

/**
 * Waitlist verification deep link (?token_hash=…): the visitor travels
 * into the solar system while the token verifies in the background, then
 * hyper-jumps straight into their public galaxy. Only a dead link falls
 * back into the Ember Vault story.
 */
export default function WaitlistVerifyPage() {
  return <LandingPage arrival="waitlist-verify" />;
}
