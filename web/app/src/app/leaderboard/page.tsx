import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Galaxy Leaderboard",
  description:
    "The great collectors of the Vorinthex galaxy, ranked by Intelligence Fragments — live.",
};

/**
 * The galaxy leaderboard, anchored like a planet: this route (and the
 * waitlist-leaderboard.vorinthex.com subdomain, via the proxy) dives
 * straight into the leaderboard asteroid on load.
 */
export default function LeaderboardPage() {
  return <LandingPage initialCave="leaderboard" />;
}
