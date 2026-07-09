import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "MFA",
  description: "Verify your Vorinthex platform access.",
  robots: { index: false, follow: false },
};

/**
 * The platform MFA route: emailed 5-minute links land here and dive into
 * the Solar Gate biome — an MFA setup wizard for first-timers, a code
 * wizard for returning members. Success surfs straight into the sun.
 */
export default function MfaPage() {
  return <LandingPage initialCave="mfa" />;
}
