import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing/PricingPage";

export const metadata: Metadata = {
  title: "Sparks Pricing",
  description:
    "Usage-based Vorinthex pricing with free newcomer Sparks, monthly Sparks plans, top-ups, and On-Demand access for Nova members.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPageRoute() {
  return <PricingPage />;
}
