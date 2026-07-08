import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Members",
  description:
    "Enter the Vorinthex members gate to reach the private galaxy.",
  robots: { index: false, follow: false },
};

/**
 * The members route: dives straight into the members gate on load — email
 * form → magic link → TOTP → private galaxy.
 */
export default function MembersPage() {
  return <LandingPage initialCave="members" />;
}
