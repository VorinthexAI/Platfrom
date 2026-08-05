import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing/PricingPage";

export const metadata: Metadata = {
  title: "Core Pricing",
  description:
    "Start with the free Vorinthex Core personal AI, then add Archive, Gallery, Signal, Compass, or Ascend as monthly capabilities.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPageRoute() {
  return <PricingPage />;
}
