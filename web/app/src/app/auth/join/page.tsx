import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Enter your email to create or restore your explorer profile and track your fragments as the Hunt unfolds.",
  robots: { index: false, follow: false },
};

/**
 * Legacy join route: sign-in now creates new explorer profiles too.
 */
export default function JoinPage() {
  return <LandingPage initialCave="signin" />;
}
