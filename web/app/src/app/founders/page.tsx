import type { Metadata } from "next";
import { FoundersGateApp } from "@/components/founders/FoundersGateApp";

export const metadata: Metadata = {
  title: "Founders Gate",
  description: "Ask Beacon inside the Vorinthex star.",
  robots: { index: false, follow: false },
};

export default function FoundersPage() {
  return <FoundersGateApp />;
}
