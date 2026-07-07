import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Sign In",
  description:
    "Sign in to restore your Vorinthex explorer profile and Intelligence Fragments.",
  robots: { index: false, follow: false },
};

/**
 * The sign-in asteroid, anchored like a planet: this route dives straight
 * into the explorer Grove on load. Unverified visitors to the public
 * galaxy are sent here — only the sign-in light from their email (or an
 * already verified profile on this device) opens the galaxy.
 */
export default function SignInPage() {
  return <LandingPage initialCave="signin" />;
}
