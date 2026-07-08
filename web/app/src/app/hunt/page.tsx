import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "The Hunt",
  description:
    "The great collectors of the Vorinthex galaxy, ranked by Intelligence Fragments — live.",
};

/**
 * The galaxy hunt, anchored like a planet: this route (and the
 * hunt.vorinthex.com subdomain, via the proxy) dives straight into the
 * hunt asteroid on load.
 */
export default function HuntPage() {
  return <LandingPage initialCave="hunt" />;
}
