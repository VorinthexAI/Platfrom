import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Join the Hunt",
  description:
    "Enter your email to start your explorer profile and track your fragments as the Hunt unfolds.",
  robots: { index: false, follow: false },
};

/**
 * The join route: dives straight into the waitlist cave on load, where a
 * visitor leaves their email and is told to check their inbox.
 */
export default function JoinPage() {
  return <LandingPage initialCave="join" />;
}
