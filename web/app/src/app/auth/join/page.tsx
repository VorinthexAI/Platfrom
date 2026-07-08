import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Join the hunt",
  description:
    "Join the Vorinthex waitlist and start collecting Intelligence Fragments.",
  robots: { index: false, follow: false },
};

/**
 * The join route: dives straight into the waitlist cave on load, where a
 * visitor leaves their email and is told to check their inbox.
 */
export default function JoinPage() {
  return <LandingPage initialCave="join" />;
}
